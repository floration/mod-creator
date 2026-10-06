import { describe, expect, it } from "vitest";
import { TintRecipe, applyTint, bakeTint, isVanillaTexture, maskWeights, suggestedMask, tintRecipePath, tintTextures, type RgbaImage } from "../src/tint.js";

/** A 1-pixel-high image from [r, g, b, a] pixels. */
function row(...pixels: number[][]): RgbaImage {
  return { width: pixels.length, height: 1, data: new Uint8ClampedArray(pixels.flat()) };
}
const pixels = (img: RgbaImage) => Array.from({ length: img.width * img.height }, (_, i) => [...img.data.slice(i * 4, i * 4 + 4)]);

const STONE = [128, 128, 128, 255];
const ORE = [200, 200, 200, 255];
const CLEAR = [0, 0, 0, 0];

describe("tinting", () => {
  it("names the recipe after the PNG and tells vanilla refs from project art", () => {
    expect(tintRecipePath("art/ruby_ore.png")).toBe("art/ruby_ore.tint.json");
    expect(isVanillaTexture("minecraft:block/iron_ore")).toBe(true);
    expect(isVanillaTexture("art/ruby_ore.png")).toBe(false);
  });

  it("multiplies like Factorio and paints flat color, leaving transparent pixels alone", () => {
    const img = row([255, 255, 255, 255], [128, 128, 128, 255], CLEAR);
    expect(pixels(applyTint(img, { color: "#ff8000", mode: "multiply", strength: 1, mask: { kind: "all" } }))).toEqual([[255, 128, 0, 255], [128, 64, 0, 255], CLEAR]);
    expect(pixels(applyTint(img, { color: "#ff8000", mode: "paint", strength: 1, mask: { kind: "all" } }))).toEqual([[255, 128, 0, 255], [255, 128, 0, 255], CLEAR]);
  });

  it("recolors around the average shade, keeping darker and lighter pixels", () => {
    const img = row([100, 100, 100, 255], [50, 50, 50, 255], [150, 150, 150, 255]);
    const out = pixels(applyTint(img, { color: "#c03030", mode: "recolor", strength: 1, mask: { kind: "all" } }));
    expect(out[0]).toEqual([192, 48, 48, 255]);
    expect(out[1]).toEqual([96, 24, 24, 255]);
    expect(out[2][0]).toBeGreaterThan(192);
    expect(out[2][1]).toBeGreaterThan(48);
  });

  it("blends by strength", () => {
    const out = applyTint(row([0, 0, 0, 255]), { color: "#ffffff", mode: "paint", strength: 0.5, mask: { kind: "all" } });
    expect(pixels(out)).toEqual([[128, 128, 128, 255]]);
  });

  it("masks by picked colors, by difference from another texture, and by a mask image", () => {
    const ore = row(STONE, ORE, STONE);
    expect([...maskWeights(ore, { color: "#000000", mode: "paint", strength: 1, mask: { kind: "colors", colors: ["#c8c8c8"], tolerance: 0 } }, new Map())]).toEqual([0, 1, 0]);
    const stone = new Map([["minecraft:block/stone", row(STONE, STONE, STONE)]]);
    expect([...maskWeights(ore, { color: "#000000", mode: "paint", strength: 1, mask: { kind: "differs", from: "minecraft:block/stone", tolerance: 16 } }, stone)]).toEqual([0, 1, 0]);
    expect([...maskWeights(ore, { color: "#000000", mode: "paint", strength: 1, mask: { kind: "differs", from: "minecraft:block/stone", tolerance: 16 }, invert: true }, stone)]).toEqual([1, 0, 1]);
    const mask = new Map([["art/mask.png", row([255, 255, 255, 255], [0, 0, 0, 255], [255, 255, 255, 0])]]);
    expect([...maskWeights(ore, { color: "#000000", mode: "paint", strength: 1, mask: { kind: "image", texture: "art/mask.png" } }, mask)]).toEqual([1, 0, 0]);
  });

  it("tiles a one-frame mask down an animated strip", () => {
    const strip: RgbaImage = { width: 1, height: 2, data: new Uint8ClampedArray([...ORE, ...ORE]) };
    const mask = new Map([["art/m.png", row([255, 255, 255, 255])]]);
    expect([...maskWeights(strip, { color: "#000000", mode: "paint", strength: 1, mask: { kind: "image", texture: "art/m.png" } }, mask)]).toEqual([1, 1]);
  });

  it("bakes a recipe: tint only the ore in iron ore", () => {
    const recipe = TintRecipe.parse({
      base: "minecraft:block/iron_ore",
      layers: [{ color: "#c03030", mask: suggestedMask("minecraft:block/iron_ore") }],
    });
    expect(recipe.layers[0]).toMatchObject({ mode: "recolor", strength: 1, mask: { kind: "differs", from: "minecraft:block/stone" } });
    expect(tintTextures(recipe)).toEqual(["minecraft:block/iron_ore", "minecraft:block/stone"]);
    const textures = new Map([
      ["minecraft:block/iron_ore", row(STONE, ORE)],
      ["minecraft:block/stone", row(STONE, STONE)],
    ]);
    expect(pixels(bakeTint(recipe, textures))).toEqual([STONE, [192, 48, 48, 255]]);
    expect(() => bakeTint({ ...recipe, base: "minecraft:block/gold_ore" }, textures)).toThrow("Missing texture minecraft:block/gold_ore");
  });

  it("suggests the host stone for ores", () => {
    expect(suggestedMask("minecraft:block/deepslate_iron_ore")).toEqual({ kind: "differs", from: "minecraft:block/deepslate", tolerance: 16 });
    expect(suggestedMask("minecraft:block/nether_quartz_ore")).toEqual({ kind: "differs", from: "minecraft:block/netherrack", tolerance: 16 });
    expect(suggestedMask("minecraft:item/iron_ingot")).toEqual({ kind: "all" });
  });
});
