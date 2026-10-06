import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { pickAnimations, sampleChannel, type EntityModelDef, type ModelAnimation, type ModelPartDef } from "@modcreator/core/blockbench";
import { VANILLA_MOBS } from "@modcreator/core/vanilla-mobs";
import { VANILLA_MODELS, type PartPose, type VanillaGeometry, type VanillaPart } from "@modcreator/core/vanilla-models";
import { api, type ElementSpec } from "./api";

/** Minecraft's fixed face shading: the top is brightest, the bottom darkest. */
const SHADE = { top: 1.0, bottom: 0.5, northSouth: 0.8, eastWest: 0.6 };

/** Which art file each face of a full cube uses, in three.js BoxGeometry order: +x, -x, +y, -y, +z, -z. */
function cubeFaces(spec: ElementSpec): string[] | null {
  if (spec.kind !== "block") return null;
  const m = spec.block.model;
  if (m.type === "cube_all") return Array(6).fill(m.texture);
  if (m.type === "cube_column") return [m.side, m.side, m.end, m.end, m.side, m.side];
  return null;
}

export function pixelTexture(url: string): Promise<THREE.Texture> {
  return new THREE.TextureLoader().loadAsync(url).then((t) => {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

type Loader = (file: string | undefined) => Promise<THREE.Texture | null>;

function loader(root: string): Loader {
  const cache = new Map<string, Promise<THREE.Texture | null>>();
  return (file) => {
    if (!file) return Promise.resolve(null);
    if (!cache.has(file)) cache.set(file, api().dataUrl(root, file).then((url) => (url ? pixelTexture(url) : null)));
    return cache.get(file)!;
  };
}

function shaded(tex: THREE.Texture | null, shade = 1): THREE.Material {
  if (!tex) return new THREE.MeshBasicMaterial({ color: 0xff00ff });
  return new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(shade, shade, shade), transparent: true, alphaTest: 0.1, side: THREE.DoubleSide });
}

export const CUBE_SHADES = [SHADE.eastWest, SHADE.eastWest, SHADE.top, SHADE.bottom, SHADE.northSouth, SHADE.northSouth];

/** A one-block cube; faces in BoxGeometry order (+x, -x, +y, -y, +z, -z). */
async function cube(load: Loader, faces: (string | undefined)[]): Promise<THREE.Mesh> {
  const textures = await Promise.all(faces.map(load));
  return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), textures.map((t, i) => shaded(t, CUBE_SHADES[i])));
}

async function flat(load: Loader, file: string | undefined): Promise<THREE.Mesh> {
  return new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shaded(await load(file)));
}

/** Two planes crossed at 45 degrees, like grass and saplings. */
async function cross(load: Loader, file: string | undefined): Promise<THREE.Group> {
  const material = shaded(await load(file));
  const group = new THREE.Group();
  for (const angle of [Math.PI / 4, -Math.PI / 4]) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    plane.rotation.y = angle;
    group.add(plane);
  }
  return group;
}

/** A small tree: a log trunk with a rounded block of leaves, the way an oak looks. */
async function tree(load: Loader, t: { logSide: string; logEnd: string; leaves: string; trunkHeight?: number }): Promise<THREE.Group> {
  const group = new THREE.Group();
  const trunk = Math.min(6, Math.max(3, t.trunkHeight ?? 4));
  const log = await cube(load, [t.logSide, t.logSide, t.logEnd, t.logEnd, t.logSide, t.logSide]);
  const leaves = await cube(load, Array(6).fill(t.leaves));
  for (let y = 0; y < trunk; y++) {
    const block = log.clone();
    block.position.set(0, y + 0.5, 0);
    group.add(block);
  }
  for (let y = trunk - 1; y <= trunk + 1; y++) {
    const r = y >= trunk ? 1 : 2;
    for (let x = -r; x <= r; x++) {
      for (let z = -r; z <= r; z++) {
        if (x === 0 && z === 0 && y < trunk) continue;
        if (Math.abs(x) === r && Math.abs(z) === r && (r === 2 || y === trunk + 1)) continue;
        const block = leaves.clone();
        block.position.set(x, y + 0.5, z);
        group.add(block);
      }
    }
  }
  group.scale.setScalar(1 / (trunk + 2));
  return group;
}

