import {
  ARMOR_PIECES,
  type AdvancementSpec,
  type StructureSpec,
  type SoundSpec,
  type EffectSpec,
  type EnchantmentSpec,
  type Criterion,
  TREE_PARTS,
  registeredItems,
  shapeBlocks,
  type ShapeKind,
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
  type CustomTreeLayout,
} from "../../schema.js";
import { potionVariants, repairTag } from "./java.js";
import { resolveRef } from "./refs.js";
import { SHAPE_BLOCKSTATES } from "./shapeStates.js";
import { STANDARD_CARVERS, STANDARD_FEATURES, STANDARD_SPAWNS, VEGETATION_STEP } from "./vanillaData.js";
import { layoutBlocks, leafDistances, vanillaTreeConfig } from "../../trees.js";

export { resolveRef };

/** Files to write, keyed by path relative to `src/generated/resources`. Strings are text, `{ copy }` copies a project file. */
export type ResourceFiles = Map<string, string | { copy: string }>;

const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

type TagType = "block" | "item" | "worldgen/biome" | "enchantment";

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

/** Model files per shape: model path suffix, vanilla parent, and which textures it takes. */
const SHAPE_MODELS: Record<ShapeKind, [string, string, "slab" | "side" | "wall" | "door" | "trapdoor"][]> = {
  stairs: [["", "stairs", "slab"], ["_inner", "inner_stairs", "slab"], ["_outer", "outer_stairs", "slab"]],
  slab: [["", "slab", "slab"], ["_top", "slab_top", "slab"]],
  wall: [["_post", "template_wall_post", "wall"], ["_side", "template_wall_side", "wall"], ["_side_tall", "template_wall_side_tall", "wall"], ["_inventory", "wall_inventory", "wall"]],
  fence: [["_post", "fence_post", "side"], ["_side", "fence_side", "side"], ["_inventory", "fence_inventory", "side"]],
  fenceGate: [["", "template_fence_gate", "side"], ["_open", "template_fence_gate_open", "side"], ["_wall", "template_fence_gate_wall", "side"], ["_wall_open", "template_fence_gate_wall_open", "side"]],
  door: ["bottom_left", "bottom_left_open", "bottom_right", "bottom_right_open", "top_left", "top_left_open", "top_right", "top_right_open"].map((m) => [`_${m}`, `door_${m}`, "door"]),
  trapdoor: [["_bottom", "template_trapdoor_bottom", "trapdoor"], ["_top", "template_trapdoor_top", "trapdoor"], ["_open", "template_trapdoor_open", "trapdoor"]],
  button: [["", "button", "side"], ["_pressed", "button_pressed", "side"], ["_inventory", "button_inventory", "side"]],
  pressurePlate: [["", "pressure_plate_up", "side"], ["_down", "pressure_plate_down", "side"]],
};

/** The model an item shows in the inventory, as a suffix of the block's model path. */
const SHAPE_ITEM_MODEL: Partial<Record<ShapeKind, string>> = { wall: "_inventory", fence: "_inventory", trapdoor: "_bottom", button: "_inventory" };

/** Vanilla tags for each shape, and the extra tag wooden or stone ones join. */
const SHAPE_TAGS: Record<ShapeKind, [string, string | null, string | null]> = {
  stairs: ["minecraft:stairs", "minecraft:wooden_stairs", null],
  slab: ["minecraft:slabs", "minecraft:wooden_slabs", null],
  wall: ["minecraft:walls", null, null],
  fence: ["minecraft:fences", "minecraft:wooden_fences", null],
  fenceGate: ["minecraft:fence_gates", null, null],
  door: ["minecraft:doors", "minecraft:wooden_doors", null],
  trapdoor: ["minecraft:trapdoors", "minecraft:wooden_trapdoors", null],
  button: ["minecraft:buttons", "minecraft:wooden_buttons", "minecraft:stone_buttons"],
  pressurePlate: ["minecraft:pressure_plates", "minecraft:wooden_pressure_plates", "minecraft:stone_pressure_plates"],
};

