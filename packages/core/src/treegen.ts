// A port of Minecraft 26.3's tree generator (TreeFeature with its trunk and foliage placers), so the app can show
// exactly the trees the game grows. Each placer follows the game's own code step by step, including the order it
// draws random numbers in, so a seed here gives the same tree as the game's LegacyRandomSource with that seed.
// test/treegen.test.ts checks this against trees the real game generated (scripts/tree-parity).

/** Java's 48-bit linear congruential generator, as Minecraft's LegacyRandomSource uses it. */
export class JavaRandom {
  private seed: bigint;

  constructor(seed: number | bigint) {
    this.seed = (BigInt(seed) ^ 0x5deece66dn) & 0xffffffffffffn;
  }

  next(bits: number): number {
    this.seed = (this.seed * 0x5deece66dn + 0xbn) & 0xffffffffffffn;
    return Number(BigInt.asIntN(32, this.seed >> BigInt(48 - bits)));
  }

  nextInt(bound: number): number {
    if (bound <= 0) throw new Error("Bound must be positive");
    if ((bound & (bound - 1)) === 0) return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n);
    let sample: number;
    let modulo: number;
    do {
      sample = this.next(31);
      modulo = sample % bound;
    } while (((sample - modulo + (bound - 1)) | 0) < 0);
    return modulo;
  }

  nextBoolean(): boolean {
    return this.next(1) !== 0;
  }

  nextFloat(): number {
    return this.next(24) * 5.9604645e-8;
  }
}

const f = Math.fround;

/** Mth.sin / Mth.cos: a 65536-entry float table, not Math.sin. */
function mthSin(x: number): number {
  return f(Math.sin(Number(BigInt.asIntN(64, BigInt(Math.trunc(x * 10430.378350470453))) & 65535n) / 10430.378350470453));
}
function mthCos(x: number): number {
  return f(Math.sin(Number(BigInt.asIntN(64, BigInt(Math.trunc(x * 10430.378350470453 + 16384.0))) & 65535n) / 10430.378350470453));
}

// ---- Int providers (minecraft:uniform, weighted_list, ...) ----

export type IntProvider = number | { type?: string; [key: string]: unknown };

function sample(p: IntProvider, r: JavaRandom): number {
  if (typeof p === "number") return p;
  const type = (p.type ?? "minecraft:uniform").replace(/^minecraft:/, "");
  const min = p.min_inclusive as number;
  const max = p.max_inclusive as number;
  switch (type) {
    case "constant":
      return p.value as number;
    case "uniform":
      return r.nextInt(max - min + 1) + min;
    case "biased_to_bottom":
      return min + r.nextInt(r.nextInt(max - min + 1) + 1);
    case "very_biased_to_bottom":
      return min + r.nextInt(r.nextInt(r.nextInt(max - min + 1) + 1) + 1);
    case "clamped":
      return Math.min(max, Math.max(min, sample(p.source as IntProvider, r)));
    case "weighted_list": {
      const list = p.distribution as { data: IntProvider; weight: number }[];
      let pick = r.nextInt(list.reduce((sum, e) => sum + e.weight, 0));
      for (const e of list) {
        if (pick < e.weight) return sample(e.data, r);
        pick -= e.weight;
      }
      throw new Error("weighted list out of range");
    }
    default:
      throw new Error(`The preview can't sample ${p.type} numbers yet`);
  }
}

function minOf(p: IntProvider): number {
  return typeof p === "number" ? p : (p.min_inclusive as number) ?? (p.value as number);
}
function maxOf(p: IntProvider): number {
  return typeof p === "number" ? p : (p.max_inclusive as number) ?? (p.value as number);
}

// ---- The world the tree grows in ----

export type Axis = "x" | "y" | "z";
/** One block of a grown tree, relative to the sapling. `soil` is the dirt the trunk turns the ground below into. */
export interface TreeBlock {
  x: number;
  y: number;
  z: number;
  kind: "log" | "leaves" | "soil";
  axis?: Axis;
}

type Pos = [number, number, number];
interface Attachment {
  pos: Pos;
  radiusOffset: number;
  heightOffset: number;
  doubleTrunk: boolean;
}