/**
 * A box of a Minecraft entity model, textured from its sheet (64x64 unless given) the way the game does: the box's
 * net starts at (u, v), top and bottom first, then the four sides. Coordinates are model pixels (y down, front
 * towards -z).
 */
function modelBox(
  material: THREE.Material,
  u: number,
  v: number,
  box: number[],
  sheet: [number, number] = [64, 64],
  mirror = false,
  /** Vanilla outer layers: the box grows, its texture net keeps the box's own size. */
  grow: number[] = [0, 0, 0],
  uvScale: number[] = [1, 1],
  /** Faces to draw, by Minecraft direction; all when absent. */
  faces?: string[],
): THREE.Mesh {
  const [x, y, z, w, h, d] = box;
  const [gx, gy, gz] = grow;
  const geometry = new THREE.BoxGeometry(w + 2 * gx, h + 2 * gy, d + 2 * gz);
  geometry.translate(x + w / 2, y + h / 2, z + d / 2);
  // Rectangles on the sheet (left, top, width, height) for BoxGeometry's faces: +x, -x, +y, -y, +z, -z.
  // Model y points down, so +y is the underside and -y the top.
  const rects = [
    [u + d + w, v + d, d, h],
    [u, v + d, d, h],
    [u + d + w, v, w, d],
    [u + d, v, w, d],
    [u + d + w + d, v + d, w, h],
    [u + d, v + d, w, h],
  ];
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  // Box UV sizes are whole pixels on the sheet even when the box itself isn't.
  rects.forEach((rect) => {
    rect[2] = Math.floor(rect[2]);
    rect[3] = Math.floor(rect[3]);
  });
  if (uvScale[0] !== 1 || uvScale[1] !== 1) {
    for (const rect of rects) {
      rect[0] = u + (rect[0] - u) * uvScale[0];
      rect[1] = v + (rect[1] - v) * uvScale[1];
      rect[2] *= uvScale[0];
      rect[3] *= uvScale[1];
    }
  }
  if (mirror) {
    // A mirrored box swaps its east and west faces and flips every face left to right.
    [rects[0], rects[1]] = [rects[1], rects[0]];
    for (const rect of rects) {
      rect[0] += rect[2];
      rect[2] = -rect[2];
    }
  }
  const [sw, sh] = sheet;
  rects.forEach(([left, top, width, height], face) => {
    const [l, r, t, b] = [left / sw, (left + width) / sw, 1 - top / sh, 1 - (top + height) / sh];
    // BoxGeometry's four corners per face: top-left, top-right, bottom-left, bottom-right in its own up direction.
    // The model is flipped upside down when drawn, so each face's rows are swapped.
    const corners = face === 2 || face === 3 ? [[l, t], [r, t], [l, b], [r, b]] : [[l, b], [r, b], [l, t], [r, t]];
    corners.forEach(([cu, cv], i) => uv.setXY(face * 4 + i, cu, cv));
  });
  if (faces) {
    // BoxGeometry's face order in Minecraft's directions.
    const order = ["east", "west", "up", "down", "south", "north"];
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    return new THREE.Mesh(geometry, order.map((f) => (faces.includes(f) ? material : hidden)));
  }
  return new THREE.Mesh(geometry, material);
}

/** The faces of each box of a vanilla mob body on its sheet, as [left, top, width, height], for the texture editor's guide. */
export function mobSheetLayout(model: string): [number, number, number, number][] | null {
  const geometry = VANILLA_MODELS[model]?.adult;
  if (!geometry) return null;
  const boxes: { uv: [number, number]; box: number[] }[] = [];
  const walk = (part: VanillaPart) => {
    for (const c of part.cubes ?? []) {
      const [su, sv] = c.uvScale ?? [1, 1];
      boxes.push({ uv: c.uv, box: [0, 0, 0, c.box[3] * su, c.box[4] * sv, c.box[5] * su] });
    }
    part.children?.forEach(walk);
  };
  walk(geometry.root);
  return sheetLayout(boxes);
}

