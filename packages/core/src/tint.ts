import { z } from "zod";

/**
 * Color masks, the way Factorio mods recolor sprites: start from a texture (often a vanilla one), pick which pixels a
 * layer touches with a mask, and tint them. The result is baked into an ordinary PNG in art/, and the recipe is kept
 * next to it as `<name>.tint.json` so the tint can be reopened and changed later.
 *
 * Everything here works on plain RGBA arrays, so the app's window and Node can both use it.
 */

/** An RGBA image, one byte per channel, rows top to bottom. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** A vanilla texture like `minecraft:block/iron_ore`, or a project PNG like `art/ruby_ore.png`. */
const TextureRef = z.string().min(1);

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a color like #c03030");

export const TintMask = z.discriminatedUnion("kind", [
  /** Every pixel. */
  z.object({ kind: z.literal("all") }),
  /** Pixels whose color is close to one of these, like just the gem dots of an ore. */
  z.object({ kind: z.literal("colors"), colors: z.array(Hex), tolerance: z.number().min(0).max(255).default(24) }),
  /** Pixels that differ from another texture: iron ore against stone leaves only the ore. */
  z.object({ kind: z.literal("differs"), from: TextureRef, tolerance: z.number().min(0).max(255).default(16) }),
  /** A mask image: white (and opaque) pixels are tinted fully, black or transparent ones not at all, greys partly. */
  z.object({ kind: z.literal("image"), texture: TextureRef }),
]);
export type TintMask = z.infer<typeof TintMask>;

/**
 * - `recolor` keeps the shading but moves the masked pixels' average to the chosen color (darker pixels stay darker).
 * - `multiply` multiplies by the color, like Factorio's tint; best on grey textures.
 * - `paint` covers the masked pixels with the flat color.
 */
export const TintMode = z.enum(["recolor", "multiply", "paint"]);
export type TintMode = z.infer<typeof TintMode>;

export const TintLayer = z.object({
  color: Hex,
  mode: TintMode.default("recolor"),
  /** 0 leaves the pixels alone, 1 applies the tint fully. */
  strength: z.number().min(0).max(1).default(1),
  mask: TintMask.default({ kind: "all" }),
  /** Tint the pixels the mask leaves out instead. */
  invert: z.boolean().optional(),
});
export type TintLayer = z.infer<typeof TintLayer>;

export const TintRecipe = z.object({
  /** The texture the tint starts from. */
  base: TextureRef,
  /** Applied in order, each on the result of the one before. */
  layers: z.array(TintLayer),
});
export type TintRecipe = z.infer<typeof TintRecipe>;

/** Where the recipe for a tinted PNG lives: `art/ruby_ore.png` -> `art/ruby_ore.tint.json`. */
export function tintRecipePath(png: string): string {
  return png.replace(/\.png$/i, "") + ".tint.json";
}

export function isVanillaTexture(ref: string): boolean {
  return /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(ref) && !ref.endsWith(".png");
}

