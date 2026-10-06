import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
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

function pixelTexture(url: string): Promise<THREE.Texture> {
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

const CUBE_SHADES = [SHADE.eastWest, SHADE.eastWest, SHADE.top, SHADE.bottom, SHADE.northSouth, SHADE.northSouth];

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
 * A box of a Minecraft entity model, textured from a 64x64 sheet the way the game does: the box's net starts at
 * (u, v), top and bottom first, then the four sides. Coordinates are model pixels (y down, front towards -z).
 */
function modelBox(material: THREE.Material, u: number, v: number, [x, y, z, w, h, d]: number[]): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(w, h, d);
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
  rects.forEach(([left, top, width, height], face) => {
    const [l, r, t, b] = [left / 64, (left + width) / 64, 1 - top / 64, 1 - (top + height) / 64];
    // BoxGeometry's four corners per face: top-left, top-right, bottom-left, bottom-right in its own up direction.
    // The model is flipped upside down when drawn, so each face's rows are swapped.
    const corners = face === 2 || face === 3 ? [[l, t], [r, t], [l, b], [r, b]] : [[l, b], [r, b], [l, t], [r, t]];
    corners.forEach(([cu, cv], i) => uv.setXY(face * 4 + i, cu, cv));
  });
  return new THREE.Mesh(geometry, material);
}

/** Boxes of the vanilla pig and cow models: texture offset, box, and the part's pivot and x rotation. */
const MOB_MODELS: Record<string, { uv: [number, number]; box: number[]; at: [number, number, number]; rotX?: number }[]> = {
  pig: [
    { uv: [0, 0], box: [-4, -4, -8, 8, 8, 8], at: [0, 12, -6] },
    { uv: [16, 16], box: [-2, 0, -9, 4, 3, 1], at: [0, 12, -6] },
    { uv: [28, 8], box: [-5, -10, -7, 10, 16, 8], at: [0, 11, 2], rotX: Math.PI / 2 },
    ...[[-3, 7], [3, 7], [-3, -5], [3, -5]].map(([x, z]) => ({ uv: [0, 16] as [number, number], box: [-2, 0, -2, 4, 6, 4], at: [x, 18, z] as [number, number, number] })),
  ],
  cow: [
    { uv: [0, 0], box: [-4, -4, -6, 8, 8, 6], at: [0, 4, -8] },
    { uv: [1, 33], box: [-3, 1, -7, 6, 3, 1], at: [0, 4, -8] },
    { uv: [22, 0], box: [-5, -5, -5, 1, 3, 1], at: [0, 4, -8] },
    { uv: [22, 0], box: [4, -5, -5, 1, 3, 1], at: [0, 4, -8] },
    { uv: [18, 4], box: [-6, -10, -7, 12, 18, 10], at: [0, 5, 2], rotX: Math.PI / 2 },
    { uv: [52, 0], box: [-2, 2, -8, 4, 6, 1], at: [0, 5, 2], rotX: Math.PI / 2 },
    ...[[-4, 7], [4, 7], [-4, -6], [4, -6]].map(([x, z]) => ({ uv: [0, 16] as [number, number], box: [-2, 0, -2, 4, 12, 4], at: [x, 12, z] as [number, number, number] })),
  ],
};

async function mob(load: Loader, model: string, texture: string): Promise<THREE.Group> {
  const material = shaded(await load(texture));
  const parts = new THREE.Group();
  for (const part of MOB_MODELS[model] ?? MOB_MODELS.pig) {
    const pivot = new THREE.Group();
    pivot.position.set(...part.at);
    pivot.rotation.x = part.rotX ?? 0;
    pivot.add(modelBox(material, part.uv[0], part.uv[1], part.box));
    parts.add(pivot);
  }
  // Model space is in pixels with y pointing down from 24 pixels above the feet; flip it into the scene.
  parts.scale.set(-1 / 16, -1 / 16, 1 / 16);
  parts.position.y = 24 / 16;
  parts.rotation.y = Math.PI;
  const group = new THREE.Group();
  group.add(parts);
  return group;
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
    case "mob":
      return mob(load, spec.mob.model, spec.mob.texture);
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
  const scene = useRef<{ scene: THREE.Scene; object: THREE.Object3D | null } | null>(null);
  const [failed, setFailed] = useState(false);

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
    scene.current = { scene: s, object: null };

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    renderer.setAnimationLoop(() => {
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
      if (object) s.scene.add(object);
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
    </div>
  );
}
