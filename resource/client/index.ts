import {
  AdminWorld,
  fadeOut,
  loadLocaleTexts,
  menu,
  notify,
  onServerEvent,
  Points,
  triggerServerCallback,
} from "@aicore-fivem/lib/client"
import { record, sleep } from "@aicore-fivem/lib/shared"
import { CORE } from "@aicore-fivem/shared"
import { Locale } from "common"
import {
  EVENTS,
  ownedKey,
  readInteriors,
  readProperties,
  type Access,
  type Property,
} from "common/property"

const world = new AdminWorld(["properties", "interiors"])
const texts = loadLocaleTexts()
const content = {
  properties: readProperties(world.get("properties")),
  interiors: readInteriors(world.get("interiors")),
}
const errorText = (v: unknown, fallback: string): string => {
  const key =
    typeof record(v).error === "string" ? String(record(v).error) : fallback
  return texts[key] ?? key
}
const call = async (name: string, args: unknown[] = []) => {
  const result = record(
    await triggerServerCallback(name, args).catch(() => null)
  )
  if (result.ok !== true) notify(errorText(result, "PROP_ERR_FAR"), "error")
  return result
}

/**
 * Door points (buy, enter, locked), blips of the player's properties and properties for sale, and the
 * property menu at the interior entry while inside. Access comes as one snapshot, then deltas.
 */
class Homes {
  private readonly access = new Map<string, Access>()
  private readonly doors = new Points()
  private readonly inner = new Points()
  insideId: string | null = null

  async load(): Promise<void> {
    const result = record(
      await triggerServerCallback(EVENTS.mine, []).catch(() => null)
    )
    this.access.clear()
    for (const row of Array.isArray(result.list) ? result.list.map(record) : [])
      if (
        typeof row.id === "string" &&
        (row.access === "owner" || row.access === "key")
      )
        this.access.set(row.id, row.access)
    this.rebuild()
  }

  setAccess(id: string, access: Access | false): void {
    if (access) this.access.set(id, access)
    else this.access.delete(id)
    this.rebuild()
  }

  private label(p: Property): string {
    if (GlobalState[ownedKey(p.id)] !== true)
      return Locale("PROP_PROMPT_BUY", p.label, p.price)
    return this.access.has(p.id)
      ? Locale("PROP_PROMPT_ENTER", p.label)
      : Locale("PROP_PROMPT_LOCKED", p.label)
  }

  rebuild(): void {
    this.doors.clear()
    for (const p of content.properties.values()) {
      const mine = this.access.has(p.id)
      const blip = mine || (p.blip && GlobalState[ownedKey(p.id)] !== true)
      this.doors.add(p.id, {
        coords: p.door,
        label: this.label(p),
        icon: "house",
        radius: 1.5,
        blip: blip
          ? {
              sprite: mine ? 40 : 350,
              color: mine ? 2 : 0,
              scale: 0.7,
              label: p.label,
            }
          : undefined,
        onPressed: () => this.door(p),
      })
    }
  }

  setInside(id: string | null): void {
    this.insideId = id
    this.inner.clear()
    const property = id ? content.properties.get(id) : undefined
    const interior = property
      ? content.interiors.get(property.interior)
      : undefined
    if (!interior) return
    this.inner.add("inside", {
      coords: interior.entry,
      label: Locale("PROP_PROMPT_MENU"),
      icon: "bars",
      radius: 1.5,
      interval: 400,
      onPressed: () => this.insideMenu(),
    })
  }

  async door(p: Property): Promise<void> {
    if (GlobalState[ownedKey(p.id)] !== true) {
      const pick = await menu({
        title: p.label,
        items: [
          {
            id: "buy",
            label: Locale("PROP_BUY", p.price),
            icon: "money-bill-wave",
          },
        ],
      })
      if (pick === "buy") await call(EVENTS.buy, [p.id])
      return
    }
    await fade(() => call(EVENTS.enter, [p.id]))
  }

  async insideMenu(): Promise<void> {
    const items = [
      { id: "exit", label: Locale("PROP_EXIT"), icon: "location-dot" },
      { id: "stash", label: Locale("PROP_STASH"), icon: "box-open" },
      { id: "keys", label: Locale("PROP_KEYS"), icon: "key" },
      { id: "sell", label: Locale("PROP_SELL"), icon: "money-bill-wave" },
    ]
    const pick = await menu({ title: Locale("PROP_MENU"), items })
    if (pick === "exit") await fade(() => call(EVENTS.exit))
    else if (pick === "stash") await call(EVENTS.stash)
    else if (pick === "keys") await this.keys()
    else if (pick === "sell") {
      const sure = await menu({
        title: Locale("PROP_SELL"),
        items: [
          {
            id: "yes",
            label: Locale("PROP_SELL_CONFIRM"),
            icon: "money-bill-wave",
          },
        ],
      })
      if (sure === "yes") await call(EVENTS.sell)
    }
  }

  private async keys(): Promise<void> {
    const result = await call(EVENTS.keys)
    if (result.ok !== true) return
    const holders = (
      Array.isArray(result.keys) ? result.keys.map(record) : []
    ).filter((k) => typeof k.charId === "number")
    const pick = await menu({
      title: Locale("PROP_KEYS"),
      items: [
        { id: "give", label: Locale("PROP_GIVE_KEY"), icon: "key" },
        ...holders.map((k) => ({
          id: String(k.charId),
          label: String(k.name ?? ""),
          description: Locale("PROP_TAKE_KEY"),
        })),
      ],
    })
    if (pick === "give") await call(EVENTS.giveKey)
    else if (pick !== null) await call(EVENTS.takeKey, [Number(pick)])
  }
}

/** Runs a move behind a short screen fade. */
async function fade(move: () => Promise<unknown>): Promise<void> {
  await fadeOut()
  await move()
  await sleep(400)
  DoScreenFadeIn(300)
}

const homes = new Homes()
void homes.load()
on(CORE.clientPlayerLoadedEvent, () => void homes.load())
world.onChange("properties", () => {
  content.properties = readProperties(world.get("properties"))
  homes.rebuild()
})
world.onChange(
  "interiors",
  () => (content.interiors = readInteriors(world.get("interiors")))
)
// The bag still holds the old value inside its change handler.
AddStateBagChangeHandler(
  "",
  "global",
  (_bag: string, key: string) =>
    key.startsWith("prop:") && setTimeout(() => homes.rebuild(), 0)
)

onServerEvent(
  EVENTS.access,
  {
    args: ([id, access]): [string, Access | false] | null =>
      typeof id === "string" &&
      (access === "owner" || access === "key" || access === false)
        ? [id, access]
        : null,
  },
  (id, access) => homes.setAccess(id, access)
)
onServerEvent(
  EVENTS.inside,
  {
    args: ([id]): [string | null] | null =>
      id == null ? [null] : typeof id === "string" ? [id] : null,
  },
  (id) => homes.setInside(id)
)
