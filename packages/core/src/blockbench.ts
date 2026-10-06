/**
 * Reads Blockbench `.bbmodel` files (the "Modded Entity" format, box UV) into Minecraft's entity model terms:
 * parts with a pivot and rotation, boxes textured from a sheet, and keyframe animations. Everything here is
 * already in Minecraft's model space (pixels, y down, 24 at the feet), so the Java generator and the app's
 * preview both use it as is. No Node imports: the app's window imports this file too.
 */

export type Vec3 = [number, number, number];

export interface ModelBox {
  /** Texture offset on the sheet. */
  u: number;
  v: number;
  /** Corner and size, relative to the part's pivot: x, y, z, width, height, depth. */
  box: [number, number, number, number, number, number];
  inflate: number;
  mirror: boolean;
}

export interface ModelPartDef {
  /** Unique within the model: animations and hand-written code find parts by name. */
  name: string;
  /** Relative to the parent part (or to the model origin for top-level parts). */
  pivot: Vec3;
  /** Radians, applied z, then y, then x, like Minecraft. */
  rotation: Vec3;
  boxes: ModelBox[];
  children: ModelPartDef[];
}

export interface ModelKeyframe {
  /** Seconds. */
  time: number;
  /**
   * The values Minecraft's helpers take: degrees for rotation (`KeyframeAnimations.degreeVec`), pixels for
   * position (`posVec`, which flips y itself) and factors for scale (`scaleVec`).
   */
  value: Vec3;
  interpolation: "linear" | "catmullrom";
}

export type AnimationTarget = "rotation" | "position" | "scale";

export interface ModelAnimation {
  name: string;
  /** Seconds. */
  length: number;
  loop: boolean;
  /** Part name to its channels. */
  bones: Record<string, Partial<Record<AnimationTarget, ModelKeyframe[]>>>;
}

export interface EntityModelDef {
  textureWidth: number;
  textureHeight: number;
  parts: ModelPartDef[];
  animations: ModelAnimation[];
  /** The first texture embedded in the file, as a data: URL, when there is one. */
  embeddedTexture: string | null;
}

/** The animation an entity plays while walking and the one it loops all the time, picked by name. */
export function pickAnimations(model: EntityModelDef): { walk: ModelAnimation | null; idle: ModelAnimation | null } {
  const find = (word: string) => model.animations.find((a) => a.name.toLowerCase().includes(word)) ?? null;
  return { walk: find("walk") ?? find("move") ?? find("fly"), idle: find("idle") };
}

const RAD = Math.PI / 180;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const vec = (v: unknown, fallback: Vec3 = [0, 0, 0]): Vec3 =>
  Array.isArray(v) && v.length >= 3 && v.every((n) => typeof n === "number") ? [v[0], v[1], v[2]] : fallback;
const round = (n: number) => Math.round(n * 1e4) / 1e4 + 0; // + 0 turns -0 into 0

