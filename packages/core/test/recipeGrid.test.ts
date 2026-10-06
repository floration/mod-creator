import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { VanillaAssets, listFromSlots, patternFromSlots, sameShape, slotsFromList, slotsFromPattern } from "../src/index.js";
import { ZipFile } from "../src/zip.js";

const _ = null;

describe("crafting grid", () => {
  it("lays the ruby lamp pattern out in the table", () => {
    expect(slotsFromPattern([" R ", "RGR", " R "], { R: "ruby", G: "minecraft:glowstone" })).toEqual([
      _, "ruby", _,
      "ruby", "minecraft:glowstone", "ruby",
      _, "ruby", _,
    ]);
  });

  it("round-trips a full 3x3 recipe", () => {
    const key = { R: "ruby", G: "minecraft:glowstone" };
    expect(patternFromSlots(slotsFromPattern([" R ", "RGR", " R "], key), key)).toEqual({ pattern: [" R ", "RGR", " R "], key });
  });

  it("drops empty edges so the shape works anywhere", () => {
    const slots = [_, _, _, _, "minecraft:stick", _, _, "minecraft:stick", _];
    expect(patternFromSlots(slots)).toEqual({ pattern: ["S", "S"], key: { S: "minecraft:stick" } });
  });

  it("picks distinct letters from item names and keeps existing ones", () => {
    const slots = ["#minecraft:planks", "minecraft:paper", _, _, _, _, _, _, _];
    expect(patternFromSlots(slots)).toEqual({ pattern: ["PA"], key: { P: "#minecraft:planks", A: "minecraft:paper" } });
    expect(patternFromSlots(slots, { X: "minecraft:paper" })).toEqual({ pattern: ["PX"], key: { P: "#minecraft:planks", X: "minecraft:paper" } });
  });

  it("keeps letters the key never defined", () => {
    const slots = slotsFromPattern(["AB"], { A: "ruby" });
    expect(slots.slice(0, 2)).toEqual(["ruby", "?B"]);
    expect(patternFromSlots(slots)).toEqual({ pattern: ["RB"], key: { R: "ruby" } });
  });

  it("empties to a blank pattern", () => {
    expect(patternFromSlots(Array(9).fill(null))).toEqual({ pattern: ["   ", "   ", "   "], key: {} });
  });

  it("treats a shape moved around the table as the same recipe", () => {
    expect(sameShape(["ruby", _, _, _, _, _, _, _, _], [_, _, _, _, _, _, _, _, "ruby"])).toBe(true);
    expect(sameShape(["ruby", "ruby", _, _, _, _, _, _, _], ["ruby", _, _, "ruby", _, _, _, _, _])).toBe(false);
  });

  it("fills shapeless ingredients in reading order", () => {
    const slots = slotsFromList(["ruby_block", "minecraft:stick"]);
    expect(slots.slice(0, 3)).toEqual(["ruby_block", "minecraft:stick", null]);
    expect(listFromSlots([_, "a", _, "b", _, _, _, _, _])).toEqual(["a", "b"]);
  });
});

/** A stored-and-deflated zip, enough to stand in for a Minecraft jar. */
function zip(files: Record<string, string | Buffer>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const packed = deflateRawSync(data);
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(n.length, 28);
    dir.writeUInt32LE(offset, 42);
    locals.push(local, n, packed);
    central.push(dir, n);
    offset += 30 + n.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

describe("vanilla assets", () => {
  const png = (tag: string) => Buffer.from(`png:${tag}`);
  const url = (tag: string) => `data:image/png;base64,${png(tag).toString("base64")}`;
  const assets = new VanillaAssets(
    ZipFile.fromBuffer(
      zip({
        "assets/minecraft/lang/en_us.json": JSON.stringify({ "item.minecraft.stick": "Stick", "block.minecraft.furnace": "Furnace" }),
        "assets/minecraft/items/stick.json": JSON.stringify({ model: { type: "minecraft:model", model: "minecraft:item/stick" } }),
        "assets/minecraft/items/furnace.json": JSON.stringify({ model: { type: "minecraft:model", model: "minecraft:block/furnace" } }),
        "assets/minecraft/items/oak_planks.json": JSON.stringify({ model: { type: "minecraft:model", model: "minecraft:block/oak_planks" } }),
        "assets/minecraft/items/chest.json": JSON.stringify({
          model: { type: "minecraft:select", cases: [{ model: { type: "minecraft:special", base: "minecraft:item/chest", model: { type: "minecraft:chest" } } }] },
        }),
        "assets/minecraft/models/item/stick.json": JSON.stringify({ parent: "minecraft:item/generated", textures: { layer0: "minecraft:item/stick" } }),
        "assets/minecraft/models/item/generated.json": "{}",
        "assets/minecraft/models/item/chest.json": JSON.stringify({ textures: { particle: "minecraft:block/oak_planks" } }),
        "assets/minecraft/models/block/furnace.json": JSON.stringify({
          parent: "minecraft:block/orientable",
          textures: { front: "minecraft:block/furnace_front", side: "minecraft:block/furnace_side", top: "minecraft:block/furnace_top" },
        }),
        "assets/minecraft/models/block/orientable.json": JSON.stringify({ parent: "block/cube", textures: { particle: "#front" } }),
        "assets/minecraft/models/block/oak_planks.json": JSON.stringify({ parent: "minecraft:block/cube_all", textures: { all: "minecraft:block/oak_planks" } }),
        "assets/minecraft/models/block/cube_all.json": JSON.stringify({ parent: "block/cube", textures: { particle: "#all" } }),
        "assets/minecraft/models/block/cube.json": "{}",
        "assets/minecraft/textures/item/stick.png": png("stick"),
        "assets/minecraft/textures/block/furnace_front.png": png("front"),
        "assets/minecraft/textures/block/furnace_side.png": png("side"),
        "assets/minecraft/textures/block/furnace_top.png": png("top"),
        "assets/minecraft/textures/block/oak_planks.png": png("planks"),
        "data/minecraft/tags/item/planks.json": JSON.stringify({ values: ["minecraft:oak_planks"] }),
      }),
    ),
  );

  it("names items, blocks and tags", () => {
    expect(assets.name("minecraft:stick")).toBe("Stick");
    expect(assets.name("minecraft:furnace")).toBe("Furnace");
    expect(assets.name("minecraft:oak_planks")).toBe("Oak Planks");
    expect(assets.name("#minecraft:planks")).toBe("Any Planks");
  });

  it("lists items and tags by name", () => {
    expect(assets.catalog()).toEqual({
      items: [
        { id: "minecraft:chest", name: "Chest" },
        { id: "minecraft:furnace", name: "Furnace" },
        { id: "minecraft:oak_planks", name: "Oak Planks" },
        { id: "minecraft:stick", name: "Stick" },
      ],
      tags: [{ id: "#minecraft:planks", name: "Any Planks" }],
    });
  });

  it("draws items flat and blocks as cubes", () => {
    expect(assets.icon("minecraft:stick")).toEqual({ kind: "flat", texture: url("stick") });
    expect(assets.icon("minecraft:furnace")).toEqual({ kind: "cube", top: url("top"), left: url("front"), right: url("side") });
    expect(assets.icon("minecraft:oak_planks")).toEqual({ kind: "cube", top: url("planks"), left: url("planks"), right: url("planks") });
    expect(assets.icon("#minecraft:planks")).toEqual(assets.icon("minecraft:oak_planks"));
    expect(assets.icon("minecraft:chest")).toEqual({ kind: "flat", texture: url("planks") });
    expect(assets.icon("minecraft:nothing")).toBeNull();
  });
});
