import {
  ARMOR_PIECES,
  TREE_PARTS,
  registeredItems,
  type ArmorSpec,
  type BiomeSpec,
  type BlockSpec,
  type ElementSpec,
  type ItemSpec,
  type MobSpec,
  type OreSpec,
  type PlantSpec,
  type Project,
  type RecipeSpec,
  type ToolSpec,
  type TreeSpec,
} from "../../schema.js";
import { repairTag } from "./java.js";
import { resolveRef } from "./refs.js";
import { STANDARD_CARVERS, STANDARD_FEATURES, STANDARD_SPAWNS, TREE_SHAPES, VEGETATION_STEP } from "./vanillaData.js";

export { resolveRef };

/** Files to write, keyed by path relative to `src/generated/resources`. Strings are text, `{ copy }` copies a project file. */
export type ResourceFiles = Map<string, string | { copy: string }>;

const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

type TagType = "block" | "item" | "worldgen/biome";

/** `minecraft:mineable/pickaxe` -> `data/minecraft/tags/<type>/mineable/pickaxe.json` */
function tagPath(modId: string, tag: string, type: TagType): string {
  const [ns, p] = resolveRef(modId, tag.replace(/^#/, "")).split(":");
  return `data/${ns}/tags/${type}/${p}.json`;
}

/** Collects lang entries and tag members while files are generated. */
class Output {
  readonly files: ResourceFiles = new Map();
  readonly lang: Record<string, string> = {};
  private readonly tags = new Map<string, string[]>();

  constructor(readonly modId: string) {}

  set(path: string, content: unknown) {
    this.files.set(path, typeof content === "string" ? content : json(content));
  }

  copy(from: string, to: string) {
    this.files.set(to, { copy: from });
  }

  tag(type: TagType, tag: string, value: string) {
    const file = tagPath(this.modId, tag, type);
    this.tags.set(file, [...(this.tags.get(file) ?? []), value]);
  }

  finish(): ResourceFiles {
    if (Object.keys(this.lang).length) this.set(`assets/${this.modId}/lang/en_us.json`, this.lang);
    for (const [file, values] of this.tags) this.set(file, { replace: false, values });
    return this.files;
  }
}

// ---- Loot tables (26.3 format: one `condition` and a `modifier` list per entry or pool) ----

const SURVIVES_EXPLOSION = { type: "minecraft:survives_explosion" };
const CAN_SHEAR = "minecraft:tool/can_shear";
const CAN_SILK_TOUCH = "minecraft:tool/can_silk_touch";

function blockLoot(modId: string, id: string, pools: unknown[]) {
  return { type: "minecraft:block", pools, random_sequence: `${modId}:blocks/${id}` };
}

/** The block drops itself unless blown up. */
function dropsSelf(modId: string, id: string) {
  return blockLoot(modId, id, [{ rolls: 1, condition: SURVIVES_EXPLOSION, entries: [{ type: "minecraft:item", name: `${modId}:${id}` }] }]);
}

function countModifier(min: number, max: number) {
  return { type: "minecraft:set_count", count: min === max ? min : { type: "minecraft:uniform", min, max } };
}

/** Fortune bonus chances at levels 0-3 (or 0-4), scaled from a vanilla table to start at `chance`. */
function fortuneChances(chance: number, vanilla: number[]): number[] {
  return vanilla.map((c) => Math.min(1, Number(((c / vanilla[0]) * chance).toFixed(6))));
}

// ---- Blocks and items ----

function blockModelFiles(out: Output, b: BlockSpec) {
  const modId = out.modId;
  out.set(`assets/${modId}/blockstates/${b.id}.json`, { variants: { "": { model: `${modId}:block/${b.id}` } } });
  const m = b.block.model;
  const modelPath = `assets/${modId}/models/block/${b.id}.json`;
  if (m.type === "cube_all") {
    out.set(modelPath, { parent: "minecraft:block/cube_all", textures: { all: `${modId}:block/${b.id}` } });
    out.copy(m.texture, `assets/${modId}/textures/block/${b.id}.png`);
  } else if (m.type === "cube_column") {
    out.set(modelPath, {
      parent: "minecraft:block/cube_column",
      textures: { side: `${modId}:block/${b.id}_side`, end: `${modId}:block/${b.id}_end` },
    });
    out.copy(m.side, `assets/${modId}/textures/block/${b.id}_side.png`);
    out.copy(m.end, `assets/${modId}/textures/block/${b.id}_end.png`);
  } else {
    out.copy(m.model, modelPath);
  }
  if (b.hasItem) blockItemModel(out, b.id);
}

function blockItemModel(out: Output, id: string, model = `${out.modId}:block/${id}`) {
  out.set(`assets/${out.modId}/items/${id}.json`, { model: { type: "minecraft:model", model } });
}

function blockFiles(out: Output, b: BlockSpec) {
  const modId = out.modId;
  blockModelFiles(out, b);
  out.lang[`block.${modId}.${b.id}`] = b.name;
  for (const t of b.tags) out.tag("block", t, `${modId}:${b.id}`);

  if (b.drops === "none") return;
  if (b.drops === "self") {
    out.set(`data/${modId}/loot_table/blocks/${b.id}.json`, dropsSelf(modId, b.id));
    return;
  }
  // Drops another item, like an ore: silk touch still drops the block itself.
  const d = b.drops;
  const modifier: unknown[] = [];
  if (d.min !== 1 || d.max !== 1) modifier.push(countModifier(d.min, d.max));
  if (d.fortune) modifier.push({ type: "minecraft:apply_bonus", enchantment: "minecraft:fortune", formula: "minecraft:ore_drops" });
  modifier.push({ type: "minecraft:explosion_decay" });
  const drop = { type: "minecraft:item", name: resolveRef(modId, d.item), modifier };
  const entry = b.hasItem
    ? { type: "minecraft:alternatives", children: [{ type: "minecraft:item", condition: CAN_SILK_TOUCH, name: `${modId}:${b.id}` }, drop] }
    : drop;
  out.set(`data/${modId}/loot_table/blocks/${b.id}.json`, blockLoot(modId, b.id, [{ rolls: 1, entries: [entry] }]));
}

/** An item drawn from one texture: `generated` lies flat, `handheld` is held like a tool. */
function flatItem(out: Output, id: string, texture: string, parent: "generated" | "handheld" = "generated") {
  const modId = out.modId;
  out.set(`assets/${modId}/items/${id}.json`, { model: { type: "minecraft:model", model: `${modId}:item/${id}` } });
  out.set(`assets/${modId}/models/item/${id}.json`, { parent: `minecraft:item/${parent}`, textures: { layer0: `${modId}:item/${id}` } });
  out.copy(texture, `assets/${modId}/textures/item/${id}.png`);
}

function itemFiles(out: Output, i: ItemSpec) {
  flatItem(out, i.id, i.item.texture);
  out.lang[`item.${out.modId}.${i.id}`] = i.name;
  for (const t of i.tags) out.tag("item", t, `${out.modId}:${i.id}`);
}

/** Vanilla item tags that make enchanting tables and anvils treat it as that tool. */
const TOOL_TAGS: Record<ToolSpec["tool"]["type"], string> = {
  sword: "minecraft:swords",
  pickaxe: "minecraft:pickaxes",
  axe: "minecraft:axes",
  shovel: "minecraft:shovels",
  hoe: "minecraft:hoes",
};

function repairItems(out: Output, id: string, item: string | undefined) {
  out.set(`data/${out.modId}/tags/item/${repairTag(id)}.json`, { replace: false, values: item ? [resolveRef(out.modId, item)] : [] });
}

function toolFiles(out: Output, t: ToolSpec) {
  const modId = out.modId;
  flatItem(out, t.id, t.tool.texture, "handheld");
  out.lang[`item.${modId}.${t.id}`] = t.name;
  for (const tag of [TOOL_TAGS[t.tool.type], ...t.tags]) out.tag("item", tag, `${modId}:${t.id}`);
  repairItems(out, t.id, t.tool.repairItem);
}

const ARMOR_TAGS: Record<(typeof ARMOR_PIECES)[number], string> = {
  helmet: "minecraft:head_armor",
  chestplate: "minecraft:chest_armor",
  leggings: "minecraft:leg_armor",
  boots: "minecraft:foot_armor",
};

function armorFiles(out: Output, a: ArmorSpec) {
  const modId = out.modId;
  for (const [id, name] of registeredItems(a)) {
    const piece = id.slice(a.id.length + 1) as (typeof ARMOR_PIECES)[number];
    flatItem(out, id, a.armor.pieces[piece]!);
    out.lang[`item.${modId}.${id}`] = name;
    for (const tag of [ARMOR_TAGS[piece], ...a.tags]) out.tag("item", tag, `${modId}:${id}`);
  }
  // How the armor looks when worn: an equipment asset pointing at the two layer textures.
  const texture = `${modId}:${a.id}`;
  out.set(`assets/${modId}/equipment/${a.id}.json`, {
    layers: {
      humanoid: [{ texture }],
      humanoid_leggings: [{ texture }],
    },
  });
  out.copy(a.armor.layer1, `assets/${modId}/textures/entity/equipment/humanoid/${a.id}.png`);
  out.copy(a.armor.layer2, `assets/${modId}/textures/entity/equipment/humanoid_leggings/${a.id}.png`);
  repairItems(out, a.id, a.armor.repairItem);
}

// ---- Trees ----

function treeFiles(out: Output, t: TreeSpec) {
  const modId = out.modId;
  const x = t.tree;
  const [log, planks, leaves, sapling] = TREE_PARTS.map(([suffix]) => `${t.id}_${suffix}`);
  for (const [suffix, label] of TREE_PARTS) out.lang[`block.${modId}.${t.id}_${suffix}`] = `${t.name} ${label}`;

  // Log: a column that can lie on its side.
  out.set(`assets/${modId}/blockstates/${log}.json`, {
    variants: {
      "axis=x": { model: `${modId}:block/${log}_horizontal`, x: 90, y: 90 },
      "axis=y": { model: `${modId}:block/${log}` },
      "axis=z": { model: `${modId}:block/${log}_horizontal`, x: 90 },
    },
  });
  const logTextures = { side: `${modId}:block/${log}`, end: `${modId}:block/${log}_top` };
  out.set(`assets/${modId}/models/block/${log}.json`, { parent: "minecraft:block/cube_column", textures: logTextures });
  out.set(`assets/${modId}/models/block/${log}_horizontal.json`, { parent: "minecraft:block/cube_column_horizontal", textures: logTextures });
  out.copy(x.logSide, `assets/${modId}/textures/block/${log}.png`);
  out.copy(x.logEnd, `assets/${modId}/textures/block/${log}_top.png`);

  // Planks and leaves: plain cubes. Leaves textures carry their own color, so no biome tint.
  for (const [id, art] of [[planks, x.planks], [leaves, x.leaves]] as const) {
    out.set(`assets/${modId}/blockstates/${id}.json`, { variants: { "": { model: `${modId}:block/${id}` } } });
    out.set(`assets/${modId}/models/block/${id}.json`, { parent: "minecraft:block/cube_all", textures: { all: `${modId}:block/${id}` } });
    out.copy(art, `assets/${modId}/textures/block/${id}.png`);
  }

  // Sapling: crossed planes, held as a flat icon.
  out.set(`assets/${modId}/blockstates/${sapling}.json`, { variants: { "": { model: `${modId}:block/${sapling}` } } });
  out.set(`assets/${modId}/models/block/${sapling}.json`, { parent: "minecraft:block/cross", textures: { cross: `${modId}:block/${sapling}` } });
  out.set(`assets/${modId}/models/item/${sapling}.json`, { parent: "minecraft:item/generated", textures: { layer0: `${modId}:block/${sapling}` } });
  out.copy(x.sapling, `assets/${modId}/textures/block/${sapling}.png`);
  blockItemModel(out, log);
  blockItemModel(out, planks);
  blockItemModel(out, leaves);
  blockItemModel(out, sapling, `${modId}:item/${sapling}`);

  // Tags: <id>_logs groups the log for recipes, like minecraft:oak_logs.
  const logsTag = `${modId}:${t.id}_logs`;
  for (const type of ["block", "item"] as const) {
    out.tag(type, logsTag, `${modId}:${log}`);
    out.tag(type, "minecraft:logs_that_burn", `#${logsTag}`);
    out.tag(type, "minecraft:planks", `${modId}:${planks}`);
    out.tag(type, "minecraft:leaves", `${modId}:${leaves}`);
    out.tag(type, "minecraft:saplings", `${modId}:${sapling}`);
  }
  out.tag("block", "minecraft:mineable/axe", `${modId}:${log}`);
  out.tag("block", "minecraft:mineable/axe", `${modId}:${planks}`);
  out.tag("block", "minecraft:mineable/hoe", `${modId}:${leaves}`);

  out.set(`data/${modId}/recipe/${planks}.json`, {
    type: "minecraft:crafting_shapeless",
    category: "building",
    group: "planks",
    ingredients: [`#${logsTag}`],
    result: { id: `${modId}:${planks}`, count: 4 },
  });

  for (const id of [log, planks, sapling]) out.set(`data/${modId}/loot_table/blocks/${id}.json`, dropsSelf(modId, id));
  const notShearing = { type: "minecraft:inverted", term: { type: "minecraft:any_of", terms: [CAN_SHEAR, CAN_SILK_TOUCH] } };
  const pools: unknown[] = [
    {
      rolls: 1,
      entries: [{
        type: "minecraft:alternatives",
        children: [
          { type: "minecraft:item", condition: { type: "minecraft:any_of", terms: [CAN_SHEAR, CAN_SILK_TOUCH] }, name: `${modId}:${leaves}` },
          {
            type: "minecraft:item",
            condition: {
              type: "minecraft:all_of",
              terms: [SURVIVES_EXPLOSION, { type: "minecraft:table_bonus", enchantment: "minecraft:fortune", chances: fortuneChances(x.saplingChance, [0.05, 0.0625, 0.083333336, 0.1]) }],
            },
            name: `${modId}:${sapling}`,
          },
        ],
      }],
    },
    {
      rolls: 1,
      condition: notShearing,
      entries: [{
        type: "minecraft:item",
        condition: { type: "minecraft:table_bonus", enchantment: "minecraft:fortune", chances: [0.02, 0.022222223, 0.025, 0.033333335, 0.1] },
        modifier: [countModifier(1, 2), { type: "minecraft:explosion_decay" }],
        name: "minecraft:stick",
      }],
    },
  ];
  if (x.fruit) {
    pools.push({
      rolls: 1,
      condition: notShearing,
      entries: [{
        type: "minecraft:item",
        condition: {
          type: "minecraft:all_of",
          terms: [SURVIVES_EXPLOSION, { type: "minecraft:table_bonus", enchantment: "minecraft:fortune", chances: fortuneChances(x.fruit.chance, [0.005, 0.0055555557, 0.00625, 0.008333334, 0.025]) }],
        },
        name: resolveRef(modId, x.fruit.item),
      }],
    });
  }
  out.set(`data/${modId}/loot_table/blocks/${leaves}.json`, blockLoot(modId, leaves, pools));

  // The tree the sapling grows, also placed by biomes.
  const shape = structuredClone(TREE_SHAPES[x.shape]) as Record<string, any>;
  if (x.trunkHeight !== undefined) shape.trunk_placer.base_height = x.trunkHeight;
  if (x.trunkHeightRandom !== undefined) shape.trunk_placer.height_rand_a = x.trunkHeightRandom;
  if (x.leafRadius !== undefined && typeof shape.foliage_placer.radius === "number") shape.foliage_placer.radius = x.leafRadius;
  out.set(`data/${modId}/worldgen/feature/${t.id}.json`, {
    type: "minecraft:tree",
    trunk_provider: { id: `${modId}:${log}`, properties: { axis: "y" } },
    foliage_provider: { id: `${modId}:${leaves}`, properties: { distance: "7", persistent: "false", waterlogged: "false" } },
    ...shape,
  });
}

// ---- Plants ----

function plantFiles(out: Output, p: PlantSpec) {
  const modId = out.modId;
  out.lang[`block.${modId}.${p.id}`] = p.name;
  for (const tag of p.tags) out.tag("block", tag, `${modId}:${p.id}`);
  out.set(`assets/${modId}/blockstates/${p.id}.json`, { variants: { "": { model: `${modId}:block/${p.id}` } } });
  out.set(`assets/${modId}/models/block/${p.id}.json`, { parent: "minecraft:block/cross", textures: { cross: `${modId}:block/${p.id}` } });
  out.set(`assets/${modId}/models/item/${p.id}.json`, { parent: "minecraft:item/generated", textures: { layer0: `${modId}:block/${p.id}` } });
  blockItemModel(out, p.id, `${modId}:item/${p.id}`);
  out.copy(p.plant.texture, `assets/${modId}/textures/block/${p.id}.png`);

  const self = `${modId}:${p.id}`;
  const children: unknown[] = [{ type: "minecraft:item", condition: CAN_SHEAR, name: self }];
  const d = p.plant.drops;
  if (d === "self") children.push({ type: "minecraft:item", name: self });
  else if (typeof d === "object") {
    children.push({
      type: "minecraft:item",
      condition: { type: "minecraft:random_chance", chance: d.chance },
      modifier: [{ type: "minecraft:explosion_decay" }],
      name: resolveRef(modId, d.item),
    });
  }
  out.set(`data/${modId}/loot_table/blocks/${p.id}.json`, blockLoot(modId, p.id, [{ rolls: 1, entries: [{ type: "minecraft:alternatives", children }] }]));
}

// ---- Mobs ----

function mobFiles(out: Output, m: MobSpec) {
  const modId = out.modId;
  out.lang[`entity.${modId}.${m.id}`] = m.name;
  out.lang[`item.${modId}.${m.id}_spawn_egg`] = `${m.name} Spawn Egg`;
  flatItem(out, `${m.id}_spawn_egg`, m.mob.spawnEgg);
  out.copy(m.mob.texture, `assets/${modId}/textures/entity/${m.id}.png`);
  out.copy(m.mob.babyTexture ?? m.mob.texture, `assets/${modId}/textures/entity/${m.id}_baby.png`);
  out.set(`data/${modId}/loot_table/entities/${m.id}.json`, {
    type: "minecraft:entity",
    pools: m.mob.drops.map((d) => ({
      rolls: 1,
      entries: [{
        type: "minecraft:item",
        name: resolveRef(modId, d.item),
        modifier: [
          countModifier(d.min, d.max),
          { type: "minecraft:enchanted_count_increase", enchantment: "minecraft:looting", count: { type: "minecraft:uniform", min: 0.0, max: 1.0 } },
        ],
      }],
    })),
    random_sequence: `${modId}:entities/${m.id}`,
  });
}

// ---- Biomes ----

/** `hostiles` holds the full ids of this mod's hostile mobs, which spawn as monsters (in the dark) instead of creatures. */
function biomeFiles(out: Output, b: BiomeSpec, hostiles: Set<string>) {
  const modId = out.modId;
  const x = b.biome;
  out.lang[`biome.${modId}.${b.id}`] = b.name;
  for (const tag of ["minecraft:is_overworld", ...b.tags]) out.tag("worldgen/biome", tag, `${modId}:${b.id}`);

  // Our trees and plant patches, placed per chunk.
  const vegetation: string[] = [];
  for (const { tree, perChunk } of x.trees) {
    const treeId = resolveRef(modId, tree);
    const sapling = `${treeId}_sapling`;
    const name = `${b.id}_${treeId.split(":")[1]}`;
    out.set(`data/${modId}/worldgen/placed_feature/${name}.json`, {
      feature: treeId,
      placement: [
        { type: "minecraft:count", count: perChunk },
        { type: "minecraft:in_square" },
        { type: "minecraft:surface_water_depth_filter", max_water_depth: 0 },
        { type: "minecraft:heightmap", heightmap: "OCEAN_FLOOR" },
        { type: "minecraft:block_predicate_filter", predicate: { type: "minecraft:would_survive", state: sapling } },
        { type: "minecraft:biome" },
      ],
    });
    vegetation.push(`${modId}:${name}`);
  }
  for (const { plant, patchesPerChunk } of x.plants) {
    const plantId = resolveRef(modId, plant);
    const name = `${b.id}_${plantId.split(":")[1]}`;
    out.set(`data/${modId}/worldgen/feature/${name}.json`, { type: "minecraft:simple_block", to_place: { id: plantId } });
    const spread = (max: number) => ({ type: "minecraft:trapezoid", min: -max, max, plateau: 0 });
    out.set(`data/${modId}/worldgen/placed_feature/${name}.json`, {
      feature: `${modId}:${name}`,
      placement: [
        { type: "minecraft:count", count: patchesPerChunk },
        { type: "minecraft:in_square" },
        { type: "minecraft:heightmap", heightmap: "WORLD_SURFACE_WG" },
        { type: "minecraft:biome" },
        { type: "minecraft:count", count: 32 },
        { type: "minecraft:offset", x: spread(7), y: spread(3), z: spread(7) },
        { type: "minecraft:block_predicate_filter", predicate: { type: "minecraft:matching_block_tag", tag: "minecraft:air" } },
      ],
    });
    vegetation.push(`${modId}:${name}`);
  }

  const features = STANDARD_FEATURES.map((step) => [...step]);
  features[VEGETATION_STEP] = [...features[VEGETATION_STEP], ...vegetation, ...x.vanillaFeatures.map((f) => resolveRef("minecraft", f))];

  const entry = (s: (typeof x.spawns)[number]) => ({
    type: resolveRef(modId, s.mob),
    count: s.min === s.max ? s.min : { type: "minecraft:uniform", min_inclusive: s.min, max_inclusive: s.max },
    weight: s.weight,
  });
  const isHostile = (s: (typeof x.spawns)[number]) => hostiles.has(resolveRef(modId, s.mob));
  const creature = x.spawns.filter((s) => !isHostile(s)).map(entry);
  const ourMonsters = x.spawns.filter(isHostile).map(entry);
  const monster = [...STANDARD_SPAWNS.monster, ...ourMonsters];
  const attributes: Record<string, unknown> = {
    "minecraft:gameplay/natural_mob_spawns": {
      argument: { spawn_costs: {}, spawns_by_category: { ...STANDARD_SPAWNS, monster, creature } },
      modifier: "overlay",
    },
    "minecraft:visual/sky_color": x.colors.sky,
  };
  if (x.colors.fog) attributes["minecraft:visual/fog_color"] = x.colors.fog;
  if (x.colors.waterFog) attributes["minecraft:visual/water_fog_color"] = x.colors.waterFog;
  const effects: Record<string, string> = { water_color: x.colors.water };
  if (x.colors.grass) effects.grass_color = x.colors.grass;
  if (x.colors.foliage) effects.foliage_color = x.colors.foliage;

  out.set(`data/${modId}/worldgen/biome/${b.id}.json`, {
    attributes,
    carvers: STANDARD_CARVERS,
    downfall: x.downfall,
    effects,
    features,
    has_precipitation: x.precipitation,
    temperature: x.temperature,
  });

  // Biolith reads this from data packs and swaps part of each vanilla biome for this one.
  out.set(`data/${modId}/biolith/biome_placement/${b.id}.json`, {
    replacements: x.replaces.map((r) => ({
      dimension: "minecraft:overworld",
      target: resolveRef("minecraft", r.biome),
      biome: `${modId}:${b.id}`,
      proportion: r.share,
    })),
  });
}

// ---- Recipes and ores ----

const COOKING_TYPES: Record<string, string> = {
  smelting: "minecraft:smelting",
  blasting: "minecraft:blasting",
  smoking: "minecraft:smoking",
  campfire_cooking: "minecraft:campfire_cooking",
};

export function recipeJson(modId: string, spec: RecipeSpec): unknown {
  const r = spec.recipe;
  const result = { id: resolveRef(modId, r.result.item), count: r.result.count };
  if (r.type === "shaped") {
    return {
      type: "minecraft:crafting_shaped",
      category: "misc",
      pattern: r.pattern,
      key: Object.fromEntries(Object.entries(r.key).map(([k, v]) => [k, resolveRef(modId, v)])),
      result,
    };
  }
  if (r.type === "shapeless") {
    return {
      type: "minecraft:crafting_shapeless",
      category: "misc",
      ingredients: r.ingredients.map((v) => resolveRef(modId, v)),
      result,
    };
  }
  return {
    type: COOKING_TYPES[r.type],
    category: "misc",
    ingredient: resolveRef(modId, r.ingredient),
    result,
    experience: r.experience,
    cookingtime: r.cookingTime,
  };
}

const ORE_TARGETS: Record<OreSpec["ore"]["replaces"], { host: "stone" | "deepslate"; test: unknown }[]> = {
  stone: [{ host: "stone", test: { predicate_type: "minecraft:tag_match", tag: "minecraft:stone_ore_replaceables" } }],
  deepslate: [{ host: "deepslate", test: { predicate_type: "minecraft:tag_match", tag: "minecraft:deepslate_ore_replaceables" } }],
  stone_and_deepslate: [
    { host: "stone", test: { predicate_type: "minecraft:tag_match", tag: "minecraft:stone_ore_replaceables" } },
    { host: "deepslate", test: { predicate_type: "minecraft:tag_match", tag: "minecraft:deepslate_ore_replaceables" } },
  ],
  netherrack: [{ host: "stone", test: { predicate_type: "minecraft:block_match", block: "minecraft:netherrack" } }],
  end_stone: [{ host: "stone", test: { predicate_type: "minecraft:block_match", block: "minecraft:end_stone" } }],
};

/**
 * An ore vein: a feature (26.3 moved configured features to `worldgen/feature` and inlined their config)
 * and a placed feature that says how many veins per chunk and at what heights.
 */
function oreFiles(out: Output, o: OreSpec) {
  const modId = out.modId;
  const block = resolveRef(modId, o.ore.block);
  const deepslate = resolveRef(modId, o.ore.deepslateBlock ?? o.ore.block);
  out.set(`data/${modId}/worldgen/feature/${o.id}.json`, {
    type: "minecraft:ore",
    size: o.ore.veinSize,
    discard_chance_on_air_exposure: o.ore.airExposureSkip,
    targets: ORE_TARGETS[o.ore.replaces].map((t) => ({
      target: t.test,
      state: t.host === "deepslate" ? deepslate : block,
    })),
  });
  const range = { min_inclusive: { absolute: o.ore.minY }, max_inclusive: { absolute: o.ore.maxY } };
  out.set(`data/${modId}/worldgen/placed_feature/${o.id}.json`, {
    feature: `${modId}:${o.id}`,
    placement: [
      { type: "minecraft:count", count: o.ore.veinsPerChunk },
      { type: "minecraft:in_square" },
      {
        type: "minecraft:height_range",
        height: o.ore.distribution === "uniform" ? { type: "minecraft:uniform", ...range } : { type: "minecraft:trapezoid", ...range },
      },
      { type: "minecraft:biome" },
    ],
  });
}

/** Every generated resource file for the project. */
export function resourceFiles(project: Project, elements: ElementSpec[]): ResourceFiles {
  const out = new Output(project.modId);
  const hostiles = new Set(elements.flatMap((e) => (e.kind === "mob" && e.mob.behavior === "hostile" ? [`${project.modId}:${e.id}`] : [])));
  for (const e of elements) {
    switch (e.kind) {
      case "block": blockFiles(out, e); break;
      case "item": itemFiles(out, e); break;
      case "tool": toolFiles(out, e); break;
      case "armor": armorFiles(out, e); break;
      case "tree": treeFiles(out, e); break;
      case "plant": plantFiles(out, e); break;
      case "mob": mobFiles(out, e); break;
      case "biome": biomeFiles(out, e, hostiles); break;
      case "ore": oreFiles(out, e); break;
      case "recipe": out.set(`data/${project.modId}/recipe/${e.id}.json`, recipeJson(project.modId, e)); break;
    }
  }
  return out.finish();
}
