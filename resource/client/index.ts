import {
  AdminWorld,
  callAction,
  fadeIn,
  fadeOut,
  GlobalGroup,
  menu,
  onServerEvent,
  player,
  Points,
  stateBoolean,
} from "@aicore-fivem/lib/client";
import { isRecord, vec4, type Vec4 } from "@aicore-fivem/lib/shared";
import { CORE } from "@aicore-fivem/shared";
import { Locale } from "common";
import {
  EVENTS,
  OWNED_PREFIX,
  readInterior,
  readProperty,
  readSettings,
  type Access,
  type Property,
} from "common/property";

const owned = new GlobalGroup(OWNED_PREFIX, stateBoolean);

const world = new AdminWorld(["settings", "properties", "interiors"]);
const content = {
  settings: world.view("settings", readSettings),
  properties: world.records("properties", readProperty),
  interiors: world.records("interiors", readInterior),
};
const FALLBACK = { fallback: "PROP_ERR_FAR" };
const call = (name: string, args: unknown[] = []) =>
  callAction(name, args, FALLBACK);

/**
 * Door points (buy, enter, locked; the label follows ownership), blips of the player's properties and properties for
 * sale, and the property menu at the interior entry while inside. Access comes as one snapshot, then deltas; a change
 * re-adds only that property's point.
 */
class Homes {
  private readonly access = new Map<string, Access>();
  private readonly doors = new Points();
  private readonly inner = new Points();

  async load(): Promise<void> {
    const reply = await callAction(EVENTS.mine, [], {
      ...FALLBACK,
      silent: true,
    });
    this.access.clear();
    for (const row of Array.isArray(reply?.list) ? reply.list : [])
      if (
        isRecord(row) &&
        typeof row.id === "string" &&
        (row.access === "owner" || row.access === "key")
      )
        this.access.set(row.id, row.access);
    this.rebuild();
  }

  setAccess(id: string, access: Access | false): void {
    if (access) this.access.set(id, access);
    else this.access.delete(id);
    this.update(id);
  }

  private label(p: Property): string {
    if (owned.get(p.id) !== true)
      return Locale("PROP_PROMPT_BUY", p.label, p.price);
    return this.access.has(p.id)
      ? Locale("PROP_PROMPT_ENTER", p.label)
      : Locale("PROP_PROMPT_LOCKED", p.label);
  }

  /** Adds (or replaces) one property's door point; its blip follows ownership and access. */
  private add(p: Property): void {
    const mine = this.access.has(p.id);
    const forSale = p.blip && owned.get(p.id) !== true;
    const style = mine
      ? content.settings.value.ownedBlip
      : content.settings.value.saleBlip;
    this.doors.add(p.id, {
      coords: p.door,
      label: () => this.label(p),
      icon: "house",
      radius: 1.5,
      blip: mine || forSale ? { ...style, label: p.label } : undefined,
      onPressed: () => this.door(p),
    });
  }

  /** One property changed (ownership, access, its panel record). */
  update(id: string): void {
    const p = content.properties.get(id);
    if (p) this.add(p);
    else this.doors.remove(id);
  }

  rebuild(): void {
    this.doors.clear();
    for (const p of content.properties.values()) this.add(p);
  }

  setInside(id: string | null): void {
    this.inner.clear();
    const property = id ? content.properties.get(id) : undefined;
    const interior = property
      ? content.interiors.get(property.interior)
      : undefined;
    if (!interior) return;
    this.inner.add("inside", {
      coords: interior.entry,
      label: Locale("PROP_PROMPT_MENU"),
      icon: "bars",
      radius: 1.5,
      interval: 400,
      onPressed: () => this.insideMenu(),
    });
  }

  async door(p: Property): Promise<void> {
    if (owned.get(p.id) !== true) {
      const pick = await menu({
        title: p.label,
        items: [
          {
            id: "buy",
            label: Locale("PROP_BUY", p.price),
            icon: "money-bill-wave",
          },
        ],
      });
      if (pick === "buy") await call(EVENTS.buy, [p.id]);
      return;
    }
    await move(EVENTS.enter, [p.id]);
  }

  async insideMenu(): Promise<void> {
    const items = [
      { id: "exit", label: Locale("PROP_EXIT"), icon: "location-dot" },
      { id: "stash", label: Locale("PROP_STASH"), icon: "box-open" },
      { id: "keys", label: Locale("PROP_KEYS"), icon: "key" },
      { id: "sell", label: Locale("PROP_SELL"), icon: "money-bill-wave" },
    ];
    const pick = await menu({ title: Locale("PROP_MENU"), items });
    if (pick === "exit") await move(EVENTS.exit);
    else if (pick === "stash") await call(EVENTS.stash);
    else if (pick === "keys") await this.keys();
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
      });
      if (sure === "yes") await call(EVENTS.sell);
    }
  }

  private async keys(): Promise<void> {
    const reply = await call(EVENTS.keys);
    if (!reply) return;
    const holders = (Array.isArray(reply.keys) ? reply.keys : []).filter(
      (k): k is { charId: number; name?: unknown } =>
        isRecord(k) && typeof k.charId === "number",
    );
    const pick = await menu({
      title: Locale("PROP_KEYS"),
      items: [
        { id: "give", label: Locale("PROP_GIVE_KEY"), icon: "key" },
        ...holders.map((k) => ({
          id: String(k.charId),
          label: typeof k.name === "string" ? k.name : "",
          description: Locale("PROP_TAKE_KEY"),
        })),
      ],
    });
    if (pick === "give") await call(EVENTS.giveKey);
    else if (pick !== null) await call(EVENTS.takeKey, [Number(pick)]);
  }
}

/** Enter / exit: the screen goes black first; the server's `inside` event teleports and lifts the fade. */
async function move(name: string, args: unknown[] = []): Promise<void> {
  await fadeOut();
  if (!(await call(name, args))) await fadeIn(300);
}

const homes = new Homes();
void homes.load();
on(CORE.clientPlayerLoadedEvent, () => void homes.load());
world.onChange("properties", (key) =>
  key === undefined ? homes.rebuild() : homes.update(key),
);
world.onChange("settings", () => homes.rebuild());
owned.onChange((id) => homes.update(id));

onServerEvent(
  EVENTS.access,
  {
    args: ([id, access]): [string, Access | false] | null =>
      typeof id === "string" &&
      (access === "owner" || access === "key" || access === false)
        ? [id, access]
        : null,
  },
  (id, access) => homes.setAccess(id, access),
);
const NOWHERE: Vec4 = { x: 0, y: 0, z: 0, heading: 0 };
onServerEvent(
  EVENTS.inside,
  {
    args: ([id, to]): [string | null, Vec4] | null =>
      (id == null || typeof id === "string") && isRecord(to)
        ? [id ?? null, vec4(to, NOWHERE)]
        : null,
  },
  (id, to) => {
    homes.setInside(id);
    void player.teleport(to, { heading: to.heading });
  },
);