// Directions in the game's enum order, and the horizontal plane's order (NORTH, EAST, SOUTH, WEST).
const DIRS = {
  down: [0, -1, 0],
  up: [0, 1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
} as const;
type Dir = keyof typeof DIRS;
const ALL_DIRS: Dir[] = ["down", "up", "north", "south", "west", "east"];
const HORIZONTAL: Dir[] = ["north", "east", "south", "west"];
const CLOCKWISE: Record<string, Dir> = { north: "east", east: "south", south: "west", west: "north" };
const OPPOSITE: Record<string, Dir> = { north: "south", south: "north", east: "west", west: "east", up: "down", down: "up" };
const axisOf = (d: Dir): Axis => (d === "east" || d === "west" ? "x" : d === "up" || d === "down" ? "y" : "z");
const move = (p: Pos, d: Dir, n = 1): Pos => [p[0] + DIRS[d][0] * n, p[1] + DIRS[d][1] * n, p[2] + DIRS[d][2] * n];
const key = (p: Pos) => `${p[0]},${p[1]},${p[2]}`;

// The game grows the sample tree at y 64 on a flat grass world; so do we, so integer casts of negative
// heights can't differ. Below the sapling is ground.
const BASE_Y = 64;

class World {
  blocks = new Map<string, { pos: Pos; kind: TreeBlock["kind"]; axis?: Axis }>();
  foliage = new Set<string>();

  private at(p: Pos) {
    return this.blocks.get(key(p));
  }
  private isGround(p: Pos) {
    return p[1] < BASE_Y && !this.at(p);
  }
  /** Air or a block trees may replace (leaves). */
  validTreePos(p: Pos): boolean {
    if (this.isGround(p)) return false;
    const b = this.at(p);
    return !b || b.kind === "leaves";
  }
  isFree(p: Pos): boolean {
    return this.validTreePos(p) || this.at(p)?.kind === "log";
  }
  isAirOrLeaves(p: Pos): boolean {
    return this.validTreePos(p);
  }
  isLeaves(p: Pos): boolean {
    return this.at(p)?.kind === "leaves";
  }
  set(p: Pos, kind: TreeBlock["kind"], axis?: Axis) {
    this.blocks.set(key(p), { pos: p, kind, axis });
  }
}

// ---- Trunk placers ----

interface Ctx {
  w: World;
  r: JavaRandom;
}

function placeLog(c: Ctx, p: Pos, axis: Axis = "y"): boolean {
  if (!c.w.validTreePos(p)) return false;
  c.w.set(p, "log", axis);
  return true;
}
function placeBelowTrunk(c: Ctx, p: Pos) {
  c.w.set(p, "soil");
}
const above = (p: Pos, n = 1): Pos => [p[0], p[1] + n, p[2]];
const att = (pos: Pos, radiusOffset: number, doubleTrunk: boolean, heightOffset = 0): Attachment => ({ pos, radiusOffset, heightOffset, doubleTrunk });

type Json = Record<string, any>;

function trunkHeight(t: Json, r: JavaRandom): number {
  return t.base_height + r.nextInt(t.height_rand_a + 1) + r.nextInt(t.height_rand_b + 1);
}

function placeTrunk(t: Json, c: Ctx, h: number, o: Pos): Attachment[] {
  const { w, r } = c;
  switch (t.type.replace(/^minecraft:/, "")) {
    case "straight_trunk_placer": {
      placeBelowTrunk(c, above(o, -1));
      for (let y = 0; y < h; y++) placeLog(c, above(o, y));
      return [att(above(o, h), 0, false)];
    }
    case "forking_trunk_placer": {
      placeBelowTrunk(c, above(o, -1));
      const out: Attachment[] = [];
      const lean = HORIZONTAL[r.nextInt(4)];
      const leanHeight = h - r.nextInt(4) - 1;
      let leanSteps = 3 - r.nextInt(3);
      let tx = o[0];
      let tz = o[2];
      let ey: number | undefined;
      for (let yo = 0; yo < h; yo++) {
        const yy = o[1] + yo;
        if (yo >= leanHeight && leanSteps > 0) {
          tx += DIRS[lean][0];
          tz += DIRS[lean][2];
          leanSteps--;
        }
        if (placeLog(c, [tx, yy, tz])) ey = yy + 1;
      }
      if (ey !== undefined) out.push(att([tx, ey, tz], 1, false));
      tx = o[0];
      tz = o[2];
      const branch = HORIZONTAL[r.nextInt(4)];
      if (branch !== lean) {
        const branchPos = leanHeight - r.nextInt(2) - 1;
        let branchSteps = 1 + r.nextInt(3);
        ey = undefined;
        for (let yo = branchPos; yo < h && branchSteps > 0; branchSteps--) {
          if (yo >= 1) {
            const yy = o[1] + yo;
            tx += DIRS[branch][0];
            tz += DIRS[branch][2];
            if (placeLog(c, [tx, yy, tz])) ey = yy + 1;
          }
          yo++;
        }
        if (ey !== undefined) out.push(att([tx, ey, tz], 0, false));
      }
      return out;
    }
    case "fancy_trunk_placer":
      return fancyTrunk(c, h, o);
    case "giant_trunk_placer":
      return giantTrunk(c, h, o);
    case "mega_jungle_trunk_placer": {
      const out = giantTrunk(c, h, o);
      for (let branchHeight = h - 2 - r.nextInt(4); branchHeight > Math.trunc(h / 2); branchHeight -= 2 + r.nextInt(4)) {
        const angle = f(r.nextFloat() * f(Math.PI * 2));
        let bx = 0;
        let bz = 0;
        for (let b = 0; b < 5; b++) {
          bx = Math.trunc(f(1.5 + f(mthCos(angle) * b)));
          bz = Math.trunc(f(1.5 + f(mthSin(angle) * b)));
          placeLog(c, [o[0] + bx, o[1] + branchHeight - 3 + Math.trunc(b / 2), o[2] + bz]);
        }
        out.push(att([o[0] + bx, o[1] + branchHeight, o[2] + bz], -2, false));
      }
      return out;
    }
    case "dark_oak_trunk_placer": {
      const out: Attachment[] = [];
      const below = above(o, -1);
      for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) placeBelowTrunk(c, [below[0] + dx, below[1], below[2] + dz]);
      const lean = HORIZONTAL[r.nextInt(4)];
      const leanHeight = h - r.nextInt(4);
      let leanSteps = 2 - r.nextInt(3);
      const [x, y, z] = o;
      let tx = x;
      let tz = z;
      const ey = y + h - 1;
      for (let dy = 0; dy < h; dy++) {
        if (dy >= leanHeight && leanSteps > 0) {
          tx += DIRS[lean][0];
          tz += DIRS[lean][2];
          leanSteps--;
        }
        const p: Pos = [tx, y + dy, tz];
        if (w.isAirOrLeaves(p)) {
          placeLog(c, p);
          placeLog(c, [tx + 1, y + dy, tz]);
          placeLog(c, [tx, y + dy, tz + 1]);
          placeLog(c, [tx + 1, y + dy, tz + 1]);
        }
      }
      out.push(att([tx, ey, tz], 0, true));
      for (let ox = -1; ox <= 2; ox++) {
        for (let oz = -1; oz <= 2; oz++) {
          if ((ox < 0 || ox > 1 || oz < 0 || oz > 1) && r.nextInt(3) <= 0) {
            const length = r.nextInt(3) + 2;
            for (let by = 0; by < length; by++) placeLog(c, [x + ox, ey - by - 1, z + oz]);
            out.push(att([x + ox, ey, z + oz], 0, false));
          }
        }
      }
      return out;
    }
    case "bending_trunk_placer": {
      const dir = HORIZONTAL[r.nextInt(4)];
      const logHeight = h - 1;
      let p: Pos = [...o];
      placeBelowTrunk(c, above(p, -1));
      const out: Attachment[] = [];
      for (let i = 0; i <= logHeight; i++) {
        if (i + 1 >= logHeight + r.nextInt(2)) p = move(p, dir);
        if (w.validTreePos(p)) placeLog(c, p);
        if (i >= t.min_height_for_leaves) out.push(att(p, 0, false));
        p = move(p, "up");
      }
      const len = sample(t.bend_length, r);
      for (let i = 0; i <= len; i++) {
        if (w.validTreePos(p)) placeLog(c, p);
        out.push(att(p, 0, false));
        p = move(p, dir);
      }
      return out;
    }
    case "cherry_trunk_placer":
      return cherryTrunk(t, c, h, o);
    case "poplar_trunk_placer": {
      placeBelowTrunk(c, above(o, -1));
      const upTo = h - sample(t.trunk_height_above_branches, r);
      for (let y = 0; y < h; y++) {
        placeLog(c, above(o, y));
        const dirs = shuffledDirs(r).filter((d) => d !== "up" && d !== "down");
        if (upTo - 1 === y) {
          const branches = sample(t.branch_amount, r);
          for (let i = 0; i < branches; i++) placeLog(c, move(above(o, y), dirs[i]), axisOf(dirs[i]));
        }
      }
      return [att(above(o, upTo), 0, false)];
    }
    default:
      throw new Error(`The preview can't draw ${t.type} trunks yet`);
  }
}

