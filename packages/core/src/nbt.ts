import { gunzipSync, gzipSync } from "node:zlib";

/**
 * Minecraft's NBT format, as far as structure files need it. Values read back as plain JavaScript:
 * numbers (longs as bigint), strings, arrays and objects.
 */
export type NbtValue = number | bigint | string | NbtValue[] | Int8Array | Int32Array | BigInt64Array | { [key: string]: NbtValue };

class Reader {
  private at = 0;
  constructor(private readonly buf: Buffer) {}

  private need(n: number) {
    if (this.at + n > this.buf.length) throw new Error("The file ends in the middle of a value");
  }
  byte() { this.need(1); return this.buf.readInt8(this.at++); }
  short() { this.need(2); const v = this.buf.readInt16BE(this.at); this.at += 2; return v; }
  int() { this.need(4); const v = this.buf.readInt32BE(this.at); this.at += 4; return v; }
  long() { this.need(8); const v = this.buf.readBigInt64BE(this.at); this.at += 8; return v; }
  float() { this.need(4); const v = this.buf.readFloatBE(this.at); this.at += 4; return v; }
  double() { this.need(8); const v = this.buf.readDoubleBE(this.at); this.at += 8; return v; }
  string() {
    this.need(2);
    const len = this.buf.readUInt16BE(this.at);
    this.at += 2;
    this.need(len);
    const s = this.buf.toString("utf8", this.at, this.at + len);
    this.at += len;
    return s;
  }
  count() {
    const n = this.int();
    if (n < 0) throw new Error("Negative length in NBT");
    return n;
  }

  payload(type: number, depth: number): NbtValue {
    if (depth > 512) throw new Error("NBT nested too deeply");
    switch (type) {
      case 1: return this.byte();
      case 2: return this.short();
      case 3: return this.int();
      case 4: return this.long();
      case 5: return this.float();
      case 6: return this.double();
      case 7: { const n = this.count(); this.need(n); const v = new Int8Array(this.buf.subarray(this.at, this.at + n)); this.at += n; return v; }
      case 8: return this.string();
      case 9: {
        const inner = this.byte();
        const n = this.count();
        const list: NbtValue[] = [];
        for (let i = 0; i < n; i++) list.push(this.payload(inner, depth + 1));
        return list;
      }
      case 10: {
        const obj: { [key: string]: NbtValue } = {};
        for (;;) {
          const t = this.byte();
          if (t === 0) return obj;
          obj[this.string()] = this.payload(t, depth + 1);
        }
      }
      case 11: { const n = this.count(); const v = new Int32Array(n); for (let i = 0; i < n; i++) v[i] = this.int(); return v; }
      case 12: { const n = this.count(); const v = new BigInt64Array(n); for (let i = 0; i < n; i++) v[i] = this.long(); return v; }
      default: throw new Error(`Unknown NBT tag type ${type}`);
    }
  }
}

/** Parse an NBT file, gzipped (as structure blocks save them) or not. Returns the root compound. */
export function readNbt(data: Buffer): { [key: string]: NbtValue } {
  const raw = data[0] === 0x1f && data[1] === 0x8b ? gunzipSync(data) : data;
  const r = new Reader(raw);
  if (r.byte() !== 10) throw new Error("Not an NBT file: it doesn't start with a compound");
  r.string();
  return r.payload(10, 0) as { [key: string]: NbtValue };
}

/** One block state in a structure's palette, like `minecraft:oak_stairs[facing=east,half=bottom]`. */
export interface PaletteEntry {
  name: string;
  properties: Record<string, string>;
}

export interface StructureTemplate {
  dataVersion: number;
  size: [number, number, number];
  palette: PaletteEntry[];
  /** Positions and palette indexes. Blocks missing from the list keep whatever terrain is there. */
  blocks: { pos: [number, number, number]; state: number }[];
  entities: number;
  /** The palette uses the pre-26.3 `Name`/`Properties` keys. */
  legacyPalette: boolean;
}

