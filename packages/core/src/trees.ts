// Tree shapes: the vanilla 26.3 tree configs a tree spec can copy, how a spec's tweaks apply to them, and custom
// hand-built layouts. Shared by the generator (the feature JSON it writes) and the app (the 3D preview), so the
// preview always grows the same config the game will. Safe to import in the browser.

import type { StructureTemplate } from "./nbt.js";
import type { TreeSpec } from "./schema.js";
import { growTree, type Axis, type TreeBlock } from "./treegen.js";
import vanillaTrees from "./profiles/v26_3/vanillaTrees.json" with { type: "json" };

export { growTree, JavaRandom, type TreeBlock, type Axis } from "./treegen.js";

/**
 * Vanilla tree configs, without their log and leaf blocks: the trunk placer, foliage placer and minimum size of
 * each shape a tree spec can copy. Read from the Minecraft jar's TreeFeatures by scripts/tree-parity/ExtractTrees.java,
 * so a new Minecraft version only needs that script rerun. Decorators such as vines, cocoa and bee nests are left out.
 */
export const TREE_SHAPES = vanillaTrees.shapes;

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