function shuffledDirs(r: JavaRandom): Dir[] {
  const list = [...ALL_DIRS];
  for (let i = list.length; i > 1; i--) {
    const to = r.nextInt(i);
    [list[i - 1], list[to]] = [list[to], list[i - 1]];
  }
  return list;
}

function giantTrunk(c: Ctx, h: number, o: Pos): Attachment[] {
  const below = above(o, -1);
  for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) placeBelowTrunk(c, [below[0] + dx, below[1], below[2] + dz]);
  const ifFree = (x: number, y: number, z: number) => {
    const p: Pos = [o[0] + x, o[1] + y, o[2] + z];
    if (c.w.isFree(p)) placeLog(c, p);
  };
  for (let hh = 0; hh < h; hh++) {
    ifFree(0, hh, 0);
    if (hh < h - 1) {
      ifFree(1, hh, 0);
      ifFree(1, hh, 1);
      ifFree(0, hh, 1);
    }
  }
  return [att(above(o, h), 0, true)];
}

function fancyTrunk(c: Ctx, treeHeight: number, o: Pos): Attachment[] {
  const { r } = c;
  const height = treeHeight + 2;
  const trunkHeight = Math.floor(height * 0.618);
  placeBelowTrunk(c, above(o, -1));
  const clustersPerY = Math.min(1, Math.floor(1.382 + Math.pow((1.0 * height) / 13.0, 2.0)));
  const trunkTop = o[1] + trunkHeight;
  let relativeY = height - 5;
  const coords: { pos: Pos; branchBase: number }[] = [{ pos: above(o, relativeY), branchBase: trunkTop }];
  for (; relativeY >= 0; relativeY--) {
    const shape = treeShape(height, relativeY);
    if (shape < 0) continue;
    for (let i = 0; i < clustersPerY; i++) {
      const radius = 1.0 * shape * (r.nextFloat() + 0.328);
      const angle = f(r.nextFloat() * 2.0) * Math.PI;
      const x = radius * Math.sin(angle) + 0.5;
      const z = radius * Math.cos(angle) + 0.5;
      const start: Pos = [o[0] + Math.floor(x), o[1] + relativeY - 1, o[2] + Math.floor(z)];
      if (makeLimb(c, start, above(start, 5), false)) {
        const dx = o[0] - start[0];
        const dz = o[2] - start[2];
        const branchHeight = start[1] - Math.sqrt(dx * dx + dz * dz) * 0.381;
        const branchTop = branchHeight > trunkTop ? trunkTop : Math.trunc(branchHeight);
        const base: Pos = [o[0], branchTop, o[2]];
        if (makeLimb(c, base, start, false)) coords.push({ pos: start, branchBase: base[1] });
      }
    }
  }
  makeLimb(c, o, above(o, trunkHeight), true);
  const trim = (localY: number) => localY >= height * 0.2;
  for (const end of coords) {
    const base: Pos = [o[0], end.branchBase, o[2]];
    if (key(base) !== key(end.pos) && trim(end.branchBase - o[1])) makeLimb(c, base, end.pos, true);
  }
  return coords.filter((e) => trim(e.branchBase - o[1])).map((e) => att(e.pos, 0, false));
}

