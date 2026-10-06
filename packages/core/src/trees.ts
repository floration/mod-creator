// Tree shapes: the vanilla 26.3 tree configs a tree spec can copy, how a spec's tweaks apply to them, and custom
// hand-built layouts. Shared by the generator (the feature JSON it writes) and the app (the 3D preview), so the
// preview always grows the same config the game will. Safe to import in the browser.

import type { StructureTemplate } from "./nbt.js";
import type { TreeSpec } from "./schema.js";
import { growTree, type Axis, type TreeBlock } from "./treegen.js";

export { growTree, JavaRandom, type TreeBlock, type Axis } from "./treegen.js";

const two = (limit: number, lower: number, upper: number, minClipped?: number) => ({
  type: "minecraft:two_layers_feature_size",
  limit,
  lower_size: lower,
  upper_size: upper,
  ...(minClipped !== undefined ? { min_clipped_height: minClipped } : {}),
});
const uniform = (min: number, max: number) => ({ type: "minecraft:uniform", min_inclusive: min, max_inclusive: max });
const weighted = (entries: [number, number][]) => ({
  type: "minecraft:weighted_list",
  distribution: entries.map(([data, weight]) => ({ data, weight })),
});
const trunk = (type: string, base: number, a: number, b: number, extra: object = {}) => ({
  type: `minecraft:${type}`,
  base_height: base,
  height_rand_a: a,
  height_rand_b: b,
  ...extra,
});
const blob = (radius: number, height = 3) => ({ type: "minecraft:blob_foliage_placer", radius, offset: 0, height });

/**
 * Vanilla tree configs, without their log and leaf blocks, copied from 26.3's TreeFeatures (decorators such as
 * vines, cocoa and bee nests are left out). The key is what a tree spec's `shape` names.
 */
export const TREE_SHAPES = {
  oak: { trunk_placer: trunk("straight_trunk_placer", 4, 2, 0), foliage_placer: blob(2), minimum_size: two(1, 0, 1) },
  fancy_oak: {
    trunk_placer: trunk("fancy_trunk_placer", 3, 11, 0),
    foliage_placer: { type: "minecraft:fancy_foliage_placer", radius: 2, offset: 4, height: 4 },
    minimum_size: two(0, 0, 0, 4),
  },
  birch: { trunk_placer: trunk("straight_trunk_placer", 5, 2, 0), foliage_placer: blob(2), minimum_size: two(1, 0, 1) },
  super_birch: { trunk_placer: trunk("straight_trunk_placer", 5, 2, 6), foliage_placer: blob(2), minimum_size: two(1, 0, 1) },
  jungle: { trunk_placer: trunk("straight_trunk_placer", 4, 8, 0), foliage_placer: blob(2), minimum_size: two(1, 0, 1) },
  swamp_oak: { trunk_placer: trunk("straight_trunk_placer", 5, 3, 0), foliage_placer: blob(3), minimum_size: two(1, 0, 1) },
  jungle_bush: {
    trunk_placer: trunk("straight_trunk_placer", 1, 0, 0),
    foliage_placer: { type: "minecraft:bush_foliage_placer", radius: 2, offset: 1, height: 2 },
    minimum_size: two(0, 0, 0),
  },
  spruce: {
    trunk_placer: trunk("straight_trunk_placer", 5, 2, 1),
    foliage_placer: { type: "minecraft:spruce_foliage_placer", radius: uniform(2, 3), offset: uniform(0, 2), trunk_height: uniform(1, 2) },
    minimum_size: two(2, 0, 2),
  },
  pine: {
    trunk_placer: trunk("straight_trunk_placer", 6, 4, 0),
    foliage_placer: { type: "minecraft:pine_foliage_placer", radius: 1, offset: 1, height: uniform(3, 4) },
    minimum_size: two(2, 0, 2),
  },
  acacia: {
    trunk_placer: trunk("forking_trunk_placer", 5, 2, 2),
    foliage_placer: { type: "minecraft:acacia_foliage_placer", radius: 2, offset: 0 },
    minimum_size: two(1, 0, 2),
  },
  cherry: {
    trunk_placer: trunk("cherry_trunk_placer", 7, 1, 0, {
      branch_count: weighted([[1, 1], [2, 1], [3, 1]]),
      branch_horizontal_length: uniform(2, 4),
      branch_start_offset_from_top: { min_inclusive: -4, max_inclusive: -3 },
      branch_end_offset_from_top: uniform(-1, 0),
    }),
    foliage_placer: {
      type: "minecraft:cherry_foliage_placer",
      radius: 4,
      offset: 0,
      height: 5,
      wide_bottom_layer_hole_chance: 0.25,
      corner_hole_chance: 0.5,
      hanging_leaves_chance: 0.16666667,
      hanging_leaves_extension_chance: 0.33333334,
    },
    minimum_size: two(1, 0, 2),
  },
  azalea: {
    trunk_placer: trunk("bending_trunk_placer", 4, 2, 0, { min_height_for_leaves: 3, bend_length: uniform(1, 2) }),
    foliage_placer: { type: "minecraft:random_spread_foliage_placer", radius: 3, offset: 0, foliage_height: 2, leaf_placement_attempts: 50 },
    minimum_size: two(1, 0, 1),
  },
  poplar: {
    trunk_placer: trunk("poplar_trunk_placer", 7, 4, 0, { trunk_height_above_branches: 4, branch_amount: uniform(1, 4) }),
    foliage_placer: {
      type: "minecraft:poplar_foliage_placer",
      radius: weighted([[5, 5], [6, 5], [7, 1], [8, 1]]),
      offset: 0,
      height: uniform(5, 6),
      side_hole_chance: 0.15,
    },
    minimum_size: two(1, 0, 2),
  },
  dark_oak: {
    trunk_placer: trunk("dark_oak_trunk_placer", 6, 2, 1),
    foliage_placer: { type: "minecraft:dark_oak_foliage_placer", radius: 0, offset: 0 },
    minimum_size: { type: "minecraft:three_layers_feature_size", limit: 1, upper_limit: 1, lower_size: 0, middle_size: 1, upper_size: 2 },
  },
  mega_spruce: {
    trunk_placer: trunk("giant_trunk_placer", 13, 2, 14),
    foliage_placer: { type: "minecraft:mega_pine_foliage_placer", radius: 0, offset: 0, crown_height: uniform(13, 17) },
    minimum_size: two(1, 1, 2),
  },
  mega_pine: {
    trunk_placer: trunk("giant_trunk_placer", 13, 2, 14),
    foliage_placer: { type: "minecraft:mega_pine_foliage_placer", radius: 0, offset: 0, crown_height: uniform(3, 7) },
    minimum_size: two(1, 1, 2),
  },
  mega_jungle: {
    trunk_placer: trunk("mega_jungle_trunk_placer", 10, 2, 19),
    foliage_placer: { type: "minecraft:jungle_foliage_placer", radius: 2, offset: 0, height: 2 },
    minimum_size: two(1, 1, 2),
  },
} as const;

