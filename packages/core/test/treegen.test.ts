import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JavaRandom, TREE_SHAPES, blocksToLayout, growTree, layoutBlocks, leafDistances, vanillaTreeConfig, type TreeBlock } from "../src/index.js";

// Trees grown by the game's own TreeFeature code, recorded by scripts/tree-parity/TreeParity.java.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/vanilla-trees.json", import.meta.url), "utf8")) as {
  configs: Record<string, any>;
  trees: Record<string, string[]>;
};

const hash = (blocks: TreeBlock[]) =>
  createHash("sha1")
    .update(
      blocks
        .map((b) => `${b.x},${b.y},${b.z},${b.kind === "log" ? `log:${b.axis}` : b.kind}`)
        .sort()
        .map((l) => l + "\n")
        .join(""),
    )
    .digest("hex");

describe("tree preview", () => {
  it("draws random numbers like Java's Random", () => {
    // Each from a fresh new java.util.Random(42): nextInt() = -1170105035, nextInt(10) = 0, nextFloat() = 0.7275637
    expect(new JavaRandom(42).next(32)).toBe(-1170105035);
    expect(new JavaRandom(42).nextInt(10)).toBe(0);
    expect(new JavaRandom(42).nextFloat()).toBeCloseTo(0.7275637, 6);
  });

  for (const [name, hashes] of Object.entries(fixture.trees)) {
    it(`grows ${name} exactly like the game (${hashes.length} seeds)`, () => {
      const got = hashes.map((_, seed) => hash(growTree(fixture.configs[name], seed)));
      expect(got).toEqual(hashes);
    });
  }

  it("has a game-checked tree for every vanilla shape", () => {
    // If a shape's numbers change, rerun scripts/tree-parity so the fixture checks the new config.
    for (const shape of Object.keys(TREE_SHAPES) as (keyof typeof TREE_SHAPES)[]) {
      expect(fixture.configs[shape], shape).toEqual(vanillaTreeConfig({ shape }));
    }
  });
});

describe("custom tree layouts", () => {
  const layout = {
    layers: [
      ["...", ".L.", "..."],
      ["###", "#L#", "###"],
      [".#.", "#X#", ".#."],
    ],
  };

  it("places blocks around the sapling in the middle", () => {
    const blocks = layoutBlocks(layout);
    expect(blocks).toContainEqual({ x: 0, y: 0, z: 0, kind: "log", axis: "y" });
    expect(blocks).toContainEqual({ x: 0, y: 2, z: 0, kind: "log", axis: "x" });
    expect(blocks).toContainEqual({ x: -1, y: 1, z: -1, kind: "leaves" });
    expect(blocks.filter((b) => b.kind === "leaves")).toHaveLength(12);
  });

  it("round-trips through blocks", () => {
    expect(layoutBlocks(blocksToLayout(layoutBlocks(layout)))).toEqual(expect.arrayContaining(layoutBlocks(layout)));
    expect(blocksToLayout(layoutBlocks(layout)).layers).toEqual(layout.layers);
  });

  it("gives leaves their distance to a log, 7 when too far", () => {
    const blocks: TreeBlock[] = [{ x: 0, y: 0, z: 0, kind: "log", axis: "y" }, ...Array.from({ length: 8 }, (_, i) => ({ x: i + 1, y: 0, z: 0, kind: "leaves" as const }))];
    const d = leafDistances(blocks);
    expect([1, 2, 6, 7, 8].map((x) => d.get(`${x},0,0`))).toEqual([1, 2, 6, 7, 7]);
  });
});