function treeShape(height: number, y: number): number {
  if (y < f(height * f(0.3))) return -1;
  const radius = f(height / 2);
  const adjacent = f(radius - y);
  let distance = f(Math.sqrt(f(f(radius * radius) - f(adjacent * adjacent))));
  if (adjacent === 0) distance = radius;
  else if (Math.abs(adjacent) >= radius) return 0;
  return f(distance * 0.5);
}

function makeLimb(c: Ctx, start: Pos, end: Pos, doPlace: boolean): boolean {
  if (!doPlace && key(start) === key(end)) return true;
  const delta: Pos = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
  const steps = Math.max(Math.abs(delta[0]), Math.abs(delta[1]), Math.abs(delta[2]));
  const dx = f(delta[0] / steps);
  const dy = f(delta[1] / steps);
  const dz = f(delta[2] / steps);
  for (let i = 0; i <= steps; i++) {
    const p: Pos = [
      start[0] + Math.floor(f(0.5 + f(i * dx))),
      start[1] + Math.floor(f(0.5 + f(i * dy))),
      start[2] + Math.floor(f(0.5 + f(i * dz))),
    ];
    if (doPlace) {
      const xd = Math.abs(p[0] - start[0]);
      const zd = Math.abs(p[2] - start[2]);
      const m = Math.max(xd, zd);
      placeLog(c, p, m > 0 ? (xd === m ? "x" : "z") : "y");
    } else if (!c.w.isFree(p)) {
      return false;
    }
  }
  return true;
}

