import {
  AdminPanel,
  aiLog,
  aiLogChannels,
  buckets,
  createDatabaseTables,
  inventory,
  isNear,
  nearestPlayerTo,
  notify,
  onCharacter,
  onClientCallback,
  online,
  onStop,
  resourceExport,
  vehicleOf,
} from "@aicore-fivem/lib/server";
import {
  createLogger,
  fail,
  oneArg,
  readId,
  readText,
  type Vec4,
} from "@aicore-fivem/lib/shared";
import { Locale, ResourceName } from "common";
import {
  EVENTS,
  INSIDE_META,
  readInterior,
  readProperty,
  readSettings,
  type Property,
} from "common/property";
import { propertiesSchema } from "./schema";
import { owners, sendAccess } from "./store";

const log = createLogger(ResourceName);
const core = resourceExport("ai-core");
const panel = new AdminPanel(propertiesSchema);
const content = {
  settings: panel.view("settings", readSettings),
  properties: panel.records("properties", readProperty),
  interiors: panel.records("interiors", readInterior),
};
aiLogChannels({ properties: {} });
createDatabaseTables(ResourceName, "sql/main.sql")
  .then(() => owners.load())
  .catch((error: unknown) => log.error("database setup failed", error));

const sourceOf = (charId: number) => core.GetSourceByCharId(charId);
const nameOf = (source: number) => online.name(source);
const isPolice = (source: number) =>
  online.onDutyIn(source, content.settings.value.policeJobs);

/**
 * Who is inside which property (server truth; also in the character's metadata for a rejoin) and the routing bucket
 * of every occupied property (lib `buckets`: taken when the first player enters, given back when the last one leaves).
 */
class Interiors {
  readonly inside = new Map<number, string>();
  private readonly worlds = new Map<
    string,
    { bucket: number; count: number }
  >();

  /** Moves the player into a property (`id`) or out (null): bucket here, the teleport on the player's client. */
  move(source: number, at: Vec4, id: string | null): void {
    const previous = this.inside.get(source);
    if (previous !== id) {
      if (previous) this.leave(previous);
      if (id) this.enter(id);
    }
    if (id) this.inside.set(source, id);
    else this.inside.delete(source);
    SetPlayerRoutingBucket(
      String(source),
      id ? (this.worlds.get(id)?.bucket ?? 0) : 0,
    );
    core.SetMeta(source, INSIDE_META, id);
    emitNet(EVENTS.inside, source, id, at);
  }

  /** The player is gone (drop, logout): the metadata stays for the rejoin. */
  forget(source: number): void {
    const id = this.inside.get(source);
    if (id === undefined) return;
    this.inside.delete(source);
    this.leave(id);
  }

  /** Back to the shared world before the buckets go back to ai-core; the metadata moves them to the door later. */
  stop(): void {
    for (const source of this.inside.keys())
      SetPlayerRoutingBucket(String(source), 0);
  }

  private enter(id: string): void {
    const world = this.worlds.get(id);
    if (world) world.count++;
    else
      this.worlds.set(id, {
        bucket: buckets.acquire(`property:${id}`),
        count: 1,
      });
  }

  private leave(id: string): void {
    const world = this.worlds.get(id);
    if (!world || --world.count > 0) return;
    this.worlds.delete(id);
    buckets.release(world.bucket);
  }
}

const interiors = new Interiors();
const inside = interiors.inside;

/** The property the player is in, when they own it. */
function ownedInside(source: number): Property | null {
  const id = inside.get(source);
  const charId = online.charId(source);
  const property = id ? content.properties.get(id) : undefined;
  return property &&
    charId !== undefined &&
    owners.accessOf(property.id, charId) === "owner"
    ? property
    : null;
}

const idArgs = oneArg((v) => readText(v, 64));

onClientCallback(
  EVENTS.mine,
  (source) => {
    const charId = online.charId(source);
    return {
      ok: true,
      list: charId === undefined ? [] : owners.accessList(charId),
    };
  },
  { rate: { count: 2, windowMs: 10_000 } },
);

onClientCallback(
  EVENTS.buy,
  { args: idArgs, lock: true },
  async (source, id) => {
    const property = content.properties.get(id);
    const charId = online.charId(source);
    if (!property || charId === undefined || !isNear(source, property.door, 3))
      return fail("PROP_ERR_FAR");
    if (owners.get(id)) return fail("PROP_ERR_OWNED");
    const account = content.settings.value.account;
    if (!core.RemoveMoney(source, account, property.price, `property:${id}`))
      return fail("PROP_ERR_MONEY");
    if (!(await owners.buy(id, charId, nameOf(source), property.price))) {
      core.AddMoney(source, account, property.price, `property:${id}:refund`);
      return fail("PROP_ERR_OWNED");
    }
    sendAccess(sourceOf, charId, id, "owner");
    notify(source, Locale("PROP_BOUGHT", property.label), "success");
    aiLog("properties", `bought ${id}`, {
      source,
      metadata: { price: property.price },
    });
    return { ok: true };
  },
);

