import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipIds, zipTags, type TagCatalog } from "./tags.js";
import { ZipFile } from "./zip.js";

/**
 * How to draw an item in a GUI slot. Textures are PNG data URLs, possibly animation strips
 * (taller than wide), in which case the top square is the first frame.
 */
export type ItemIcon = { kind: "flat"; texture: string } | { kind: "cube"; top: string; left: string; right: string };

export interface CatalogEntry {
  /** `minecraft:stick`, or `#minecraft:planks` for a tag. */
  id: string;
  name: string;
}

/** Where a Minecraft client jar for `version` usually is: Loom's cache first, then Prism and the official launcher. */
export function minecraftJarCandidates(version: string): string[] {
  const home = os.homedir();
  const gradle = process.env.GRADLE_USER_HOME ?? path.join(home, ".gradle");
  const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
  const lib = (prism: string) => path.join(prism, "libraries", "com", "mojang", "minecraft", version, `minecraft-${version}-client.jar`);
  return [
    path.join(gradle, "caches", "fabric-loom", version, "minecraft-client.jar"),
    lib(path.join(appData, "PrismLauncher")),
    lib(path.join(home, ".local", "share", "PrismLauncher")),
    lib(path.join(home, "Library", "Application Support", "PrismLauncher")),
    path.join(appData, ".minecraft", "versions", version, `${version}.jar`),
    path.join(home, ".minecraft", "versions", version, `${version}.jar`),
    path.join(home, "Library", "Application Support", "minecraft", "versions", version, `${version}.jar`),
  ];
}

export function findMinecraftJar(version: string): string | null {
  return minecraftJarCandidates(version).find((p) => existsSync(p)) ?? null;
}