export type VanillaTreeShape = keyof typeof TREE_SHAPES;

/** Shapes that only grow from four saplings in a square, like dark oak. */
export const TWO_BY_TWO_SHAPES: readonly string[] = ["dark_oak", "mega_spruce", "mega_pine", "mega_jungle"];

/** Shown next to each shape in the app. */
export const TREE_SHAPE_LABELS: Record<VanillaTreeShape | "custom", string> = {
  oak: "Oak",
  fancy_oak: "Fancy oak (big branching oak)",
  birch: "Birch",
  super_birch: "Tall birch",
  jungle: "Jungle (small)",
  swamp_oak: "Swamp oak",
  jungle_bush: "Jungle bush",
  spruce: "Spruce",
  pine: "Pine",
  acacia: "Acacia",
  cherry: "Cherry",
  azalea: "Azalea",
  poplar: "Poplar",
  dark_oak: "Dark oak (2x2 saplings)",
  mega_spruce: "Giant spruce (2x2 saplings)",
  mega_pine: "Giant pine (2x2 saplings)",
  mega_jungle: "Giant jungle (2x2 saplings)",
  custom: "Custom (built by hand)",
};

type TreeOptions = TreeSpec["tree"];

/** The trunk, foliage and size parts of a vanilla-shaped tree's feature, with the spec's tweaks applied. */
export function vanillaTreeConfig(x: Pick<TreeOptions, "shape" | "trunkHeight" | "trunkHeightRandom" | "leafRadius">): Record<string, any> {
  if (x.shape === "custom") throw new Error("custom trees have no vanilla config");
  const shape = structuredClone(TREE_SHAPES[x.shape]) as Record<string, any>;
  if (x.trunkHeight !== undefined) shape.trunk_placer.base_height = x.trunkHeight;
  if (x.trunkHeightRandom !== undefined) shape.trunk_placer.height_rand_a = x.trunkHeightRandom;
  if (x.leafRadius !== undefined && typeof shape.foliage_placer.radius === "number") shape.foliage_placer.radius = x.leafRadius;
  return shape;
}

// ---- Custom layouts ----

/**
 * Characters in a custom layout: `.` (or space) nothing, `L` upright log, `X` log lying east-west, `Z` log lying
 * north-south, `#` leaves.
 */
export const LAYOUT_CHARS = { ".": "air", L: "log_y", X: "log_x", Z: "log_z", "#": "leaves" } as const;

export interface CustomLayout {
  /** Layers from the sapling's level up. Each layer is rows from north to south; each row reads west to east. */
  layers: string[][];
  /** `[column, row]` of the sapling in the bottom layer. Defaults to the middle. */
  origin?: [number, number];
}

/** Size of a layout: widest row, most rows, number of layers. */
export function layoutSize(l: CustomLayout): { width: number; depth: number; height: number } {
  return {
    width: Math.max(1, ...l.layers.flatMap((layer) => layer.map((row) => row.length))),
    depth: Math.max(1, ...l.layers.map((layer) => layer.length)),
    height: l.layers.length,
  };
}