/** Crafting recipe per shape from the base block `#` (and sticks `S`): pattern (or null for shapeless), count, category. */
const SHAPE_RECIPES: Record<ShapeKind, [string[] | null, number, string]> = {
  stairs: [["#  ", "## ", "###"], 4, "building"],
  slab: [["###"], 6, "building"],
  wall: [["###", "###"], 6, "misc"],
  fence: [["#S#", "#S#"], 3, "misc"],
  fenceGate: [["S#S", "S#S"], 1, "redstone"],
  door: [["##", "##", "##"], 3, "redstone"],
  trapdoor: [["###", "###"], 2, "redstone"],
  button: [null, 1, "redstone"],
  pressurePlate: [["##"], 1, "redstone"],
};

/** How many a stonecutter makes from one base block, for shapes vanilla stonecuts. */
const STONECUT: Partial<Record<ShapeKind, number>> = { stairs: 1, slab: 2, wall: 1 };

/**
 * Stairs, slabs, doors and the rest for a block or a tree's planks. `textures` are the base block's texture ids;
 * `mineTags` are the base's mineable and tool level tags, which the shapes share.
 */
function shapeFiles(
  out: Output,
  spec: BlockSpec | TreeSpec,
  base: { id: string; hasItem: boolean; wood: boolean; textures: { side: string; end: string }; mineTags: string[] },
) {
  const modId = out.modId;
  const baseRef = `${modId}:${base.id}`;
  for (const b of shapeBlocks(spec)) {
    const model = `${modId}:block/${b.id}`;
    // A double slab looks like the base block.
    const state = b.shape === "slab"
      ? { variants: { "type=bottom": { model }, "type=double": { model: `${modId}:block/${base.id}` }, "type=top": { model: `${model}_top` } } }
      : JSON.parse(JSON.stringify(SHAPE_BLOCKSTATES[b.shape]).replaceAll('"@', `"${model}`));
    out.set(`assets/${modId}/blockstates/${b.id}.json`, state);
    const art: Record<string, Record<string, string>> = {
      slab: { bottom: base.textures.end, top: base.textures.end, side: base.textures.side },
      side: { texture: base.textures.side },
      wall: { wall: base.textures.side },
      door: { bottom: `${modId}:block/${b.id}_bottom`, top: `${modId}:block/${b.id}_top` },
      trapdoor: { texture: `${modId}:block/${b.id}` },
    };
    for (const [suffix, parent, textures] of SHAPE_MODELS[b.shape]) {
      out.set(`assets/${modId}/models/block/${b.id}${suffix}.json`, { parent: `minecraft:block/${parent}`, textures: art[textures] });
    }
    if (b.shape === "door") {
      const door = spec.shapes.door!;
      out.copy(door.top, `assets/${modId}/textures/block/${b.id}_top.png`);
      out.copy(door.bottom, `assets/${modId}/textures/block/${b.id}_bottom.png`);
      flatItem(out, b.id, door.icon);
    } else {
      if (b.shape === "trapdoor") out.copy(spec.shapes.trapdoor!, `assets/${modId}/textures/block/${b.id}.png`);
      blockItemModel(out, b.id, model + (SHAPE_ITEM_MODEL[b.shape] ?? ""));
    }
    out.lang[`block.${modId}.${b.id}`] = b.name;

    const [tag, woodTag, stoneTag] = SHAPE_TAGS[b.shape];
    for (const t of [tag, base.wood ? woodTag : stoneTag]) {
      if (!t) continue;
      out.tag("block", t, `${modId}:${b.id}`);
      out.tag("item", t, `${modId}:${b.id}`);
    }
    for (const t of base.mineTags) out.tag("block", t, `${modId}:${b.id}`);

    // Loot: slabs drop two when doubled, doors drop from their lower half only.
    const id = `${modId}:${b.id}`;
    if (b.shape === "slab") {
      const doubled = { type: "minecraft:match_block", blocks: id, state: { type: "double" } };
      out.set(`data/${modId}/loot_table/blocks/${b.id}.json`, blockLoot(modId, b.id, [{
        rolls: 1,
        entries: [{ type: "minecraft:item", name: id, modifier: [{ type: "minecraft:set_count", condition: doubled, count: 2 }, { type: "minecraft:explosion_decay" }] }],
      }]));
    } else if (b.shape === "door") {
      const lower = { type: "minecraft:match_block", blocks: id, state: { half: "lower" } };
      out.set(`data/${modId}/loot_table/blocks/${b.id}.json`, blockLoot(modId, b.id, [{ rolls: 1, condition: SURVIVES_EXPLOSION, entries: [{ type: "minecraft:item", condition: lower, name: id }] }]));
    } else {
      out.set(`data/${modId}/loot_table/blocks/${b.id}.json`, dropsSelf(modId, b.id));
    }

    if (!base.hasItem) continue;
    const [pattern, count, category] = SHAPE_RECIPES[b.shape];
    const result = { id, count };
    out.set(
      `data/${modId}/recipe/${b.id}.json`,
      pattern
        ? { type: "minecraft:crafting_shaped", category, key: pattern.some((r) => r.includes("S")) ? { "#": baseRef, S: "minecraft:stick" } : { "#": baseRef }, pattern, result }
        : { type: "minecraft:crafting_shapeless", category, ingredients: [baseRef], result },
    );
    const cut = STONECUT[b.shape];
    if (cut && !base.wood) {
      out.set(`data/${modId}/recipe/${b.id}_from_${base.id}_stonecutting.json`, { type: "minecraft:stonecutting", ingredient: baseRef, result: { id, count: cut } });
    }
  }
}