function cherryTrunk(t: Json, c: Ctx, h: number, o: Pos): Attachment[] {
  const { r } = c;
  placeBelowTrunk(c, above(o, -1));
  const start = t.branch_start_offset_from_top;
  const secondStart = { type: "minecraft:uniform", min_inclusive: minOf(start), max_inclusive: maxOf(start) - 1 };
  const first = Math.max(0, h - 1 + sample(start, r));
  let second = Math.max(0, h - 1 + sample(secondStart, r));
  if (second >= first) second++;
  const count = sample(t.branch_count, r);
  const middle = count === 3;
  const both = count >= 2;
  const trunk = middle ? h : both ? Math.max(first, second) + 1 : first + 1;
  for (let y = 0; y < trunk; y++) placeLog(c, above(o, y));
  const out: Attachment[] = [];
  if (middle) out.push(att(above(o, trunk), 0, false));
  const dir = HORIZONTAL[r.nextInt(4)];
  const branch = (bd: Dir, offset: number, continuesUp: boolean): Attachment => {
    let p = above(o, offset);
    const endOffset = h - 1 + sample(t.branch_end_offset_from_top, r);
    const extend = continuesUp || endOffset < offset;
    const toTrunk = sample(t.branch_horizontal_length, r) + (extend ? 1 : 0);
    const end: Pos = above(move(o, bd, toTrunk), endOffset);
    for (let i = 0; i < (extend ? 2 : 1); i++) {
      p = move(p, bd);
      placeLog(c, p, axisOf(dir));
    }
    const vertical: Dir = end[1] > p[1] ? "up" : "down";
    for (;;) {
      const distance = Math.abs(p[0] - end[0]) + Math.abs(p[1] - end[1]) + Math.abs(p[2] - end[2]);
      if (distance === 0) return att(above(end), 0, false);
      const chance = f(Math.abs(end[1] - p[1]) / distance);
      const up = r.nextFloat() < chance;
      p = move(p, up ? vertical : bd);
      placeLog(c, p, up ? "y" : axisOf(dir));
    }
  };
  out.push(branch(dir, first, first < trunk - 1));
  if (both) out.push(branch(OPPOSITE[dir], second, second < trunk - 1));
  return out;
}

// ---- Foliage placers ----

function tryPlaceLeaf(c: Ctx, p: Pos): boolean {
  if (!c.w.validTreePos(p)) return false;
  c.w.set(p, "leaves");
  c.w.foliage.add(key(p));
  return true;
}

type Skip = (dx: number, y: number, dz: number, radius: number, doubleTrunk: boolean) => boolean;

/** FoliagePlacer.shouldSkipLocationSigned: folds the offsets to distances from the trunk (or 2x2 trunk). */
function signed(skip: Skip): Skip {
  return (dx, y, dz, radius, double) =>
    double
      ? skip(Math.min(Math.abs(dx), Math.abs(dx - 1)), y, Math.min(Math.abs(dz), Math.abs(dz - 1)), radius, double)
      : skip(Math.abs(dx), y, Math.abs(dz), radius, double);
}

function leavesRow(c: Ctx, skipSigned: Skip, o: Pos, radius: number, y: number, double: boolean) {
  const off = double ? 1 : 0;
  for (let dx = -radius; dx <= radius + off; dx++) {
    for (let dz = -radius; dz <= radius + off; dz++) {
      if (!skipSigned(dx, y, dz, radius, double)) tryPlaceLeaf(c, [o[0] + dx, o[1] + y, o[2] + dz]);
    }
  }
}