/** Every texture a recipe reads, so they can be loaded before baking. */
export function tintTextures(recipe: TintRecipe): string[] {
  const refs = new Set([recipe.base]);
  for (const l of recipe.layers) {
    if (l.mask.kind === "differs") refs.add(l.mask.from);
    if (l.mask.kind === "image") refs.add(l.mask.texture);
  }
  return [...refs];
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * Pixel (x, y) of `img` when it stands in for a `w`x`h` image. Same width and a height that divides evenly tiles down
 * the strip (a 16x16 mask over a 16x64 animated texture covers every frame); otherwise it scales, nearest pixel.
 */
function sample(img: RgbaImage, x: number, y: number, w: number, h: number): number {
  let sx: number;
  let sy: number;
  if (img.width === w && h % img.height === 0) {
    sx = x;
    sy = y % img.height;
  } else {
    sx = Math.min(img.width - 1, Math.floor((x * img.width) / w));
    sy = Math.min(img.height - 1, Math.floor((y * img.height) / h));
  }
  return (sy * img.width + sx) * 4;
}

/** How much a layer applies to each pixel, 0 to 1. Transparent pixels are never tinted. */
export function maskWeights(base: RgbaImage, layer: TintLayer, textures: ReadonlyMap<string, RgbaImage>): Float32Array {
  const { width: w, height: h, data } = base;
  const out = new Float32Array(w * h);
  const m = layer.mask;
  const colors = m.kind === "colors" ? m.colors.map(hexToRgb) : [];
  const other = m.kind === "differs" ? textures.get(m.from) : m.kind === "image" ? textures.get(m.texture) : undefined;
  if ((m.kind === "differs" || m.kind === "image") && !other) {
    throw new Error(`Missing texture ${m.kind === "differs" ? m.from : m.texture}`);
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] === 0) continue;
      let weight = 1;
      if (m.kind === "colors") {
        weight = colors.some(([r, g, b]) => Math.max(Math.abs(data[i] - r), Math.abs(data[i + 1] - g), Math.abs(data[i + 2] - b)) <= m.tolerance) ? 1 : 0;
      } else if (m.kind === "differs") {
        const j = sample(other!, x, y, w, h);
        const o = other!.data;
        const diff = Math.max(Math.abs(data[i] - o[j]), Math.abs(data[i + 1] - o[j + 1]), Math.abs(data[i + 2] - o[j + 2]), Math.abs(data[i + 3] - o[j + 3]));
        weight = diff > m.tolerance ? 1 : 0;
      } else if (m.kind === "image") {
        const j = sample(other!, x, y, w, h);
        const o = other!.data;
        weight = (luma(o[j], o[j + 1], o[j + 2]) / 255) * (o[j + 3] / 255);
      }
      out[y * w + x] = layer.invert ? 1 - weight : weight;
    }
  }
  return out;
}

/** Apply one layer to a copy of `img`. */
export function applyTint(img: RgbaImage, layer: TintLayer, textures: ReadonlyMap<string, RgbaImage> = new Map()): RgbaImage {
  const weights = maskWeights(img, layer, textures);
  const src = img.data;
  const data = new Uint8ClampedArray(src);
  const tint = hexToRgb(layer.color);
  // Recolor maps the masked pixels' average brightness to the tint, black to black and white to white.
  let mean = 0;
  if (layer.mode === "recolor") {
    let total = 0;
    for (let p = 0; p < weights.length; p++) {
      if (!weights[p]) continue;
      mean += luma(src[p * 4], src[p * 4 + 1], src[p * 4 + 2]) * weights[p];
      total += weights[p];
    }
    mean = total ? mean / total : 0;
  }
  for (let p = 0; p < weights.length; p++) {
    const k = weights[p] * layer.strength;
    if (k <= 0) continue;
    const i = p * 4;
    const l = luma(src[i], src[i + 1], src[i + 2]);
    for (let c = 0; c < 3; c++) {
      let v: number;
      if (layer.mode === "multiply") v = (src[i + c] * tint[c]) / 255;
      else if (layer.mode === "paint") v = tint[c];
      else if (mean <= 0 || mean >= 255) v = tint[c];
      else if (l <= mean) v = (tint[c] * l) / mean;
      else v = tint[c] + ((255 - tint[c]) * (l - mean)) / (255 - mean);
      data[i + c] = Math.round(src[i + c] + (v - src[i + c]) * k);
    }
  }
  return { width: img.width, height: img.height, data };
}

/** The finished texture: the base with every layer applied in order. `textures` holds every ref from `tintTextures`. */
export function bakeTint(recipe: TintRecipe, textures: ReadonlyMap<string, RgbaImage>): RgbaImage {
  const base = textures.get(recipe.base);
  if (!base) throw new Error(`Missing texture ${recipe.base}`);
  return recipe.layers.reduce((img, layer) => applyTint(img, layer, textures), base);
}

/** A sensible first mask for a base texture: ores compare against the stone they sit in, so only the ore is tinted. */
export function suggestedMask(base: string): TintMask {
  const m = /^minecraft:block\/(deepslate_|nether_)?([a-z_]+)_ore$/.exec(base);
  if (!m) return { kind: "all" };
  const host = m[1] === "deepslate_" ? "deepslate" : m[1] === "nether_" ? "netherrack" : "stone";
  return { kind: "differs", from: `minecraft:block/${host}`, tolerance: 16 };
}