const MINE_TAG = /^minecraft:(mineable\/|needs_)/;

function blockFiles(out: Output, b: BlockSpec) {
  const modId = out.modId;
  blockModelFiles(out, b);
  const m = b.block.model;
  if (m.type !== "custom") {
    const textures = m.type === "cube_all"
      ? { side: `${modId}:block/${b.id}`, end: `${modId}:block/${b.id}` }
      : { side: `${modId}:block/${b.id}_side`, end: `${modId}:block/${b.id}_end` };
    shapeFiles(out, b, { id: b.id, hasItem: b.hasItem, wood: b.block.sound === "wood", textures, mineTags: b.tags.filter((t) => MINE_TAG.test(t)) });
  }
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
  const plankTexture = `${modId}:block/${planks}`;
  shapeFiles(out, t, { id: planks, hasItem: true, wood: true, textures: { side: plankTexture, end: plankTexture }, mineTags: ["minecraft:mineable/axe"] });
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
  const logState = { id: `${modId}:${log}`, properties: { axis: "y" } };
  const leavesState = { id: `${modId}:${leaves}`, properties: { distance: "7", persistent: "false", waterlogged: "false" } };
  if (x.shape === "custom" && x.custom) {
    out.set(`data/${modId}/worldgen/feature/${t.id}.json`, customTreeFeature(modId, log, leaves, x.custom));
  } else {
    out.set(`data/${modId}/worldgen/feature/${t.id}.json`, {
      type: "minecraft:tree",
      trunk_provider: logState,
      foliage_provider: leavesState,
      below_trunk_provider: "minecraft:soil_beneath_tree",
      decorators: [],
      ignore_vines: true,
      ...vanillaTreeConfig(x),
    });
  }
}

/**
 * A hand-built tree, placed by the generated CustomTreeFeature: logs by axis, and leaves grouped by their
 * distance to a log (first list is 1 block away), so they get the distance the game would give them.
 */