function leavesRowWithHanging(c: Ctx, skipSigned: Skip, o: Pos, radius: number, y: number, double: boolean, chance: number, extChance: number) {
  leavesRow(c, skipSigned, o, radius, y, double);
  const off = double ? 1 : 0;
  const logPos = above(o, -1);
  const tryExtension = (ch: number, p: Pos) => {
    const d = Math.abs(p[0] - logPos[0]) + Math.abs(p[1] - logPos[1]) + Math.abs(p[2] - logPos[2]);
    if (d >= 7) return false;
    return c.r.nextFloat() > ch ? false : tryPlaceLeaf(c, p);
  };
  for (const along of HORIZONTAL) {
    const toEdge = CLOCKWISE[along];
    const positive = toEdge === "east" || toEdge === "south";
    let p = move(move(above(o, y - 1), toEdge, positive ? radius + off : radius), along, -radius);
    for (let i = -radius; i < radius + off; i++) {
      const leavesAbove = c.w.foliage.has(key(above(p)));
      if (leavesAbove && tryExtension(chance, p)) tryExtension(extChance, above(p, -1));
      p = move(p, along);
    }
  }
}

function foliageHeight(fp: Json, r: JavaRandom, treeHeight: number): number {
  switch (fp.type.replace(/^minecraft:/, "")) {
    case "blob_foliage_placer":
    case "bush_foliage_placer":
    case "fancy_foliage_placer":
    case "jungle_foliage_placer":
      return fp.height;
    case "spruce_foliage_placer":
      return Math.max(4, treeHeight - sample(fp.trunk_height, r));
    case "pine_foliage_placer":
    case "cherry_foliage_placer":
    case "poplar_foliage_placer":
      return sample(fp.height, r);
    case "mega_pine_foliage_placer":
      return sample(fp.crown_height, r);
    case "acacia_foliage_placer":
      return 0;
    case "dark_oak_foliage_placer":
      return 4;
    case "random_spread_foliage_placer":
      return sample(fp.foliage_height, r);
    default:
      throw new Error(`The preview can't draw ${fp.type} leaves yet`);
  }
}

function foliageRadius(fp: Json, r: JavaRandom, trunkHeight: number): number {
  const radius = sample(fp.radius, r);
  if (fp.type.replace(/^minecraft:/, "") === "pine_foliage_placer") return radius + r.nextInt(Math.max(trunkHeight + 1, 1));
  return radius;
}

