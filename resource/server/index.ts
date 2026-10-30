import {
  AdminPanel,
  aiLog,
  aiLogChannels,
  createDatabaseTables,
  inventory,
  notify,
  onClientCallback,
  resourceExport,
} from "@aicore-fivem/lib/server"
import { asArgs, createLogger } from "@aicore-fivem/lib/shared"
import { CORE } from "@aicore-fivem/shared"
import { Locale, ResourceName } from "common"
import {
  EVENTS,
  INSIDE_META,
  readInteriors,
  readProperties,
  readSettings,
  type Property,
} from "common/property"
import { propertiesSchema } from "./schema"
import { owners, sendAccess } from "./store"

const log = createLogger(ResourceName)
const core = resourceExport("ai-core")
const panel = new AdminPanel(propertiesSchema)
/** Panel content, parsed again after every change. */
const content = {
  settings: readSettings(panel.get("settings")),
  properties: readProperties(panel.get("properties")),
  interiors: readInteriors(panel.get("interiors")),
}
panel.onChange(
  "settings",
  () => (content.settings = readSettings(panel.get("settings")))
)
panel.onChange(
  "properties",
  () => (content.properties = readProperties(panel.get("properties")))
)
panel.onChange(
  "interiors",
  () => (content.interiors = readInteriors(panel.get("interiors")))
)
aiLogChannels({ properties: {} })
createDatabaseTables(ResourceName, "sql/main.sql")
  .then(() => owners.load())
  .catch((error: unknown) => log.error("database setup failed", error))

const fail = (error: string) => ({ ok: false as const, error })
const ped = (source: number) => GetPlayerPed(String(source))
const near = (
  source: number,
  at: { x: number; y: number; z: number },
  metres: number
) => {
  const [x = 0, y = 0, z = 0] = GetEntityCoords(ped(source))
  return Math.hypot(x - at.x, y - at.y, z - at.z) <= metres
}
const sourceOf = (charId: number) => core.GetSourceByCharId(charId)
const nameOf = (source: number) => {
  const c = core.GetCharacter(source)
  return c ? `${c.firstname} ${c.lastname}` : GetPlayerName(String(source))
}
const isPolice = (source: number) => {
  const duty = core.GetDutyJob(source)
  return duty !== null && content.settings.policeJobs.includes(duty)
}

/** Every property has its own routing bucket (5000-49999; ai-core and ai-appearance use 50000+), so each interior copy is private. */
const buckets = new Map<string, number>()
function bucketOf(id: string): number {
  let bucket = buckets.get(id)
  if (bucket === undefined) {
    bucket = 5000 + buckets.size
    buckets.set(id, bucket)
    SetRoutingBucketPopulationEnabled(bucket, false)
    SetRoutingBucketEntityLockdownMode(bucket, "strict")
  }
  return bucket
}

/** Who is inside which property (server truth; also in the character's metadata for a rejoin). */
const inside = new Map<number, string>()

function moveTo(
  source: number,
  at: { x: number; y: number; z: number; heading: number },
  bucket: number,
  id: string | null
): void {
  SetPlayerRoutingBucket(String(source), bucket)
  SetEntityCoords(ped(source), at.x, at.y, at.z, false, false, false, false)
  SetEntityHeading(ped(source), at.heading)
  if (id) inside.set(source, id)
  else inside.delete(source)
  core.SetMeta(source, INSIDE_META, id)
  emitNet(EVENTS.inside, source, id)
}

/** The property the player is in, when they own it. */
function ownedInside(source: number): Property | null {
  const id = inside.get(source)
  const charId = core.GetCharacter(source)?.id
  const property = id ? content.properties.get(id) : undefined
  return property &&
    charId !== undefined &&
    owners.accessOf(property.id, charId) === "owner"
    ? property
    : null
}

const idArgs = ([id]: unknown[]) => asArgs(typeof id === "string" ? id : null)

onClientCallback(EVENTS.mine, (source) => {
  const charId = core.GetCharacter(source)?.id
  return {
    ok: true,
    list: charId === undefined ? [] : owners.accessList(charId),
  }
})

onClientCallback(
  EVENTS.buy,
  { args: idArgs, lock: true },
  async (source, id) => {
    const property = content.properties.get(id)
    const charId = core.GetCharacter(source)?.id
    if (!property || charId === undefined || !near(source, property.door, 3))
      return fail("PROP_ERR_FAR")
    if (owners.get(id)) return fail("PROP_ERR_OWNED")
    const account = content.settings.account
    if (!core.RemoveMoney(source, account, property.price, `property:${id}`))
      return fail("PROP_ERR_MONEY")
    if (!(await owners.buy(id, charId, nameOf(source), property.price))) {
      core.AddMoney(source, account, property.price, `property:${id}:refund`)
      return fail("PROP_ERR_OWNED")
    }
    sendAccess(sourceOf, charId, id, "owner")
    notify(source, Locale("PROP_BOUGHT", property.label), "success")
    aiLog("properties", `bought ${id}`, {
      source,
      metadata: { price: property.price },
    })
    return { ok: true }
  }
)

