import { mysql } from "@aicore-fivem/mysql";
import { createLogger } from "@aicore-fivem/lib/shared";
import { ResourceName } from "common";
import { EVENTS, ownedKey, type Access } from "common/property";

const log = createLogger(ResourceName);

interface Ownership {
  owner: number;
  ownerName: string;
  /** charId -> name */
  keys: Map<number, string>;
}

/**
 * Who owns which property and who holds keys, in memory (loaded once; rows exist only for owned properties). Each
 * change writes the DB, sets the property's GlobalState flag and sends the access delta to the online characters it
 * concerns.
 */
class Owners {
  private readonly byProperty = new Map<string, Ownership>();

  async load(): Promise<void> {
    const owned = await mysql.query<
      Array<{ property: string; char_id: number; owner_name: string }>
    >("SELECT property, char_id, owner_name FROM ai_properties_owned");
    const keys = await mysql.query<
      Array<{ property: string; char_id: number; name: string }>
    >("SELECT property, char_id, name FROM ai_properties_keys");
    for (const r of owned)
      this.byProperty.set(r.property, {
        owner: Number(r.char_id),
        ownerName: r.owner_name,
        keys: new Map(),
      });
    for (const r of keys)
      this.byProperty.get(r.property)?.keys.set(Number(r.char_id), r.name);
    for (const id of this.byProperty.keys())
      GlobalState.set(ownedKey(id), true, true);
    log.info(`${this.byProperty.size} owned properties loaded`);
  }

  get(id: string): Ownership | undefined {
    return this.byProperty.get(id);
  }

  accessOf(id: string, charId: number): Access | null {
    const o = this.byProperty.get(id);
    if (!o) return null;
    return o.owner === charId ? "owner" : o.keys.has(charId) ? "key" : null;
  }

  /** Every property the character owns or holds a key to (the player's snapshot). */
  accessList(charId: number): Array<{ id: string; access: Access }> {
    const list: Array<{ id: string; access: Access }> = [];
    for (const [id, o] of this.byProperty) {
      if (o.owner === charId) list.push({ id, access: "owner" });
      else if (o.keys.has(charId)) list.push({ id, access: "key" });
    }
    return list;
  }

  async buy(
    id: string,
    charId: number,
    name: string,
    price: number,
  ): Promise<boolean> {
    if (this.byProperty.has(id)) return false;
    this.byProperty.set(id, {
      owner: charId,
      ownerName: name,
      keys: new Map(),
    });
    try {
      await mysql.query(
        "INSERT INTO ai_properties_owned (property, char_id, owner_name, price) VALUES (?, ?, ?, ?)",
        [id, charId, name.slice(0, 64), price],
      );
    } catch (error) {
      this.byProperty.delete(id);
      log.error(`buying ${id} failed`, error);
      return false;
    }
    GlobalState.set(ownedKey(id), true, true);
    return true;
  }

  async sell(id: string): Promise<number[]> {
    const o = this.byProperty.get(id);
    if (!o) return [];
    this.byProperty.delete(id);
    GlobalState.set(ownedKey(id), false, true);
    await mysql.transaction([
      {
        query: "DELETE FROM ai_properties_keys WHERE property = ?",
        values: [id],
      },
      {
        query: "DELETE FROM ai_properties_owned WHERE property = ?",
        values: [id],
      },
    ]);
    return [o.owner, ...o.keys.keys()];
  }

  giveKey(id: string, charId: number, name: string): void {
    const o = this.byProperty.get(id);
    if (!o || o.owner === charId || o.keys.has(charId)) return;
    o.keys.set(charId, name);
    mysql
      .query(
        "INSERT IGNORE INTO ai_properties_keys (property, char_id, name) VALUES (?, ?, ?)",
        [id, charId, name.slice(0, 64)],
      )
      .catch((error: unknown) => log.error("key save failed", error));
  }

  takeKey(id: string, charId: number): boolean {
    const o = this.byProperty.get(id);
    if (!o?.keys.delete(charId)) return false;
    mysql
      .query(
        "DELETE FROM ai_properties_keys WHERE property = ? AND char_id = ?",
        [id, charId],
      )
      .catch((error: unknown) => log.error("key delete failed", error));
    return true;
  }
}

export const owners = new Owners();

/** Sends a character's new access to a property, when that character is online. */
export function sendAccess(
  sourceOf: (charId: number) => number | null,
  charId: number,
  id: string,
  access: Access | false,
): void {
  const source = sourceOf(charId);
  if (source !== null) emitNet(EVENTS.access, source, id, access);
}