function createFoliage(fp: Json, c: Ctx, a: Attachment, fh: number, leafRadius: number) {
  const { r } = c;
  const offset = sample(fp.offset, r);
  const double = a.doubleTrunk;
  const pos = a.pos;
  const fhOff = fh + a.heightOffset;
  const row = (skip: Skip, o: Pos, radius: number, y: number) => leavesRow(c, signed(skip), o, radius, y, double);
  switch (fp.type.replace(/^minecraft:/, "")) {
    case "blob_foliage_placer": {
      const skip: Skip = (dx, y, dz, rad) => dx === rad && dz === rad && (r.nextInt(2) === 0 || y === 0);
      for (let yo = offset; yo >= offset - fhOff; yo--) row(skip, pos, Math.max(leafRadius + a.radiusOffset - 1 - Math.trunc(yo / 2), 0), yo);
      return;
    }
    case "bush_foliage_placer": {
      const skip: Skip = (dx, _y, dz, rad) => dx === rad && dz === rad && r.nextInt(2) === 0;
      for (let yo = offset; yo >= offset - fhOff; yo--) row(skip, pos, leafRadius + a.radiusOffset - 1 - yo, yo);
      return;
    }
    case "fancy_foliage_placer": {
      const skip: Skip = (dx, _y, dz, rad) => f(f(f(dx + 0.5) * f(dx + 0.5)) + f(f(dz + 0.5) * f(dz + 0.5))) > rad * rad;
      for (let yo = offset; yo >= offset - fh; yo--) row(skip, pos, leafRadius + (yo !== offset && yo !== offset - fh ? 1 : 0), yo);
      return;
    }
    case "spruce_foliage_placer": {
      const skip: Skip = (dx, _y, dz, rad) => dx === rad && dz === rad && rad > 0;
      let radius = r.nextInt(2);
      let max = 1;
      let min = 0;
      for (let yo = offset; yo >= -fhOff; yo--) {
        row(skip, pos, radius, yo);
        if (radius >= max) {
          radius = min;
          min = 1;
          max = Math.min(max + 1, leafRadius + a.radiusOffset);
        } else radius++;
      }
      return;
    }
    case "pine_foliage_placer": {
      const skip: Skip = (dx, _y, dz, rad) => dx === rad && dz === rad && rad > 0;
      let radius = 0;
      for (let yo = offset; yo >= offset - fhOff; yo--) {
        row(skip, pos, radius, yo);
        if (radius >= 1 && yo === offset - fhOff + 1) radius--;
        else if (radius < leafRadius + a.radiusOffset) radius++;
      }
      return;
    }
    case "mega_pine_foliage_placer": {
      const skip: Skip = (dx, _y, dz, rad) => (dx + dz >= 7 ? true : dx * dx + dz * dz > rad * rad);
      let prev = 0;
      for (let yy = pos[1] - fhOff + offset; yy <= pos[1] + offset; yy++) {
        const yo = pos[1] - yy;
        const smooth = leafRadius + a.radiusOffset + Math.floor(f(f(yo / fhOff) * 3.5));
        const jagged = yo > 0 && smooth === prev && (yy & 1) === 0 ? smooth + 1 : smooth;
        row(skip, [pos[0], yy, pos[2]], jagged, 0);
        prev = smooth;
      }
      return;
    }
    case "jungle_foliage_placer": {
      const skip: Skip = (dx, _y, dz, rad) => (dx + dz >= 7 ? true : dx * dx + dz * dz > rad * rad);
      const leafHeight = (double ? fh : 1 + r.nextInt(2)) + a.heightOffset;
      for (let yo = offset; yo >= offset - leafHeight; yo--) row(skip, pos, leafRadius + a.radiusOffset + 1 - yo, yo);
      return;
    }
    case "acacia_foliage_placer": {
      const skip: Skip = (dx, y, dz, rad) => (y === 0 ? (dx > 1 || dz > 1) && dx !== 0 && dz !== 0 : dx === rad && dz === rad && rad > 0);
      const o = above(pos, offset);
      row(skip, o, leafRadius + a.radiusOffset, -1 - fhOff);
      row(skip, o, leafRadius - 1, -fhOff);
      row(skip, o, leafRadius + a.radiusOffset - 1, 0);
      return;
    }
    case "dark_oak_foliage_placer": {
      const skip: Skip = (dx, y, dz, rad, dbl) => (y === -1 && !dbl ? dx === rad && dz === rad : y === 1 ? dx + dz > rad * 2 - 2 : false);
      const base = signed(skip);
      const skipSigned: Skip = (dx, y, dz, rad, dbl) =>
        y !== 0 || !dbl || (dx !== -rad && dx < rad) || (dz !== -rad && dz < rad) ? base(dx, y, dz, rad, dbl) : true;
      const o = above(pos, offset);
      const drow = (radius: number, y: number) => leavesRow(c, skipSigned, o, radius, y, double);
      if (double) {
        drow(leafRadius + 2, -1);
        drow(leafRadius + 3, 0);
        drow(leafRadius + 2, 1);
        if (r.nextBoolean()) drow(leafRadius, 2);
      } else {
        drow(leafRadius + 2, -1);
        drow(leafRadius + 1, 0);
      }
      return;
    }
    case "random_spread_foliage_placer": {
      for (let i = 0; i < fp.leaf_placement_attempts; i++) {
        const dx = r.nextInt(leafRadius) - r.nextInt(leafRadius);
        const dy = r.nextInt(fh) - r.nextInt(fh);
        const dz = r.nextInt(leafRadius) - r.nextInt(leafRadius);
        tryPlaceLeaf(c, [pos[0] + dx, pos[1] + dy, pos[2] + dz]);
      }
      return;
    }
    case "cherry_foliage_placer": {
      const wide = f(fp.wide_bottom_layer_hole_chance);
      const corner = f(fp.corner_hole_chance);
      const skip: Skip = (dx, y, dz, rad) => {
        if (y === -1 && (dx === rad || dz === rad) && r.nextFloat() < wide) return true;
        const isCorner = dx === rad && dz === rad;
        return rad > 2 ? isCorner || (dx + dz > rad * 2 - 2 && r.nextFloat() < corner) : isCorner && r.nextFloat() < corner;
      };
      const o = above(pos, offset);
      const radius = leafRadius + a.radiusOffset - 1;
      row(skip, o, radius - 2, fhOff - 3);
      row(skip, o, radius - 1, fhOff - 4);
      for (let y = fhOff - 5; y >= 0; y--) row(skip, o, radius, y);
      const hang = f(fp.hanging_leaves_chance);
      const ext = f(fp.hanging_leaves_extension_chance);
      leavesRowWithHanging(c, signed(skip), o, radius, -1, double, hang, ext);
      leavesRowWithHanging(c, signed(skip), o, radius - 1, -2, double, hang, ext);
      return;
    }
    case "poplar_foliage_placer":
      return poplarFoliage(fp, c, a, fh, leafRadius, offset);
    default:
      throw new Error(`The preview can't draw ${fp.type} leaves yet`);
  }
}