/** The same guide for a Blockbench model's boxes. */
export function blockbenchSheetLayout(model: EntityModelDef): [number, number, number, number][] {
  const boxes = (parts: ModelPartDef[]): { uv: [number, number]; box: number[] }[] =>
    parts.flatMap((p) => [...p.boxes.map((b) => ({ uv: [b.u, b.v] as [number, number], box: b.box })), ...boxes(p.children)]);
  return sheetLayout(boxes(model.parts));
}

function sheetLayout(boxes: { uv: [number, number]; box: number[] }[]): [number, number, number, number][] {
  return boxes.flatMap(({ uv: [u, v], box: [, , , bw, bh, bd] }) => {
    const [w, h, d] = [bw, bh, bd].map(Math.floor);
    return [
    [u + d, v, w, d],
    [u + d + w, v, w, d],
    [u, v + d, d, h],
    [u + d, v + d, w, h],
    [u + d + w, v + d, d, h],
    [u + d + w + d, v + d, w, h],
  ] as [number, number, number, number][];
  });
}

/** Sets a part to a pose: position, ZYX rotation, scale and visibility, as Minecraft's ModelPart applies them. */
function applyPose(part: THREE.Object3D, pose: PartPose | number[]): void {
  part.position.set(pose[0], pose[1], pose[2]);
  part.rotation.set(pose[3], pose[4], pose[5], "ZYX");
  part.scale.set(pose[6] ?? 1, pose[7] ?? 1, pose[8] ?? 1);
  part.visible = (pose[9] ?? 1) !== 0;
}

/**
 * A vanilla mob body from the shapes read out of the jar, with a tick that plays the vanilla walk cycle, posed by
 * running the game's own animation code when the data was extracted.
 */
async function vanillaMob(load: Loader, model: string, texture: string, scale: number): Promise<THREE.Group | null> {
  const geometry: VanillaGeometry | undefined = VANILLA_MODELS[model]?.adult;
  if (!geometry) return null;
  let tex = await load(texture);
  // No texture yet: show the vanilla one from the player's Minecraft jar, if the app found it.
  const fallback = VANILLA_MOBS.models[model]?.texture;
  if (!tex && fallback) {
    const url = await api().vanillaTexture(fallback).catch(() => null);
    if (url) tex = await pixelTexture(url);
  }
  const material = shaded(tex);
  const byPath = new Map<string, THREE.Object3D>();
  const build = (part: VanillaPart, path: string): THREE.Object3D => {
    const pivot = new THREE.Group();
    applyPose(pivot, part.pose);
    for (const c of part.cubes ?? []) {
      pivot.add(modelBox(material, c.uv[0], c.uv[1], c.box, geometry.textureSize, c.mirror, c.grow, c.uvScale, c.faces));
    }
    for (const child of part.children ?? []) {
      const childPath = path ? `${path}/${child.name}` : child.name;
      const built = build(child, childPath);
      byPath.set(childPath, built);
      pivot.add(built);
    }
    return pivot;
  };
  const root = build(geometry.root, "");
  for (const [path, pose] of Object.entries(geometry.rest)) {
    const part = byPath.get(path);
    if (part) applyPose(part, pose);
  }
  const parts = new THREE.Group();
  parts.add(root);
  // Model space is in pixels with y pointing down from 24 pixels above the feet; flip it into the scene.
  parts.scale.set(-scale / 16, -scale / 16, scale / 16);
  parts.position.y = (24 * scale) / 16;
  parts.rotation.y = Math.PI;
  const group = new THREE.Group();
  group.add(parts);
  const walk = geometry.walk;
  if (walk) {
    group.userData.tick = (seconds: number, walking: boolean) => {
      // One walk cycle a second, blending between the 12 sampled frames.
      const t = walking ? (seconds % 1) * walk.length : 0;
      const i = Math.floor(t);
      const a = walk[i % walk.length];
      const b = walk[(i + 1) % walk.length];
      for (const [path, part] of byPath) {
        const rest = geometry.rest[path];
        if (!rest) continue;
        if (!walking) {
          applyPose(part, rest);
          continue;
        }
        const from = a[path] ?? rest;
        const to = b[path] ?? rest;
        applyPose(part, from.map((v, k) => v + (to[k] - v) * (t - i)));
      }
    };
  }
  return group;
}

