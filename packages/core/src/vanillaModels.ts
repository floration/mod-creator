// The shapes of vanilla mob bodies, read from the Minecraft jar by scripts/extract-vanilla.mjs, for the app's 3D
// preview and texture guide. Kept apart from vanillaMobs.ts so the generator never loads them.
import data from "./profiles/v26_3/vanilla/models.json" with { type: "json" };

/** A box in model pixels; `uv` is where its net starts on the texture sheet. */
export interface VanillaCube {
  /** x, y, z, width, height, depth. */
  box: [number, number, number, number, number, number];
  uv: [number, number];
  /** Grown outwards by this much on each axis (an outer layer), without changing its texture. */
  grow?: [number, number, number];
  mirror?: boolean;
  uvScale?: [number, number];
  /** Only these faces are drawn (down, up, north, south, west, east). */
  faces?: string[];
}

export interface VanillaPart {
  name: string;
  /** x, y, z, xRot, yRot, zRot (radians), then x, y, z scale when not 1. */
  pose: number[];
  cubes?: VanillaCube[];
  children?: VanillaPart[];
}

/** Pose of a part as the model animates it: x, y, z, xRot, yRot, zRot, x, y, z scale, visible (1 or 0). */
export type PartPose = number[];

export interface VanillaGeometry {
  textureSize: [number, number];
  root: VanillaPart;
  /** Every part's pose standing still, by path (`body/head`). */
  rest: Record<string, PartPose>;
  /** One walk cycle in 12 frames: the parts that move away from rest. Absent for bodies that don't move. */
  walk?: Record<string, PartPose>[];
}

export const VANILLA_MODELS = data as unknown as Record<string, { adult: VanillaGeometry; baby?: VanillaGeometry }>;
