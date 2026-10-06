import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";

interface Entry {
  method: number;
  compressedSize: number;
  localOffset: number;
}

/** Just enough of a zip reader to pull files out of a Minecraft jar. No zip64, no encryption. */
export class ZipFile {
  private constructor(
    private readonly data: Buffer,
    private readonly entries: Map<string, Entry>,
  ) {}

  static async open(file: string): Promise<ZipFile> {
    return ZipFile.fromBuffer(await readFile(file));
  }

  static fromBuffer(data: Buffer): ZipFile {
    // The end-of-central-directory record sits in the last 64 KiB (it may be followed by a comment).
    let eocd = -1;
    for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
      if (data.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("Not a zip file");
    const count = data.readUInt16LE(eocd + 10);
    let p = data.readUInt32LE(eocd + 16);
    const entries = new Map<string, Entry>();
    for (let n = 0; n < count; n++) {
      if (data.readUInt32LE(p) !== 0x02014b50) throw new Error("Broken zip central directory");
      const nameLen = data.readUInt16LE(p + 28);
      const extraLen = data.readUInt16LE(p + 30);
      const commentLen = data.readUInt16LE(p + 32);
      entries.set(data.toString("utf8", p + 46, p + 46 + nameLen), {
        method: data.readUInt16LE(p + 10),
        compressedSize: data.readUInt32LE(p + 20),
        localOffset: data.readUInt32LE(p + 42),
      });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return new ZipFile(data, entries);
  }

  names(): IterableIterator<string> {
    return this.entries.keys();
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  read(name: string): Buffer | null {
    const e = this.entries.get(name);
    if (!e) return null;
    const p = e.localOffset;
    const start = p + 30 + this.data.readUInt16LE(p + 26) + this.data.readUInt16LE(p + 28);
    const raw = this.data.subarray(start, start + e.compressedSize);
    if (e.method === 0) return Buffer.from(raw);
    if (e.method === 8) return inflateRawSync(raw);
    throw new Error(`${name} uses unsupported zip compression ${e.method}`);
  }
}