/** Put every part back in its rest pose. */
function resetPose(parts: Map<string, THREE.Object3D>): void {
  for (const part of parts.values()) {
    const rest = part.userData.rest as { position: THREE.Vector3; rotation: THREE.Euler };
    part.position.copy(rest.position);
    part.rotation.copy(rest.rotation);
    part.scale.setScalar(1);
  }
}

/** A Blockbench mob in model space, plus a tick that plays its walk or idle animation. */
async function blockbenchMob(load: Loader, model: EntityModelDef, texture: string): Promise<THREE.Group> {
  const material = shaded(await load(texture));
  const sheet: [number, number] = [model.textureWidth, model.textureHeight];
  const byName = new Map<string, THREE.Object3D>();
  const build = (part: ModelPartDef): THREE.Object3D => {
    const pivot = new THREE.Group();
    pivot.position.set(...part.pivot);
    pivot.rotation.set(...part.rotation, "ZYX");
    pivot.userData.rest = { position: pivot.position.clone(), rotation: pivot.rotation.clone() };
    for (const b of part.boxes) {
      const [x, y, z, w, h, d] = b.box;
      const g = b.inflate;
      pivot.add(modelBox(material, b.u, b.v, [x - g, y - g, z - g, w + 2 * g, h + 2 * g, d + 2 * g], sheet, b.mirror));
    }
    for (const child of part.children) pivot.add(build(child));
    byName.set(part.name, pivot);
    return pivot;
  };
  const parts = new THREE.Group();
  for (const part of model.parts) parts.add(build(part));
  parts.scale.set(-1 / 16, -1 / 16, 1 / 16);
  parts.position.y = 24 / 16;
  parts.rotation.y = Math.PI;
  const group = new THREE.Group();
  group.add(parts);
  const { walk, idle } = pickAnimations(model);
  group.userData.tick = (seconds: number, walking: boolean) => {
    resetPose(byName);
    // Like the game: the idle animation always plays, and walking adds on top.
    if (idle) applyAnimation(byName, idle, seconds);
    if (walking && walk) applyAnimation(byName, walk, seconds);
  };
  return group;
}

/** Add an animation's keyframes at `seconds` to the parts' current pose, the way Minecraft's KeyframeAnimation does. */
function applyAnimation(parts: Map<string, THREE.Object3D>, animation: ModelAnimation, seconds: number): void {
  const t = animation.loop && animation.length > 0 ? seconds % animation.length : Math.min(seconds, animation.length);
  for (const [bone, channels] of Object.entries(animation.bones)) {
    const part = parts.get(bone);
    if (!part) continue;
    if (channels.rotation) {
      const [x, y, z] = sampleChannel(channels.rotation, t).map((deg) => (deg * Math.PI) / 180);
      part.rotation.set(part.rotation.x + x, part.rotation.y + y, part.rotation.z + z, "ZYX");
    }
    // posVec flips y before Minecraft adds it to the part's position.
    if (channels.position) {
      const [x, y, z] = sampleChannel(channels.position, t);
      part.position.add(new THREE.Vector3(x, -y, z));
    }
    if (channels.scale) part.scale.multiply(new THREE.Vector3(...sampleChannel(channels.scale, t)));
  }
}