function customTreeFeature(modId: string, log: string, leaves: string, layout: CustomTreeLayout) {
  const blocks = layoutBlocks(layout);
  const at = (axis: string) => blocks.filter((b) => b.kind === "log" && b.axis === axis).map((b) => [b.x, b.y, b.z]);
  const distances = leafDistances(blocks);
  const byDistance: number[][][] = Array.from({ length: 7 }, () => []);
  for (const b of blocks) if (b.kind === "leaves") byDistance[distances.get(`${b.x},${b.y},${b.z}`)! - 1].push([b.x, b.y, b.z]);
  while (byDistance.length && !byDistance[byDistance.length - 1].length) byDistance.pop();
  return {
    type: `${modId}:custom_tree`,
    log: `${modId}:${log}`,
    leaves: `${modId}:${leaves}`,
    logs_y: at("y"),
    logs_x: at("x"),
    logs_z: at("z"),
    leaves_by_distance: byDistance,
    random_rotation: layout.randomRotation,
  };
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

/** Feature JSON for an ore of each shape, in the format of the game's own `worldgen/feature` files. */
function oreFeature(modId: string, o: OreSpec): unknown {
  const ore = o.ore;
  const block = resolveRef(modId, ore.block);
  const deepslate = resolveRef(modId, ore.deepslateBlock ?? ore.block);
  switch (ore.shape) {
    case "blob":
    case "scattered":
      return {
        type: ore.shape === "blob" ? "minecraft:ore" : "minecraft:scattered_ore",
        size: ore.veinSize,
        discard_chance_on_air_exposure: ore.airExposureSkip,
        targets: ORE_TARGETS[ore.replaces].map((t) => ({
          target: t.test,
          state: t.host === "deepslate" ? deepslate : block,
        })),
      };
    case "disk": {
      const replaces = [...new Set([...ore.disk.replaces.map((r) => resolveRef(modId, r)), block])];
      return {
        type: "minecraft:disk",
        half_height: ore.disk.halfHeight,
        radius: { type: "minecraft:uniform", min_inclusive: ore.disk.radiusMin, max_inclusive: ore.disk.radiusMax },
        state_provider: { id: block },
        target: { type: "minecraft:matching_blocks", blocks: replaces },
      };
    }
    case "geode": {
      const g = ore.geode;
      const budding = g.buddingBlock ? resolveRef(modId, g.buddingBlock) : block;
      return {
        type: "minecraft:geode",
        blocks: {
          filling_provider: { id: "minecraft:air" },
          inner_layer_provider: { id: block },
          alternate_inner_layer_provider: { id: budding },
          middle_layer_provider: { id: resolveRef(modId, g.middleBlock) },
          outer_layer_provider: { id: resolveRef(modId, g.outerBlock) },
          // The game needs at least one; without a budding block nothing is placed, so the inner block stands in.
          inner_placements: g.crystals.length ? g.crystals.map((c) => resolveRef(modId, c)) : [block],
          cannot_replace: "#minecraft:features_cannot_replace",
          invalid_blocks: "#minecraft:geode_invalid_blocks",
        },
        crack: { generate_crack_chance: g.crackChance },
        invalid_blocks_threshold: 1,
        layers: {},
        outer_wall_distance: { type: "minecraft:uniform", min_inclusive: 4, max_inclusive: 6 },
        use_alternate_layer0_chance: g.buddingBlock ? g.buddingChance : 0,
      };
    }
  }
}

/**
 * An ore: a feature (26.3 moved configured features to `worldgen/feature` and inlined their config)
 * and a placed feature that says how many per chunk and where. Disks go on the floors of water like
 * vanilla clay; the other shapes go between two heights.
 */
function oreFiles(out: Output, o: OreSpec) {
  const modId = out.modId;
  const ore = o.ore;
  out.set(`data/${modId}/worldgen/feature/${o.id}.json`, oreFeature(modId, o));
  const range = { min_inclusive: { absolute: ore.minY }, max_inclusive: { absolute: ore.maxY } };
  const where =
    ore.shape === "disk"
      ? [
          { type: "minecraft:heightmap", heightmap: "OCEAN_FLOOR_WG" },
          { type: "minecraft:block_predicate_filter", predicate: { type: "minecraft:matching_fluids", fluids: "minecraft:water" } },
        ]
      : [{ type: "minecraft:height_range", height: { type: ore.distribution === "uniform" ? "minecraft:uniform" : "minecraft:trapezoid", ...range } }];
  out.set(`data/${modId}/worldgen/placed_feature/${o.id}.json`, {
    feature: `${modId}:${o.id}`,
    placement: [
      ore.chunksPerVein ? { type: "minecraft:rarity_filter", chance: ore.chunksPerVein } : { type: "minecraft:count", count: ore.veinsPerChunk },
      { type: "minecraft:in_square" },
      ...where,
      { type: "minecraft:biome" },
    ],
  });
}

// ---- Advancements ----

const entityIs = (modId: string, mob: string) => ({
  type: "minecraft:entity_properties",
  entity: "this",
  predicate: { "minecraft:entity_type": resolveRef(modId, mob) },
});

/** One criterion as vanilla advancement JSON, in the 26.3 format of the game's own advancements. */
export function criterionJson(modId: string, c: Criterion): unknown {
  switch (c.type) {
    case "obtain":
      return { trigger: "minecraft:inventory_changed", conditions: { items: [{ items: resolveRef(modId, c.item), ...(c.count > 1 ? { count: { min: c.count } } : {}) }] } };
    case "kill":
      return { trigger: "minecraft:player_killed_entity", conditions: { entity: entityIs(modId, c.mob) } };
    case "visit":
      return {
        trigger: "minecraft:location",
        conditions: { player: { type: "minecraft:entity_properties", entity: "this", predicate: { "minecraft:location": { biomes: resolveRef(modId, c.biome) } } } },
      };
    case "craft":
      return { trigger: "minecraft:recipe_crafted", conditions: { recipes: resolveRef(modId, c.recipe) } };
    case "eat":
      return { trigger: "minecraft:consume_item", conditions: { item: { items: resolveRef(modId, c.item) } } };
    case "place":
      return { trigger: "minecraft:placed_block", conditions: { location: { type: "minecraft:match_block", blocks: resolveRef(modId, c.block) } } };
    case "breed":
      return { trigger: "minecraft:bred_animals", conditions: { child: entityIs(modId, c.mob) } };
    case "tame":
      return { trigger: "minecraft:tame_animal", conditions: { entity: entityIs(modId, c.mob) } };
  }
}

function advancementFiles(out: Output, a: AdvancementSpec) {
  const modId = out.modId;
  const adv = a.advancement;
  const key = `advancements.${modId}.${a.id}`;
  out.lang[`${key}.title`] = a.name;
  out.lang[`${key}.description`] = adv.description;

  const names = adv.criteria.map((c, i) => `${c.type}_${i + 1}`);
  const display: Record<string, unknown> = {
    icon: { id: resolveRef(modId, adv.icon) },
    title: { translate: `${key}.title` },
    description: { translate: `${key}.description` },
    frame: adv.frame,
    show_toast: adv.announce,
    announce_to_chat: adv.announce,
    hidden: adv.hidden,
  };
  if (!adv.parent) {
    if (adv.background) {
      out.copy(adv.background, `assets/${modId}/textures/gui/advancements/backgrounds/${a.id}.png`);
      display.background = `${modId}:gui/advancements/backgrounds/${a.id}`;
    } else {
      display.background = "minecraft:gui/advancements/backgrounds/stone";
    }
  }

  const rewards: Record<string, unknown> = {};
  const r = adv.rewards;
  if (r.experience > 0) rewards.experience = r.experience;
  if (r.items.length > 0) {
    out.set(`data/${modId}/loot_table/advancement_reward/${a.id}.json`, {
      type: "minecraft:advancement_reward",
      pools: r.items.map((i) => ({ rolls: 1, entries: [{ type: "minecraft:item", name: resolveRef(modId, i.item), modifier: [countModifier(i.count, i.count)] }] })),
      random_sequence: `${modId}:advancement_reward/${a.id}`,
    });
    rewards.loot = [`${modId}:advancement_reward/${a.id}`];
  }
  if (r.recipes.length > 0) rewards.recipes = r.recipes.map((ref) => resolveRef(modId, ref));

  out.set(`data/${modId}/advancement/${a.id}.json`, {
    ...(adv.parent ? { parent: resolveRef(modId, adv.parent) } : {}),
    criteria: Object.fromEntries(adv.criteria.map((c, i) => [names[i], criterionJson(modId, c)])),
    display,
    requirements: adv.requires === "all" ? names.map((n) => [n]) : [names],
    ...(Object.keys(rewards).length ? { rewards } : {}),
  });
}

// ---- Structures ----

/** A stable salt from the structure's full id, so two structures don't share spawn spots. */
export function structureSalt(id: string): number {
  let h = 0x811c9dc5;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return (h >>> 0) % 2147483647;
}

/**
 * One `.nbt` placed as a one-piece jigsaw structure, the way 26.3's abandoned camps are: the template, a start pool
 * holding it, the structure, its spawn spacing and a biome tag listing where it may start.
 */
function structureFiles(out: Output, st: StructureSpec) {
  const modId = out.modId;
  const s = st.structure;
  const id = `${modId}:${st.id}`;
  out.copy(s.file, `data/${modId}/structure/${st.id}.nbt`);
  out.set(`data/${modId}/worldgen/template_pool/${st.id}/start.json`, {
    elements: [{ element: { element_type: "minecraft:single_pool_element", location: id, processors: { processors: [] }, projection: "rigid" }, weight: 1 }],
    fallback: "minecraft:empty",
  });
  const tag = `${modId}:has_structure/${st.id}`;
  for (const b of s.biomes) out.tag("worldgen/biome", tag, resolveRef(modId, b));
  const surface = s.placement === "surface";
  out.set(`data/${modId}/worldgen/structure/${st.id}.json`, {
    type: "minecraft:jigsaw",
    biomes: `#${tag}`,
    max_distance_from_center: 80,
    ...(surface ? { project_start_to_heightmap: "WORLD_SURFACE_WG" } : {}),
    size: 1,
    spawn_overrides: {},
    start_height: { absolute: s.y },
    start_pool: `${modId}:${st.id}/start`,
    step: surface ? "surface_structures" : "underground_structures",
    terrain_adaptation: s.terrain,
    use_expansion_hack: false,
  });
  out.set(`data/${modId}/worldgen/structure_set/${st.id}.json`, {
    placement: { type: "minecraft:random_spread", salt: structureSalt(id), separation: s.separation, spacing: s.spacing },
    structures: [{ structure: id, weight: 1 }],
  });
}

// ---- Sounds ----

/** `assets/<mod>/sounds.json`: one event per sound spec, its files copied to `sounds/<id>/<n>.ogg`. */
function soundFiles(out: Output, sounds: SoundSpec[]) {
  if (!sounds.length) return;
  const modId = out.modId;
  const events: Record<string, unknown> = {};
  for (const s of sounds) {
    out.lang[`subtitles.${modId}.${s.id}`] = s.name;
    events[s.id] = {
      subtitle: `subtitles.${modId}.${s.id}`,
      sounds: s.sound.files.map((f, i) => {
        out.copy(f.file, `assets/${modId}/sounds/${s.id}/${i + 1}.ogg`);
        const name = `${modId}:${s.id}/${i + 1}`;
        const extra = {
          ...(f.volume !== 1 ? { volume: f.volume } : {}),
          ...(f.pitch !== 1 ? { pitch: f.pitch } : {}),
          ...(f.weight !== 1 ? { weight: f.weight } : {}),
          ...(s.sound.stream ? { stream: true } : {}),
        };
        return Object.keys(extra).length ? { name, ...extra } : name;
      }),
    };
  }
  out.set(`assets/${modId}/sounds.json`, events);
}

// ---- Effects and potions ----

const POTION_ITEMS = [
  ["potion", "Potion of"],
  ["splash_potion", "Splash Potion of"],
  ["lingering_potion", "Lingering Potion of"],
  ["tipped_arrow", "Arrow of"],
] as const;

/** A data-driven brewing recipe: `input` potion in `container` plus `reagent` makes `output` in `to`. */
function brewing(container: string, input: string, reagent: string, output: string, to = container) {
  return {
    type: "minecraft:brewing",
    input: { item: `minecraft:${container}`, potion_contents: { potions: input } },
    output: { components: { "minecraft:potion_contents": { potion: output } }, id: `minecraft:${to}` },
    reagent: { item: reagent },
  };
}

/**
 * The effect's icon and name, and for a potion its names and brewing recipes, the same set vanilla has for each
 * potion: awkward + ingredient in all three bottles, redstone and glowstone for the long and strong versions,
 * gunpowder for splash and dragon's breath for lingering.
 */
function effectFiles(out: Output, e: EffectSpec) {
  const modId = out.modId;
  out.lang[`effect.${modId}.${e.id}`] = e.name;
  out.copy(e.effect.icon, `assets/${modId}/textures/mob_effect/${e.id}.png`);
  const p = e.effect.potion;
  if (!p) return;
  for (const [item, prefix] of POTION_ITEMS) out.lang[`item.minecraft.${item}.effect.${modId}.${e.id}`] = `${prefix} ${e.name}`;
  const ingredient = resolveRef(modId, p.ingredient);
  const variants = potionVariants(e).map((v) => ({ ...v, ref: `${modId}:${v.id}` }));
  const base = variants[0].ref;
  const recipe = (container: string, variant: string, reagent: string, value: unknown) =>
    out.set(`data/${modId}/recipe/brewing/${container}_${variant}_${reagent.split(":").pop()}.json`, value);
  for (const c of ["potion", "splash_potion", "lingering_potion"]) {
    recipe(c, "awkward", ingredient, brewing(c, "minecraft:awkward", ingredient, base));
    for (const v of variants.slice(1)) {
      const reagent = v.id.startsWith("long_") ? "minecraft:redstone" : "minecraft:glowstone_dust";
      recipe(c, e.id, reagent, brewing(c, base, reagent, v.ref));
    }
  }
  for (const v of variants) {
    recipe("potion", v.id, "gunpowder", brewing("potion", v.ref, "minecraft:gunpowder", v.ref, "splash_potion"));
    recipe("splash_potion", v.id, "dragon_breath", brewing("splash_potion", v.ref, "minecraft:dragon_breath", v.ref, "lingering_potion"));
  }
}

// ---- Enchantments ----

const linear = (amount: number, perLevel: number) => ({ type: "minecraft:linear", base: amount, per_level_above_first: perLevel });
const DIRECT_HIT = { type: "minecraft:damage_source_properties", predicate: { is_direct: true } };
const ATTRIBUTE_OPERATIONS = { add: "add_value", multiply_base: "add_multiplied_base", multiply_total: "add_multiplied_total" } as const;

/** `data/<mod>/enchantment/<id>.json`, in the same shape as vanilla's, with each effect under its effect component. */
export function enchantmentJson(modId: string, e: EnchantmentSpec): unknown {
  const x = e.enchantment;
  const effects: Record<string, unknown[]> = {};
  const add = (component: string, value: unknown) => (effects[`minecraft:${component}`] ??= []).push(value);
  for (const fx of x.effects) {
    const value = linear(fx.amount, fx.perLevel);
    switch (fx.type) {
      case "damage": {
        const against = fx.against && {
          type: "minecraft:entity_properties",
          entity: "this",
          predicate: { "minecraft:entity_type": resolveRef(modId, fx.against) },
        };
        add("damage", { effect: { type: "minecraft:add", value }, ...(against ? { requirements: against } : {}) });
        break;
      }
      case "protection":
        add("damage_protection", {
          effect: { type: "minecraft:add", value },
          requirements: { type: "minecraft:damage_source_properties", predicate: { tags: [{ expected: false, id: "#minecraft:bypasses_invulnerability" }] } },
        });
        break;
      case "knockback":
        add("knockback", { effect: { type: "minecraft:add", value } });
        break;
      case "ignite":
        add("post_attack", { affected: "victim", effect: { type: "minecraft:ignite", duration: value }, enchanted: "attacker", requirements: DIRECT_HIT });
        break;
      case "effect_on_hit":
        add("post_attack", {
          affected: "victim",
          effect: {
            type: "minecraft:apply_mob_effect",
            to_apply: resolveRef(modId, fx.effect),
            min_duration: fx.amount,
            max_duration: value,
            min_amplifier: fx.amplifier,
            max_amplifier: fx.amplifier,
          },
          enchanted: "attacker",
          requirements: DIRECT_HIT,
        });
        break;
      case "attribute":
        add("attributes", {
          amount: value,
          attribute: `minecraft:${fx.attribute}`,
          id: `${modId}:enchantment.${e.id}.${fx.attribute}`,
          operation: ATTRIBUTE_OPERATIONS[fx.operation],
        });
        break;
    }
  }
  const exclusive = x.exclusiveWith.length === 1 && x.exclusiveWith[0].startsWith("#")
    ? resolveRef(modId, x.exclusiveWith[0])
    : x.exclusiveWith.length ? `#${modId}:exclusive_set/${e.id}` : undefined;
  return {
    anvil_cost: x.anvilCost,
    description: { translate: `enchantment.${modId}.${e.id}` },
    effects,
    ...(exclusive ? { exclusive_set: exclusive } : {}),
    max_cost: { base: x.maxCost.base, per_level_above_first: x.maxCost.perLevel },
    max_level: x.maxLevel,
    min_cost: { base: x.minCost.base, per_level_above_first: x.minCost.perLevel },
    ...(x.tableItems ? { primary_items: resolveRef(modId, x.tableItems) } : {}),
    slots: x.slots,
    supported_items: resolveRef(modId, x.items),
    weight: x.weight,
  };
}

/**
 * The enchantment file, its name, and the vanilla tags that decide where it shows up: non-treasure ones go to the
 * enchanting table, loot and trades, treasure ones only to loot and trades.
 */
function enchantmentFiles(out: Output, e: EnchantmentSpec) {
  const modId = out.modId;
  const x = e.enchantment;
  const ref = `${modId}:${e.id}`;
  out.lang[`enchantment.${modId}.${e.id}`] = e.name;
  out.set(`data/${modId}/enchantment/${e.id}.json`, enchantmentJson(modId, e));
  if (x.exclusiveWith.length && !(x.exclusiveWith.length === 1 && x.exclusiveWith[0].startsWith("#"))) {
    for (const other of x.exclusiveWith) out.tag("enchantment", `${modId}:exclusive_set/${e.id}`, resolveRef(modId, other));
  }
  if (x.treasure) {
    for (const t of ["minecraft:treasure", "minecraft:on_random_loot", "minecraft:tradeable"]) out.tag("enchantment", t, ref);
  } else {
    out.tag("enchantment", "minecraft:non_treasure", ref);
  }
  if (x.curse) out.tag("enchantment", "minecraft:curse", ref);
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
      case "advancement": advancementFiles(out, e); break;
      case "structure": structureFiles(out, e); break;
      case "effect": effectFiles(out, e); break;
      case "enchantment": enchantmentFiles(out, e); break;
      case "recipe": out.set(`data/${project.modId}/recipe/${e.id}.json`, recipeJson(project.modId, e)); break;
    }
  }
  soundFiles(out, elements.filter((e): e is SoundSpec => e.kind === "sound"));
  return out.finish();
}