/** Turn a Blockbench name into a part name: lowercase letters, digits and underscores, unique in the model. */
function namer() {
  const used = new Set<string>();
  return (raw: unknown, fallback: string) => {
    let base = String(raw ?? "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || fallback;
    if (/^[0-9]/.test(base)) base = `part_${base}`;
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}_${n}`;
    used.add(name);
    return name;
  };
}

/** Where `point` sits relative to `origin`, in Minecraft's axes (x and y flipped). */
const relative = (point: Vec3, origin: Vec3): Vec3 => [round(origin[0] - point[0]), round(origin[1] - point[1]), round(point[2] - origin[2])];

const mcRotation = (r: Vec3): Vec3 => [round(-r[0] * RAD), round(-r[1] * RAD), round(r[2] * RAD)];

/** Parse a `.bbmodel` file's JSON. Throws an Error that says what to change in Blockbench. */
export function parseBlockbench(input: unknown): EntityModelDef {
  const file = obj(input);
  const meta = obj(file.meta);
  if (!Array.isArray(file.elements) || !Array.isArray(file.outliner)) throw new Error("This is not a Blockbench model (.bbmodel)");
  const resolution = obj(file.resolution);
  const textureWidth = typeof resolution.width === "number" ? resolution.width : 64;
  const textureHeight = typeof resolution.height === "number" ? resolution.height : 64;
  const fileBoxUv = meta.box_uv !== false;

  const elements = new Map<string, Json>();
  for (const e of file.elements.map(obj)) if (typeof e.uuid === "string") elements.set(e.uuid, e);
  // Blockbench 5 keeps groups in their own list and the outliner holds only their ids and children.
  const groups = new Map<string, Json>();
  for (const g of (Array.isArray(file.groups) ? file.groups : []).map(obj)) if (typeof g.uuid === "string") groups.set(g.uuid, g);

  const name = namer();
  const partOf = new Map<string, string>();

  const boxFor = (e: Json, origin: Vec3): ModelBox => {
    const label = String(e.name ?? "cube");
    if (e.type !== undefined && e.type !== "cube") throw new Error(`"${label}" is a ${String(e.type)}; Minecraft entity models can only use cubes`);
    const boxUv = typeof e.box_uv === "boolean" ? e.box_uv : fileBoxUv;
    if (!boxUv) throw new Error(`"${label}" uses per-face UV. Switch the model to Box UV (File > Project, or the cube's UV panel)`);
    const from = vec(e.from);
    const to = vec(e.to);
    const [u, v] = Array.isArray(e.uv_offset) ? (e.uv_offset as number[]) : [0, 0];
    const [x, y, z] = relative([to[0], to[1], from[2]], origin);
    return {
      u: Math.floor(u ?? 0),
      v: Math.floor(v ?? 0),
      box: [x, y, z, round(to[0] - from[0]), round(to[1] - from[1]), round(to[2] - from[2])],
      inflate: typeof e.inflate === "number" ? e.inflate : 0,
      mirror: e.mirror_uv === true,
    };
  };

  /** A rotated cube becomes its own small part, because Minecraft can only rotate parts. */
  const rotatedCube = (e: Json, parentOrigin: Vec3): ModelPartDef => {
    const origin = vec(e.origin);
    return {
      name: name(`${String(e.name ?? "cube")}_r`, "cube_r"),
      pivot: relative(origin, parentOrigin),
      rotation: mcRotation(vec(e.rotation)),
      boxes: [boxFor(e, origin)],
      children: [],
    };
  };

  const isRotated = (e: Json) => vec(e.rotation).some((r) => r !== 0);
  const exported = (j: Json) => j.export !== false;

  const group = (node: Json, parentOrigin: Vec3 | null): ModelPartDef => {
    const g = typeof node.name === "string" ? node : { ...obj(groups.get(String(node.uuid))), children: node.children };
    const origin = vec(g.origin);
    const part: ModelPartDef = {
      name: name(g.name, "part"),
      pivot: parentOrigin ? relative(origin, parentOrigin) : [round(-origin[0]), round(24 - origin[1]), round(origin[2])],
      rotation: mcRotation(vec(g.rotation)),
      boxes: [],
      children: [],
    };
    if (typeof g.uuid === "string") partOf.set(g.uuid, part.name);
    for (const child of Array.isArray(g.children) ? g.children : []) {
      if (typeof child === "string") {
        const e = elements.get(child);
        if (!e || !exported(e)) continue;
        if (isRotated(e)) part.children.push(rotatedCube(e, origin));
        else part.boxes.push(boxFor(e, origin));
      } else {
        const c = obj(child);
        const resolved = typeof c.name === "string" ? c : obj(groups.get(String(c.uuid)));
        if (exported(resolved)) part.children.push(group(c, origin));
      }
    }
    return part;
  };

  const parts: ModelPartDef[] = [];
  const loose: string[] = [];
  for (const node of file.outliner) {
    if (typeof node === "string") loose.push(node);
    else if (exported(obj(node)) && exported(obj(groups.get(String(obj(node).uuid))))) parts.push(group(obj(node), null));
  }
  // Cubes outside any group go in one part at the origin, the way Blockbench's own Java export does.
  if (loose.length > 0) {
    parts.push(group({ name: "bb_main", origin: [0, 0, 0], children: loose }, null));
  }
  if (parts.length === 0) throw new Error("The model has no cubes");

  const animations: ModelAnimation[] = [];
  for (const a of (Array.isArray(file.animations) ? file.animations : []).map(obj)) {
    const anim: ModelAnimation = {
      name: String(a.name ?? "animation"),
      length: typeof a.length === "number" ? a.length : 0,
      loop: a.loop === "loop",
      bones: {},
    };
    for (const [uuid, animator] of Object.entries(obj(a.animators)).map(([k, v]) => [k, obj(v)] as const)) {
      if (animator.type !== undefined && animator.type !== "bone") continue;
      const bone = partOf.get(uuid);
      if (!bone) continue;
      const channels: Partial<Record<AnimationTarget, ModelKeyframe[]>> = {};
      for (const k of (Array.isArray(animator.keyframes) ? animator.keyframes : []).map(obj)) {
        const channel = k.channel as AnimationTarget;
        if (!["rotation", "position", "scale"].includes(channel)) continue;
        const point = obj(Array.isArray(k.data_points) ? k.data_points[0] : undefined);
        const raw = ["x", "y", "z"].map((axis) => Number(typeof point[axis] === "string" ? (point[axis] as string).trim() || "0" : point[axis] ?? 0));
        if (raw.some((n) => !Number.isFinite(n))) {
          throw new Error(`Animation "${anim.name}" uses a Molang expression on "${bone}". Use plain numbers in keyframes`);
        }
        const [x, y, z] = raw;
        const value: Vec3 = channel === "rotation" ? [round(-x), round(-y), round(z)] : channel === "position" ? [round(-x), round(y), round(z)] : [x, y, z];
        (channels[channel] ??= []).push({
          time: typeof k.time === "number" ? k.time : 0,
          value,
          interpolation: k.interpolation === "catmullrom" ? "catmullrom" : "linear",
        });
      }
      for (const list of Object.values(channels)) list!.sort((p, q) => p.time - q.time);
      if (Object.keys(channels).length > 0) anim.bones[bone] = channels;
    }
    animations.push(anim);
  }

  const texture = (Array.isArray(file.textures) ? file.textures : []).map(obj).find((t) => typeof t.source === "string" && t.source.startsWith("data:image/png"));
  return { textureWidth, textureHeight, parts, animations, embeddedTexture: texture ? String(texture.source) : null };
}

/** Every part in the model, depth first. */
export function allParts(parts: ModelPartDef[]): ModelPartDef[] {
  return parts.flatMap((p) => [p, ...allParts(p.children)]);
}

/** Linear or Catmull-Rom value of one channel at `time` seconds, the way Minecraft samples keyframes. */
export function sampleChannel(frames: ModelKeyframe[], time: number): Vec3 {
  if (frames.length === 0) return [0, 0, 0];
  let next = frames.findIndex((f) => f.time > time);
  if (next === -1) return frames[frames.length - 1].value;
  if (next === 0) return frames[0].value;
  const a = frames[next - 1];
  const b = frames[next];
  const t = (time - a.time) / (b.time - a.time || 1);
  if (b.interpolation === "catmullrom") {
    const p0 = frames[Math.max(0, next - 2)].value;
    const p3 = frames[Math.min(frames.length - 1, next + 1)].value;
    return [0, 1, 2].map((i) => {
      const [v0, v1, v2, v3] = [p0[i], a.value[i], b.value[i], p3[i]];
      return 0.5 * (2 * v1 + (-v0 + v2) * t + (2 * v0 - 5 * v1 + 4 * v2 - v3) * t * t + (-v0 + 3 * v1 - 3 * v2 + v3) * t * t * t);
    }) as Vec3;
  }
  return [0, 1, 2].map((i) => a.value[i] + (b.value[i] - a.value[i]) * t) as Vec3;
}