onClientCallback(EVENTS.enter, { args: idArgs, lock: true }, (source, id) => {
  const property = content.properties.get(id)
  const interior = property
    ? content.interiors.get(property.interior)
    : undefined
  const charId = core.GetCharacter(source)?.id
  if (
    !property ||
    !interior ||
    charId === undefined ||
    !near(source, property.door, 3)
  )
    return fail("PROP_ERR_FAR")
  if (GetVehiclePedIsIn(ped(source), false)) return fail("PROP_ERR_VEHICLE")
  if (
    !owners.accessOf(id, charId) &&
    !(content.settings.policeEnter && isPolice(source) && owners.get(id))
  )
    return fail("PROP_ERR_LOCKED")
  moveTo(source, interior.entry, bucketOf(id), id)
  return { ok: true }
})

onClientCallback(
  EVENTS.exit,
  (source) => {
    const property = content.properties.get(inside.get(source) ?? "")
    if (!property) return fail("PROP_ERR_FAR")
    moveTo(source, property.door, 0, null)
    return { ok: true }
  },
  { lock: true }
)

onClientCallback(EVENTS.stash, (source) => {
  const id = inside.get(source)
  const property = id ? content.properties.get(id) : undefined
  const charId = core.GetCharacter(source)?.id
  if (
    !property ||
    charId === undefined ||
    !owners.accessOf(property.id, charId)
  )
    return fail("PROP_ERR_LOCKED")
  const name = `property_${property.id}`
  inventory.registerStash(
    name,
    property.label,
    content.settings.stashSlots,
    content.settings.stashWeight
  )
  return inventory.openInventory(source, name)
    ? { ok: true }
    : fail("PROP_ERR_FAR")
})

onClientCallback(EVENTS.keys, (source) => {
  const property = ownedInside(source)
  if (!property) return fail("PROP_ERR_OWNER")
  const keys = owners.get(property.id)?.keys ?? new Map<number, string>()
  return {
    ok: true,
    keys: [...keys].map(([charId, name]) => ({ charId, name })),
  }
})

onClientCallback(
  EVENTS.giveKey,
  (source) => {
    const property = ownedInside(source)
    if (!property) return fail("PROP_ERR_OWNER")
    const [x = 0, y = 0, z = 0] = GetEntityCoords(ped(source))
    const target = [...inside].find(
      ([other, id]) =>
        other !== source && id === property.id && near(other, { x, y, z }, 3)
    )?.[0]
    const charId =
      target === undefined ? undefined : core.GetCharacter(target)?.id
    if (target === undefined || charId === undefined)
      return fail("PROP_ERR_NOBODY")
    owners.giveKey(property.id, charId, nameOf(target))
    sendAccess(sourceOf, charId, property.id, "key")
    notify(target, Locale("PROP_KEY_GOT", property.label), "success")
    return { ok: true }
  },
  { lock: true }
)

onClientCallback(
  EVENTS.takeKey,
  {
    args: ([charId]) =>
      asArgs(Number.isInteger(charId) ? Number(charId) : null),
    lock: true,
  },
  (source, charId) => {
    const property = ownedInside(source)
    if (!property) return fail("PROP_ERR_OWNER")
    if (!owners.takeKey(property.id, charId)) return fail("PROP_ERR_NOBODY")
    sendAccess(sourceOf, charId, property.id, false)
    return { ok: true }
  }
)

onClientCallback(
  EVENTS.sell,
  async (source) => {
    const property = ownedInside(source)
    if (!property) return fail("PROP_ERR_OWNER")
    const refund = Math.floor(
      (property.price * content.settings.sellPercent) / 100
    )
    const lost = await owners.sell(property.id)
    for (const charId of lost) sendAccess(sourceOf, charId, property.id, false)
    for (const [other, id] of inside)
      if (id === property.id) moveTo(other, property.door, 0, null)
    if (refund > 0)
      core.AddMoney(
        source,
        content.settings.account,
        refund,
        `property:${property.id}:sell`
      )
    notify(source, Locale("PROP_SOLD", property.label, refund), "success")
    aiLog("properties", `sold ${property.id}`, { source, metadata: { refund } })
    return { ok: true }
  },
  { lock: true }
)

/** A character that left the game inside comes back at the door, in the shared world. */
on(CORE.playerLoadedEvent, (source: number) => {
  const id = core.GetMeta(source, INSIDE_META)
  const property =
    typeof id === "string" ? content.properties.get(id) : undefined
  if (property) moveTo(source, property.door, 0, null)
})
on("playerDropped", () => inside.delete(Number(globalThis.source)))