/** Read a structure block's `.nbt` file. Throws with a readable message when it isn't one. */
export function parseStructure(data: Buffer): StructureTemplate {
  const root = readNbt(data);
  const ints = (v: NbtValue | undefined, what: string): [number, number, number] => {
    if (!Array.isArray(v) || v.length !== 3 || v.some((n) => typeof n !== "number")) throw new Error(`The structure's ${what} isn't three whole numbers`);
    return v as [number, number, number];
  };
  const size = ints(root.size, "size");
  // Files with several palettes (shipwrecks) list them under `palettes`; the first is used.
  const rawPalette = Array.isArray(root.palette) ? root.palette : Array.isArray(root.palettes) && Array.isArray(root.palettes[0]) ? root.palettes[0] : null;
  if (!rawPalette) throw new Error("This NBT file has no block palette, so it isn't a structure. Save one with a structure block");
  // 26.3 writes `{id, properties}`; files from older versions have `{Name, Properties}`, which the game upgrades on load.
  let legacyPalette = false;
  const palette = rawPalette.map((p) => {
    const e = p as { id?: NbtValue; properties?: NbtValue; Name?: NbtValue; Properties?: NbtValue };
    if (e.id === undefined && e.Name !== undefined) legacyPalette = true;
    const props = (e.properties ?? e.Properties ?? {}) as Record<string, NbtValue>;
    return { name: String(e.id ?? e.Name ?? "minecraft:air"), properties: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, String(v)])) };
  });
  const blocks = (Array.isArray(root.blocks) ? root.blocks : []).map((b) => {
    const e = b as { pos?: NbtValue; state?: NbtValue };
    return { pos: ints(e.pos, "block position"), state: Number(e.state ?? 0) };
  });
  return {
    dataVersion: typeof root.DataVersion === "number" ? root.DataVersion : 0,
    size,
    palette,
    blocks,
    entities: Array.isArray(root.entities) ? root.entities.length : 0,
    legacyPalette,
  };
}

// ---- Writing (structures only) ----

class Writer {
  private parts: Buffer[] = [];
  private push(b: Buffer) { this.parts.push(b); }
  byte(v: number) { const b = Buffer.alloc(1); b.writeInt8(v); this.push(b); }
  int(v: number) { const b = Buffer.alloc(4); b.writeInt32BE(v); this.push(b); }
  string(s: string) { const body = Buffer.from(s, "utf8"); const len = Buffer.alloc(2); len.writeUInt16BE(body.length); this.push(len); this.push(body); }
  named(type: number, name: string) { this.byte(type); this.string(name); }
  intList(name: string, values: number[]) { this.named(9, name); this.byte(3); this.int(values.length); for (const v of values) this.int(v); }
  done() { return Buffer.concat(this.parts); }
}

/** Write a structure as a gzipped `.nbt`, the way a 26.3 structure block saves it (palette entries are `{id, properties}`). */
export function writeStructure(t: Omit<StructureTemplate, "entities" | "legacyPalette">): Buffer {
  const w = new Writer();
  w.named(10, "");
  w.intList("size", t.size);
  w.named(9, "entities");
  w.byte(10);
  w.int(0);
  w.named(9, "blocks");
  w.byte(10);
  w.int(t.blocks.length);
  for (const b of t.blocks) {
    w.intList("pos", b.pos);
    w.named(3, "state");
    w.int(b.state);
    w.byte(0);
  }
  w.named(9, "palette");
  w.byte(10);
  w.int(t.palette.length);
  for (const p of t.palette) {
    const props = Object.entries(p.properties);
    if (props.length) {
      w.named(10, "properties");
      for (const [k, v] of props) {
        w.named(8, k);
        w.string(v);
      }
      w.byte(0);
    }
    w.named(8, "id");
    w.string(p.name);
    w.byte(0);
  }
  w.named(3, "DataVersion");
  w.int(t.dataVersion);
  w.byte(0);
  return gzipSync(w.done());
}