const titleCase = (s: string) => s.split(/[_/]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

/** `minecraft:block/stone` -> [`minecraft`, `block/stone`]; a missing namespace means `minecraft`. */
function split(id: string): [string, string] {
  const i = id.indexOf(":");
  return i < 0 ? ["minecraft", id] : [id.slice(0, i), id.slice(i + 1)];
}

/** A vanilla ore, geode or disk turned into spec fields, to start an ore from. Its blocks are left out except a geode's and disk's surroundings. */
export interface OrePreset {
  /** The placed feature's id, like `minecraft:ore_diamond_large`. */
  id: string;
  name: string;
  /** Fields for a spec's `ore` object. */
  ore: Record<string, unknown>;
}

/** Lowest and highest Y of the Overworld; the Nether and the End run from 0 to 255. */
const OVERWORLD: [number, number] = [-64, 319];
const NETHER_OR_END: [number, number] = [0, 255];
const SHAPES: Record<string, string> = { "minecraft:ore": "blob", "minecraft:scattered_ore": "scattered", "minecraft:disk": "disk", "minecraft:geode": "geode" };

/** A vertical anchor (`{ absolute }`, `{ above_bottom }`, `{ below_top }`) as a Y in a dimension, kept in the spec's -64..320. */
function anchorY(a: any, [bottom, top]: [number, number]): number | null {
  const y = typeof a?.absolute === "number" ? a.absolute : typeof a?.above_bottom === "number" ? bottom + a.above_bottom : typeof a?.below_top === "number" ? top - a.below_top : null;
  return y === null ? null : Math.max(-64, Math.min(320, y));
}

/** An int provider (a number or `{ type, min_inclusive, max_inclusive }`) as its range. */
function intRange(p: any): [number, number] | null {
  if (typeof p === "number") return [p, p];
  if (typeof p?.value === "number") return [p.value, p.value];
  if (typeof p?.min_inclusive === "number" && typeof p?.max_inclusive === "number") return [p.min_inclusive, p.max_inclusive];
  return null;
}

const blockId = (state: any): string | null => (typeof state === "string" ? state : typeof state?.id === "string" ? state.id : typeof state?.Name === "string" ? state.Name : null);

/** Which host a vanilla ore's targets replace, read from the tags and blocks its rules test. */
function oreHost(targets: any[]): string {
  const text = JSON.stringify(targets);
  if (text.includes("netherrack") || text.includes("base_stone_nether")) return "netherrack";
  if (text.includes("end_stone")) return "end_stone";
  const stone = text.includes("stone_ore_replaceables");
  const deep = text.includes("deepslate_ore_replaceables");
  return stone && deep ? "stone_and_deepslate" : deep ? "deepslate" : "stone";
}

/**
 * Spec fields for a vanilla placed feature and the feature it places, or null when the feature isn't a shape
 * the ore spec has. Read from the jar so the list follows the game version.
 */
export function vanillaOrePreset(id: string, placed: any, feature: any): OrePreset | null {
  const shape = SHAPES[feature?.type];
  if (!shape || !Array.isArray(placed?.placement)) return null;
  const ore: Record<string, unknown> = { shape };
  if (shape === "blob" || shape === "scattered") {
    if (typeof feature.size === "number") ore.veinSize = Math.max(1, Math.min(64, feature.size));
    ore.airExposureSkip = feature.discard_chance_on_air_exposure ?? 0;
    ore.replaces = oreHost(feature.targets ?? []);
  } else if (shape === "disk") {
    const radius = intRange(feature.radius);
    const state = blockId(feature.state_provider?.fallback ?? feature.state_provider);
    const targets: unknown[] = typeof feature.target?.blocks === "string" ? [feature.target.blocks] : (feature.target?.blocks ?? []);
    ore.disk = {
      radiusMin: Math.max(1, Math.min(8, radius?.[0] ?? 2)),
      radiusMax: Math.max(1, Math.min(8, radius?.[1] ?? 3)),
      halfHeight: Math.max(0, Math.min(4, feature.half_height ?? 1)),
      replaces: targets.filter((b): b is string => typeof b === "string" && b !== state),
    };
  } else {
    const b = feature.blocks ?? {};
    const chance = feature.use_alternate_layer0_chance ?? 0;
    const crystals = (b.inner_placements ?? []).map(blockId).filter(Boolean);
    ore.geode = {
      outerBlock: blockId(b.outer_layer_provider) ?? "minecraft:smooth_basalt",
      middleBlock: blockId(b.middle_layer_provider) ?? "minecraft:calcite",
      ...(chance > 0 && blockId(b.alternate_inner_layer_provider) ? { buddingBlock: blockId(b.alternate_inner_layer_provider) } : {}),
      buddingChance: chance,
      crystals: chance > 0 ? crystals : [],
      crackChance: feature.crack?.generate_crack_chance ?? 0.95,
    };
  }
  const world = ore.replaces === "netherrack" || ore.replaces === "end_stone" ? NETHER_OR_END : OVERWORLD;
  for (const step of placed.placement) {
    if (step?.type === "minecraft:count") {
      const count = intRange(step.count);
      if (count) ore.veinsPerChunk = Math.max(1, Math.min(128, Math.round((count[0] + count[1]) / 2)));
    } else if (step?.type === "minecraft:rarity_filter" && typeof step.chance === "number") {
      ore.chunksPerVein = Math.max(1, Math.min(1000, step.chance));
    } else if (step?.type === "minecraft:height_range") {
      const h = step.height ?? {};
      const min = anchorY(h.min_inclusive, world);
      const max = anchorY(h.max_inclusive, world);
      if (min !== null && max !== null) {
        ore.minY = min;
        ore.maxY = max;
        ore.distribution = h.type === "minecraft:trapezoid" ? "triangle" : "uniform";
      }
    }
  }
  if (ore.veinsPerChunk === undefined && ore.chunksPerVein === undefined) ore.veinsPerChunk = 1;
  return { id, name: titleCase(split(id)[1]), ore };
}

/** Item names, icons and tags read straight from a Minecraft client jar, so nothing from Mojang is shipped with the tool. */
export class VanillaAssets {
  private lang: Record<string, string>;
  private icons = new Map<string, ItemIcon | null>();
  private catalogCache: { items: CatalogEntry[]; tags: CatalogEntry[]; orePresets: OrePreset[] } | null = null;
  private tagCache: TagCatalog | null = null;
  private idCache = new Map<string, string[]>();
  private textureList: string[] | null = null;

  constructor(private readonly zip: ZipFile) {
    this.lang = this.json("assets/minecraft/lang/en_us.json") ?? {};
  }

  static async open(jar: string): Promise<VanillaAssets> {
    return new VanillaAssets(await ZipFile.open(jar));
  }

  private json(name: string): any {
    const data = this.zip.read(name);
    if (!data) return null;
    try {
      return JSON.parse(data.toString("utf8"));
    } catch {
      return null;
    }
  }

  /** Every item and item tag in the game, sorted by display name, and the game's ores, geodes and disks. */
  catalog(): { items: CatalogEntry[]; tags: CatalogEntry[]; orePresets: OrePreset[] } {
    if (this.catalogCache) return this.catalogCache;
    const items: CatalogEntry[] = [];
    const tags: CatalogEntry[] = [];
    const orePresets: OrePreset[] = [];
    for (const name of this.zip.names()) {
      const placed = /^data\/minecraft\/worldgen\/placed_feature\/([a-z0-9_]+)\.json$/.exec(name);
      if (placed) {
        const json = this.json(name);
        const feature = typeof json?.feature === "string" ? this.json(`data/minecraft/worldgen/feature/${split(json.feature)[1]}.json`) : null;
        const preset = feature && vanillaOrePreset(`minecraft:${placed[1]}`, json, feature);
        if (preset) orePresets.push(preset);
      }
      let m = /^assets\/minecraft\/items\/([a-z0-9_]+)\.json$/.exec(name);
      if (m && m[1] !== "air") items.push({ id: `minecraft:${m[1]}`, name: this.name(`minecraft:${m[1]}`) });
      m = /^data\/minecraft\/tags\/item\/([a-z0-9_/]+)\.json$/.exec(name);
      if (m) tags.push({ id: `#minecraft:${m[1]}`, name: this.name(`#minecraft:${m[1]}`) });
    }
    const byName = (a: CatalogEntry, b: CatalogEntry) => a.name.localeCompare(b.name);
    this.catalogCache = { items: items.sort(byName), tags: tags.sort(byName), orePresets: orePresets.sort(byName) };
    return this.catalogCache;
  }

  /** Every tag file in the jar, by registry: block, item, entity_type, worldgen/biome and the rest. */
  tags(): TagCatalog {
    return (this.tagCache ??= zipTags(this.zip));
  }

  /** Ids in a data-driven registry: `worldgen/biome` gives `minecraft:plains` and the rest. */
  ids(registry: string): string[] {
    if (!this.idCache.has(registry)) this.idCache.set(registry, zipIds(this.zip, registry));
    return this.idCache.get(registry)!;
  }

  /** Every texture in the jar as an id like `minecraft:block/iron_ore`, sorted, for picking one to tint. */
  textures(): string[] {
    this.textureList ??= [...this.zip.names()]
      .map((name) => /^assets\/minecraft\/textures\/([a-z0-9_./-]+)\.png$/.exec(name)?.[1])
      .filter((p): p is string => !!p)
      .map((p) => `minecraft:${p}`)
      .sort();
    return this.textureList;
  }

  /** One texture's PNG bytes, by the same kind of id. */
  texture(id: string): Buffer | null {
    const [ns, p] = split(id);
    if (!/^[a-z0-9_./-]+$/.test(p) || p.includes("..")) return null;
    return this.zip.read(`assets/${ns}/textures/${p}.png`);
  }

  /** English display name: `minecraft:glowstone` -> `Glowstone`, `#minecraft:planks` -> `Any Planks`. */
  name(id: string): string {
    if (id.startsWith("#")) return `Any ${titleCase(split(id.slice(1))[1])}`;
    const [ns, p] = split(id);
    return this.lang[`item.${ns}.${p}`] ?? this.lang[`block.${ns}.${p}`] ?? titleCase(p);
  }

  /** The icon for an item id or item tag (a tag shows its first item). Null when the jar doesn't know it. */
  icon(id: string): ItemIcon | null {
    if (!this.icons.has(id)) this.icons.set(id, this.resolveIcon(id, 0));
    return this.icons.get(id)!;
  }

  private resolveIcon(id: string, depth: number): ItemIcon | null {
    if (depth > 8) return null;
    if (id.startsWith("#")) {
      const [ns, p] = split(id.slice(1));
      const first = this.json(`data/${ns}/tags/item/${p}.json`)?.values?.[0];
      const ref = typeof first === "string" ? first : first?.id;
      return typeof ref === "string" ? this.resolveIcon(ref, depth + 1) : null;
    }
    const [ns, p] = split(id);
    const def = this.json(`assets/${ns}/items/${p}.json`);
    const model = def && findModel(def.model);
    return model ? this.modelIcon(model) : null;
  }

  /** Follow a model's parents, collecting textures, then decide between a flat sprite and a cube. */
  private modelIcon(modelId: string): ItemIcon | null {
    const textures: Record<string, string> = {};
    const chain: string[] = [];
    let current: string | undefined = modelId;
    while (current && chain.length < 16) {
      const [ns, p] = split(current);
      chain.push(`${ns}:${p}`);
      const model = this.json(`assets/${ns}/models/${p}.json`);
      if (!model) break;
      for (const [k, v] of Object.entries<any>(model.textures ?? {})) {
        // A texture is either `"minecraft:block/stone"` or `{ "sprite": "...", "force_translucent": true }`.
        const sprite = typeof v === "string" ? v : v?.sprite;
        if (!(k in textures) && typeof sprite === "string") textures[k] = sprite;
      }
      current = model.parent;
    }
    const tex = (key: string): string | null => {
      let v: string | undefined = textures[key];
      for (let i = 0; v?.startsWith("#") && i < 8; i++) v = textures[v.slice(1)];
      if (!v || v.startsWith("#")) return null;
      const [ns, p] = split(v);
      const png = this.zip.read(`assets/${ns}/textures/${p}.png`);
      return png ? `data:image/png;base64,${png.toString("base64")}` : null;
    };
    const flat = chain.some((m) => m === "minecraft:item/generated" || m === "minecraft:builtin/generated");
    if (flat) {
      const layer0 = tex("layer0");
      return layer0 ? { kind: "flat", texture: layer0 } : null;
    }
    const side = tex("side") ?? tex("all") ?? tex("texture") ?? tex("particle");
    const top = tex("top") ?? tex("end") ?? tex("all") ?? side;
    const isBlock = chain.some((m) => m.startsWith("minecraft:block/"));
    if (isBlock && side && top && ("side" in textures || "all" in textures || "end" in textures || "top" in textures)) {
      return { kind: "cube", top, left: tex("front") ?? side, right: side };
    }
    const any = tex("particle") ?? tex("layer0") ?? Object.keys(textures).map(tex).find(Boolean) ?? null;
    return any ? { kind: "flat", texture: any } : null;
  }
}

/** The first plain model id in an item definition, looking through selects, conditions and special models. */
function findModel(node: any): string | null {
  if (!node || typeof node !== "object") return null;
  if (typeof node.model === "string" && node.type !== "minecraft:special") return node.model;
  if (typeof node.base === "string") return node.base;
  for (const v of Object.values(node)) {
    const found = Array.isArray(v) ? v.map(findModel).find(Boolean) : findModel(v);
    if (found) return found;
  }
  return null;
}