onClientCallback(EVENTS.enter, { args: idArgs, lock: true }, (source, id) => {
  const property = content.properties.get(id);
  const interior = property
    ? content.interiors.get(property.interior)
    : undefined;
  const charId = online.charId(source);
  if (
    !property ||
    !interior ||
    charId === undefined ||
    !isNear(source, property.door, 3)
  )
    return fail("PROP_ERR_FAR");
  if (vehicleOf(source)) return fail("PROP_ERR_VEHICLE");
  if (
    !owners.accessOf(id, charId) &&
    !(content.settings.value.policeEnter && isPolice(source) && owners.get(id))
  )
    return fail("PROP_ERR_LOCKED");
  interiors.move(source, interior.entry, id);
  return { ok: true };
});

onClientCallback(
  EVENTS.exit,
  (source) => {
    const property = content.properties.get(inside.get(source) ?? "");
    if (!property) return fail("PROP_ERR_FAR");
    interiors.move(source, property.door, null);
    return { ok: true };
  },
  { lock: true },
);

onClientCallback(EVENTS.stash, (source) => {
  const id = inside.get(source);
  const property = id ? content.properties.get(id) : undefined;
  const charId = online.charId(source);
  if (
    !property ||
    charId === undefined ||
    !owners.accessOf(property.id, charId)
  )
    return fail("PROP_ERR_LOCKED");
  // Per owner: a sold property's stash stays with the seller's character, the next buyer starts empty.
  const owner = owners.get(property.id)?.owner;
  if (owner === undefined) return fail("PROP_ERR_LOCKED");
  const name = `property_${property.id}_${owner}`;
  const settings = content.settings.value;
  inventory.registerStash(
    name,
    property.label,
    settings.stashSlots,
    settings.stashWeight,
  );
  return inventory.openInventory(source, name)
    ? { ok: true }
    : fail("PROP_ERR_FAR");
});

onClientCallback(EVENTS.keys, (source) => {
  const property = ownedInside(source);
  if (!property) return fail("PROP_ERR_OWNER");
  const keys = owners.get(property.id)?.keys ?? new Map<number, string>();
  return {
    ok: true,
    keys: [...keys].map(([charId, name]) => ({ charId, name })),
  };
});

onClientCallback(
  EVENTS.giveKey,
  (source) => {
    const property = ownedInside(source);
    if (!property) return fail("PROP_ERR_OWNER");
    const target = nearestPlayerTo(
      source,
      3,
      (other) => inside.get(other) === property.id,
    );
    const charId = target === null ? undefined : online.charId(target);
    if (target === null || charId === undefined) return fail("PROP_ERR_NOBODY");
    owners.giveKey(property.id, charId, nameOf(target));
    sendAccess(sourceOf, charId, property.id, "key");
    notify(target, Locale("PROP_KEY_GOT", property.label), "success");
    return { ok: true };
  },
  { lock: true },
);

onClientCallback(
  EVENTS.takeKey,
  { args: oneArg(readId), lock: true },
  (source, charId) => {
    const property = ownedInside(source);
    if (!property) return fail("PROP_ERR_OWNER");
    if (!owners.takeKey(property.id, charId)) return fail("PROP_ERR_NOBODY");
    sendAccess(sourceOf, charId, property.id, false);
    return { ok: true };
  },
);

onClientCallback(
  EVENTS.sell,
  async (source) => {
    const property = ownedInside(source);
    if (!property) return fail("PROP_ERR_OWNER");
    const settings = content.settings.value;
    const refund = Math.floor((property.price * settings.sellPercent) / 100);
    const lost = await owners.sell(property.id);
    if (!lost) return fail("PROP_ERR_SELL");
    for (const charId of lost) sendAccess(sourceOf, charId, property.id, false);
    for (const [other, id] of inside)
      if (id === property.id) interiors.move(other, property.door, null);
    if (refund > 0)
      core.AddMoney(
        source,
        settings.account,
        refund,
        `property:${property.id}:sell`,
      );
    notify(source, Locale("PROP_SOLD", property.label, refund), "success");
    aiLog("properties", `sold ${property.id}`, {
      source,
      metadata: { refund },
    });
    return { ok: true };
  },
  { lock: true },
);

/** A character that left the game inside (or was inside at a restart) comes back at the door, in the shared world. */
onCharacter({
  loaded: (source) => {
    const id = core.GetMeta(source, INSIDE_META);
    const property =
      typeof id === "string" ? content.properties.get(id) : undefined;
    if (property) interiors.move(source, property.door, null);
  },
  unloaded: (source) => interiors.forget(source),
});

onStop(() => interiors.stop());
