import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ElementSpec, Project } from "./schema.js";
import { resourceFiles } from "./profiles/v26_3/resources.js";
import { ZipFile } from "./zip.js";

/** One tag: `minecraft:mineable/pickaxe` (no `#`) and the raw entries of its file, which may name other tags. */
export interface TagEntry {
  id: string;
  values: string[];
  /** A display name, when the tag's mod provides one (Fabric's `c:` tags do). */
  name?: string;
}

/** Tags by registry folder: `block`, `item`, `entity_type`, `worldgen/biome` and so on. */
export type TagCatalog = Record<string, TagEntry[]>;

/** Tags from the three places a mod can use them from, for the tag fields' autofill. */
export interface TagSources {
  /** Read from the Minecraft jar. Empty when no jar was found. */
  minecraft: TagCatalog;
  /** Fabric's shared `c:` tags, from the convention tags jar in the Gradle cache. */
  fabric: TagCatalog;
  /** Tags this mod generates or ships by hand in src/main/resources. */
  mod: TagCatalog;
  /** Vanilla biome ids, for fields that take a biome or a biome tag. */
  biomes: string[];
  /** Vanilla enchantment ids, for fields that take an enchantment or an enchantment tag. */
  enchantments: string[];
}

/** `data/<ns>/tags/<type>/<path>.json` -> [type, `ns:path`]. Worldgen registries have a two-part type. */
export function parseTagPath(file: string): [string, string] | null {
  const m = /^data\/([a-z0-9_.-]+)\/tags\/(.+)\.json$/.exec(file);
  if (!m) return null;
  const parts = m[2].split("/");
  const typeLength = parts[0] === "worldgen" ? 2 : 1;
  if (parts.length <= typeLength) return null;
  return [parts.slice(0, typeLength).join("/"), `${m[1]}:${parts.slice(typeLength).join("/")}`];
}

function entryValues(json: any): string[] {
  const values: unknown[] = Array.isArray(json?.values) ? json.values : [];
  return values.flatMap((v: any) => (typeof v === "string" ? [v] : typeof v?.id === "string" ? [v.id] : []));
}

function add(catalog: TagCatalog, type: string, entry: TagEntry) {
  const list = (catalog[type] ??= []);
  const existing = list.find((e) => e.id === entry.id);
  if (existing) existing.values = [...new Set([...existing.values, ...entry.values])];
  else list.push(entry);
}

function sorted(catalog: TagCatalog): TagCatalog {
  for (const list of Object.values(catalog)) list.sort((a, b) => a.id.localeCompare(b.id));
  return catalog;
}

/** Every tag file in a jar (or any zip with a data/ folder), named with the jar's `tag.<type>.<ns>.<path>` lang keys when it has them. */
export function zipTags(zip: ZipFile, lang?: Record<string, string>): TagCatalog {
  const catalog: TagCatalog = {};
  for (const name of zip.names()) {
    const parsed = parseTagPath(name);
    if (!parsed) continue;
    const [type, id] = parsed;
    let json: any = null;
    try {
      json = JSON.parse(zip.read(name)?.toString("utf8") ?? "null");
    } catch {
      // A broken tag file is still a tag name worth offering.
    }
    const key = `tag.${type.replaceAll("/", ".")}.${id.replace(":", ".").replaceAll("/", ".")}`;
    add(catalog, type, { id, values: entryValues(json), ...(lang?.[key] ? { name: lang[key] } : {}) });
  }
  return sorted(catalog);
}

/** Ids of a data-driven registry listed in a Minecraft jar, like `worldgen/biome` -> `minecraft:plains`. */
export function zipIds(zip: ZipFile, registry: string): string[] {
  const prefix = `data/minecraft/${registry}/`;
  return [...zip.names()]
    .flatMap((n) => (n.startsWith(prefix) && n.endsWith(".json") ? [`minecraft:${n.slice(prefix.length, -5)}`] : []))
    .sort();
}

/** The newest Fabric convention tags jar Loom downloaded, or null when the Gradle cache has none. */
export function findConventionTagsJar(): string | null {
  const gradle = process.env.GRADLE_USER_HOME ?? path.join(os.homedir(), ".gradle");
  const dir = path.join(gradle, "caches", "modules-2", "files-2.1", "net.fabricmc.fabric-api", "fabric-convention-tags-v2");
  if (!existsSync(dir)) return null;
  let best: { file: string; mtime: number } | null = null;
  try {
    for (const version of readdirSync(dir)) {
      for (const hash of readdirSync(path.join(dir, version))) {
        for (const name of readdirSync(path.join(dir, version, hash))) {
          if (!name.endsWith(".jar") || name.endsWith("-sources.jar")) continue;
          const file = path.join(dir, version, hash, name);
          const mtime = statSync(file).mtimeMs;
          if (!best || mtime > best.mtime) best = { file, mtime };
        }
      }
    }
  } catch {
    return best?.file ?? null;
  }
  return best?.file ?? null;
}

/** Fabric's `c:` tags with their English names. */
export async function conventionTags(jar: string): Promise<TagCatalog> {
  const zip = await ZipFile.open(jar);
  let lang: Record<string, string> = {};
  try {
    lang = JSON.parse(zip.read("assets/fabric-convention-tags-v2/lang/en_us.json")?.toString("utf8") ?? "{}");
  } catch {
    // Names are a nicety.
  }
  return zipTags(zip, lang);
}

/**
 * The tags this mod's generated data pack fills, from the same code the generator runs, plus any tag files
 * written by hand in src/main/resources. Vanilla tags the mod only adds to are included too, with just the mod's entries.
 */
export async function modTags(root: string, project: Project, elements: ElementSpec[]): Promise<TagCatalog> {
  const catalog: TagCatalog = {};
  try {
    for (const [file, content] of resourceFiles(project, elements)) {
      const parsed = parseTagPath(file);
      if (!parsed || typeof content !== "string") continue;
      add(catalog, parsed[0], { id: parsed[1], values: entryValues(JSON.parse(content)) });
    }
  } catch {
    // Half-finished specs can trip the generator; the hand-written tags below still count.
  }
  const data = path.join(root, "src", "main", "resources", "data");
  for (const file of listFiles(data)) {
    const parsed = parseTagPath(`data/${path.relative(data, file).split(path.sep).join("/")}`);
    if (!parsed) continue;
    try {
      add(catalog, parsed[0], { id: parsed[1], values: entryValues(JSON.parse(await readFile(file, "utf8"))) });
    } catch {
      add(catalog, parsed[0], { id: parsed[1], values: [] });
    }
  }
  return sorted(catalog);
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? listFiles(path.join(dir, d.name)) : [path.join(dir, d.name)]));
}