export function layoutOrigin(l: CustomLayout): [number, number] {
  if (l.origin) return l.origin;
  const { width, depth } = layoutSize(l);
  return [Math.floor(width / 2), Math.floor(depth / 2)];
}

/** The blocks of a custom layout, relative to the sapling. */
export function layoutBlocks(l: CustomLayout): TreeBlock[] {
  const [ox, oz] = layoutOrigin(l);
  const out: TreeBlock[] = [];
  l.layers.forEach((layer, y) =>
    layer.forEach((row, z) =>
      [...row].forEach((ch, x) => {
        const pos = { x: x - ox, y, z: z - oz };
        if (ch === "#") out.push({ ...pos, kind: "leaves" });
        else if (ch === "L" || ch === "X" || ch === "Z") out.push({ ...pos, kind: "log", axis: ch === "L" ? "y" : (ch.toLowerCase() as Axis) });
      }),
    ),
  );
  return out;
}

/** Builds layout layers from blocks (relative to the sapling), the reverse of `layoutBlocks`. */
export function blocksToLayout(blocks: TreeBlock[]): CustomLayout {
  const solid = blocks.filter((b) => b.kind !== "soil" && b.y >= 0);
  if (!solid.length) return { layers: [["L"]], origin: [0, 0] };
  const minX = Math.min(...solid.map((b) => b.x));
  const maxX = Math.max(...solid.map((b) => b.x));
  const minZ = Math.min(...solid.map((b) => b.z));
  const maxZ = Math.max(...solid.map((b) => b.z));
  const maxY = Math.max(...solid.map((b) => b.y));
  const grid = Array.from({ length: maxY + 1 }, () => Array.from({ length: maxZ - minZ + 1 }, () => Array(maxX - minX + 1).fill(".")));
  for (const b of solid) {
    grid[b.y][b.z - minZ][b.x - minX] = b.kind === "leaves" ? "#" : b.axis === "x" ? "X" : b.axis === "z" ? "Z" : "L";
  }
  return { layers: grid.map((layer) => layer.map((row) => row.join(""))), origin: [-minX, -minZ] };
}

/**
 * A layout from a structure block's .nbt (build the tree in game, save it, import it): logs and wood become logs
 * with their axis, anything named leaves becomes leaves, the rest (air, dirt, grass, saplings) is dropped. The
 * sapling goes under the trunk: the lowest log nearest the middle.
 */
export function structureToLayout(s: StructureTemplate): CustomLayout {
  const blocks: TreeBlock[] = [];
  for (const b of s.blocks) {
    const state = s.palette[b.state];
    if (!state) continue;
    const id = state.name.split(":").pop()!;
    const [x, y, z] = b.pos;
    if (/(_log|_wood|_stem|_hyphae)$/.test(id)) {
      const axis = (state.properties.axis ?? "y") as Axis;
      blocks.push({ x, y, z, kind: "log", axis: axis === "x" || axis === "z" ? axis : "y" });
    } else if (id.endsWith("leaves") || id === "nether_wart_block" || id === "warped_wart_block") {
      blocks.push({ x, y, z, kind: "leaves" });
    }
  }
  const logs = blocks.filter((b) => b.kind === "log");
  if (!logs.length) throw new Error("This structure has no logs to use as a trunk");
  const bottom = Math.min(...logs.map((b) => b.y));
  const [cx, cz] = [(s.size[0] - 1) / 2, (s.size[2] - 1) / 2];
  const base = logs.filter((b) => b.y === bottom).sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz))[0];
  return blocksToLayout(blocks.map((b) => ({ ...b, x: b.x - base.x, y: b.y - bottom, z: b.z - base.z })));
}

/**
 * Leaf distances the game would give each leaf of a custom layout: steps (through leaves) to the nearest log,
 * 1 to 7. Leaves at 7 are too far from a log and decay; the app warns about them.
 */
export function leafDistances(blocks: TreeBlock[]): Map<string, number> {
  const k = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const leaves = new Set(blocks.filter((b) => b.kind === "leaves").map((b) => k(b.x, b.y, b.z)));
  const dist = new Map<string, number>();
  let frontier = blocks.filter((b) => b.kind === "log").map((b) => [b.x, b.y, b.z]);
  for (let d = 1; d < 7 && frontier.length; d++) {
    const next: number[][] = [];
    for (const [x, y, z] of frontier) {
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const key = k(x + dx, y + dy, z + dz);
        if (leaves.has(key) && !dist.has(key)) {
          dist.set(key, d);
          next.push([x + dx, y + dy, z + dz]);
        }
      }
    }
    frontier = next;
  }
  for (const key of leaves) if (!dist.has(key)) dist.set(key, 7);
  return dist;
}

/** What the preview shows for a tree spec: a grown vanilla-shaped tree for the seed, or the custom layout. */
export function previewTree(x: TreeOptions, seed: number): TreeBlock[] {
  if (x.shape === "custom") return x.custom ? layoutBlocks(x.custom) : [];
  return growTree(vanillaTreeConfig(x) as { trunk_placer: any; foliage_placer: any }, seed);
}