async function buildObject(root: string, spec: ElementSpec): Promise<THREE.Object3D | null> {
  const load = loader(root);
  const faces = cubeFaces(spec);
  if (faces) {
    const mesh = await cube(load, faces);
    mesh.position.y = 0.5;
    return mesh;
  }
  const lifted = (object: THREE.Object3D, y = 0.6) => {
    object.position.y = y;
    return object;
  };
  switch (spec.kind) {
    case "item":
      return lifted(await flat(load, spec.item.texture));
    case "tool":
      return lifted(await flat(load, spec.tool.texture));
    case "plant":
      return lifted(await cross(load, spec.plant.texture), 0.5);
    case "tree":
      return tree(load, spec.tree);
    case "mob": {
      if (spec.mob.model !== "blockbench") return vanillaMob(load, spec.mob.model, spec.mob.texture, spec.mob.scale ?? 1);
      if (!spec.mob.blockbench) return null;
      const { model } = await api().loadBlockbench(root, spec.mob.blockbench);
      return model ? blockbenchMob(load, model, spec.mob.texture) : null;
    }
    case "armor": {
      const group = new THREE.Group();
      const pieces = Object.values(spec.armor.pieces).filter((f): f is string => !!f);
      for (const [i, file] of pieces.entries()) {
        const plane = await flat(load, file);
        plane.scale.setScalar(0.5);
        plane.position.set((i - (pieces.length - 1) / 2) * 0.55, 0.6, 0);
        group.add(plane);
      }
      return group;
    }
  }
  return null;
}

/** 3D view of a spec: blocks, items, tools, armor, plants, trees and mobs. Reloads whenever the spec changes. */
export function Preview({ root, spec, version }: { root: string; spec: ElementSpec; version: number }) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<{ scene: THREE.Scene; object: THREE.Object3D | null; camera: THREE.PerspectiveCamera; controls: OrbitControls } | null>(null);
  const [failed, setFailed] = useState(false);
  const [animated, setAnimated] = useState(false);
  const [walking, setWalking] = useState(false);
  const walkingRef = useRef(walking);
  walkingRef.current = walking;

  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(window.devicePixelRatio);
    el.appendChild(renderer.domElement);

    const s = new THREE.Scene();
    s.background = new THREE.Color(0x2b2d31);
    s.add(new THREE.GridHelper(4, 4, 0x6d6f78, 0x45474f));
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(1.8, 1.6, 2.2);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.5, 0);
    controls.enableDamping = true;
    scene.current = { scene: s, object: null, camera, controls };

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      scene.current?.object?.userData.tick?.(clock.getElapsedTime(), walkingRef.current);
      controls.update();
      renderer.render(s, camera);
    });
    return () => {
      observer.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    buildObject(root, spec).then((object) => {
      const s = scene.current;
      if (cancelled || !s) return;
      if (s.object) s.scene.remove(s.object);
      s.object = object;
      if (object) {
        s.scene.add(object);
        // Frame big things (a ghast, a giant) the way a one-block thing is framed.
        const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
        const fit = Math.max(1, size.x, size.y, size.z);
        s.controls.target.set(0, Math.max(0.5, size.y / 2), 0);
        s.camera.position.set(1.8, 1.6, 2.2).multiplyScalar(fit).setY(Math.max(1.6, size.y * 0.8 + 0.8 * fit));
        s.controls.update();
      }
      setAnimated(!!object?.userData.tick);
    });
    return () => {
      cancelled = true;
    };
  }, [root, spec, version]);

  const supported = cubeFaces(spec) !== null || ["item", "tool", "armor", "plant", "tree", "mob"].includes(spec.kind);
  return (
    <div className="preview">
      <div className="preview-canvas" ref={host} />
      {failed && <div className="preview-note">3D preview needs WebGL, which this computer's graphics driver did not provide.</div>}
      {!failed && !supported && <div className="preview-note">No 3D preview for this element yet.</div>}
      {animated && (
        <label className="preview-toggle">
          <input type="checkbox" checked={walking} onChange={(e) => setWalking(e.target.checked)} /> Walking
        </label>
      )}
    </div>
  );
}