function poplarFoliage(fp: Json, c: Ctx, a: Attachment, fh: number, leafRadius: number, offset: number) {
  const { r, w } = c;
  const double = a.doubleTrunk;
  const o = above(a.pos, offset);
  const radius = leafRadius + a.radiusOffset - 1;
  const flip = r.nextBoolean();
  const fhOff = fh + a.heightOffset;
  const sideHole = f(fp.side_hole_chance);
  const partial = (y: number) => fhOff - 1 === y || fhOff - 2 === y;
  const cornerCut = (dx: number, dz: number, rad: number, part: boolean) => {
    const small = flip ? (dx > 0 && dz > 0) || (dz < 0 && dx < 0) : (dx > 0 && dz < 0) || (dz > 0 && dx < 0);
    return small ? rad - 1 : part ? rad + 1 : rad;
  };
  const within = (rad: number, ax: number, az: number, cut: number, extra: number) => ax + az <= rad * 2 - (cut + extra);
  const off = double ? 1 : 0;
  const row = (rad: number, y: number) => {
    for (let dx = -rad; dx <= rad + off; dx++) {
      for (let dz = -rad; dz <= rad + off; dz++) {
        const part = partial(y);
        const cut = cornerCut(dx, dz, rad, part);
        const ax = Math.abs(dx);
        const az = Math.abs(dz);
        let skip: boolean;
        if (part && (ax === rad || az === rad)) skip = true;
        else skip = !within(rad, ax, az, cut, r.nextFloat() <= sideHole ? 1 : 0);
        if (!skip) tryPlaceLeaf(c, [o[0] + dx, o[1] + y, o[2] + dz]);
      }
    }
  };
  row(radius - 2, fhOff - 1);
  row(radius - 1, fhOff - 2);
  row(radius - 1, fhOff - 3);
  for (let y = fhOff - 4; y >= 1; y--) row(radius, y);
  const logY = fhOff - 4;
  for (let dx = -radius; dx <= radius + off; dx++) {
    for (let dz = -radius; dz <= radius + off; dz++) {
      const ax = Math.abs(dx);
      const az = Math.abs(dz);
      if (within(radius, ax, az, cornerCut(dx, dz, radius, partial(logY)), 2) && ((az === 0 && radius - ax >= 4) || (ax === 0 && radius - az >= 4))) {
        const p: Pos = [o[0] + dx, o[1] + logY, o[2] + dz];
        if (w.isLeaves(p)) {
          w.set(p, "log", az === 0 ? "x" : "z");
          w.foliage.add(key(p));
        }
      }
    }
  }
  row(radius - 1, 0);
  row(Math.min(2, Math.max(1, radius - 2)), -1);
}

// ---- TreeFeature ----

/**
 * Grows a `minecraft:tree` feature config (the JSON in data/<mod>/worldgen/feature/<tree>.json, or just its
 * `trunk_placer` and `foliage_placer`) the way the game does in open air on flat grass, with the given seed.
 */
export function growTree(config: { trunk_placer: Json; foliage_placer: Json }, seed: number | bigint): TreeBlock[] {
  const r = new JavaRandom(seed);
  const c: Ctx = { w: new World(), r };
  const treeHeight = trunkHeight(config.trunk_placer, r);
  const fh = foliageHeight(config.foliage_placer, r, treeHeight);
  const leafRadius = foliageRadius(config.foliage_placer, r, treeHeight - fh);
  const attachments = placeTrunk(config.trunk_placer, c, treeHeight, [0, BASE_Y, 0]);
  for (const a of attachments) createFoliage(config.foliage_placer, c, a, fh, leafRadius);
  return [...c.w.blocks.values()].map(({ pos, kind, axis }) => ({ x: pos[0], y: pos[1] - BASE_Y, z: pos[2], kind, ...(axis ? { axis } : {}) }));
}
