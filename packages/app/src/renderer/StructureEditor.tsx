import { useContext, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TerrainAdaptation } from "@modcreator/core/schema";
import { api, type StructureTemplate } from "./api";
import { NumberField, Row, Section, SelectField, TextField, getAt, setAt, type Draft, type Errors } from "./forms";
import { ItemContext, iconFor, type ItemWorld } from "./items";
import { CUBE_SHADES, pixelTexture } from "./Preview";
import { TextureContext } from "./TextureField";
import { TagListField, useElementOptions } from "./TagField";

interface EditorProps {
  draft: Draft;
  errors: Errors;
  onChange: (draft: Draft) => void;
}

const TERRAIN_HINTS: Record<string, string> = {
  none: "Placed as saved, even hanging over a drop",
  beard_thin: "Fills in under it and clears above, like a village house",
  beard_box: "Like beard_thin, with a squarer base, like an ancient city",
  bury: "Sinks into the ground around it, like a stronghold",
  encapsulate: "Surrounds it with terrain, like trial chambers",
};

/** A structure saved with a structure block, and where it spawns. */
export function StructureEditor(p: EditorProps) {
  const f = { draft: p.draft, errors: p.errors, onChange: p.onChange };
  const world = useContext(TextureContext);
  const biomeOptions = useElementOptions("biome");
  const placement = getAt(p.draft, ["structure", "placement"]) ?? "surface";
  const terrain = getAt(p.draft, ["structure", "terrain"]) ?? "beard_thin";
  const file: string = getAt(p.draft, ["structure", "file"]) ?? "";
  const pick = async () => {
    if (!world) return;
    const rel = await api().importFile(world.root, "nbt");
    if (rel) p.onChange(setAt(p.draft, ["structure", "file"], rel));
  };
  return (
    <>
      <Section title="General">
        <TextField {...f} path={["name"]} label="Name" />
        <TextField {...f} path={["id"]} label="Id" hint="Lowercase. Also its name for /place structure" />
      </Section>
      <Section title="Building">
        <Row
          label="Structure file"
          hint="Build it in Run client, save it with a structure block (its name is the file name), then Import it from the world's generated folder"
          error={p.errors.get("structure.file")}
        >
          <span className="icon-input">
            <input value={file} placeholder="art/house.nbt" onChange={(e) => p.onChange(setAt(p.draft, ["structure", "file"], e.target.value.trim()))} />
            <button type="button" onClick={(e) => { e.preventDefault(); pick(); }}>Import .nbt</button>
          </span>
        </Row>
      </Section>
      <Section title="Where it spawns">
        <TagListField {...f} type="worldgen/biome" hash extra={biomeOptions} path={["structure", "biomes"]} label="Biomes" placeholder="azure_grove, minecraft:plains, #minecraft:is_forest" hint="This mod's biomes, vanilla ones, or biome tags starting with #" />
        <NumberField {...f} path={["structure", "spacing"]} label="Spacing (chunks)" min={2} max={4096} hint="About one per this many chunks in each direction. Villages 34, igloos 32" />
        <NumberField {...f} path={["structure", "separation"]} label="Separation (chunks)" min={0} hint="Never closer than this. Less than spacing" />
        <SelectField {...f} path={["structure", "placement"]} label="Height" options={["surface", "fixed"]} hint={placement === "surface" ? "Sits on the ground wherever it lands" : "Always at the same Y level"} />
        <NumberField {...f} path={["structure", "y"]} label={placement === "surface" ? "Offset from the ground" : "Y level"} min={-64} max={320} hint={placement === "surface" ? "0 rests its bottom layer on the ground; -1 sinks it one block" : "The Y of its bottom layer"} />
        <SelectField {...f} path={["structure", "terrain"]} label="Terrain" options={TerrainAdaptation.options} hint={TERRAIN_HINTS[terrain]} />
      </Section>
    </>
  );
}

// ---- Preview ----

const AIR = new Set(["minecraft:air", "minecraft:cave_air", "minecraft:void_air", "minecraft:structure_void"]);

type Box = [number, number, number, number, number, number]; // min x, y, z, max x, y, z within the block

/** Rough shape of a block state: enough boxes to tell slabs, stairs, walls and carpets from full blocks. */
function shapeOf(name: string, props: Record<string, string>): Box[] | "cross" | null {
  const id = name.split(":").pop()!;
  if (id.endsWith("_slab")) return props.type === "double" ? null : props.type === "top" ? [[0, 0.5, 0, 1, 1, 1]] : [[0, 0, 0, 1, 0.5, 1]];
  if (id.endsWith("_stairs")) {
    const top = props.half === "top";
    const base: Box = top ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1];
    const [y0, y1] = top ? [0, 0.5] : [0.5, 1];
    const step: Record<string, Box> = {
      north: [0, y0, 0, 1, y1, 0.5],
      south: [0, y0, 0.5, 1, y1, 1],
      west: [0, y0, 0, 0.5, y1, 1],
      east: [0.5, y0, 0, 1, y1, 1],
    };
    return [base, step[props.facing] ?? step.north];
  }
  if (id.endsWith("_wall")) return [[0.25, 0, 0.25, 0.75, 1, 0.75]];
  if (id.endsWith("_fence") || id.endsWith("_pane") || id === "iron_bars") return [[0.375, 0, 0.375, 0.625, 1, 0.625]];
  if (id.endsWith("_carpet") || id.endsWith("_pressure_plate")) return [[0, 0, 0, 1, 1 / 16, 1]];
  if (id.endsWith("_trapdoor")) return props.half === "top" ? [[0, 13 / 16, 0, 1, 1, 1]] : [[0, 0, 0, 1, 3 / 16, 1]];
  return null;
}

/** Materials for a block: its inventory icon's textures, or a flat color when it has none (water, fire, a typo). */
async function blockMaterials(world: ItemWorld, name: string, cache: Map<string, Promise<THREE.Texture>>): Promise<{ materials: THREE.Material[]; flat: boolean }> {
  const tex = (url: string) => {
    if (!cache.has(url)) cache.set(url, pixelTexture(url));
    return cache.get(url)!;
  };
  const icon = await iconFor(world, name).catch(() => null);
  if (icon?.kind === "cube") {
    const [top, side] = await Promise.all([tex(icon.top), tex(icon.left)]);
    const faces = [side, side, top, top, side, side];
    return { flat: false, materials: faces.map((t, i) => new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color().setScalar(CUBE_SHADES[i]), transparent: true, alphaTest: 0.1 })) };
  }
  if (icon?.kind === "flat") {
    const t = await tex(icon.texture);
    return { flat: true, materials: [new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide })] };
  }
  const color = name.endsWith(":water") ? 0x3f76e4 : name.endsWith(":lava") ? 0xd96b1c : 0x9a9ca3;
  const opacity = name.endsWith(":water") ? 0.5 : 1;
  return { flat: false, materials: CUBE_SHADES.map((s) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(s), transparent: opacity < 1, opacity })) };
}

function boxGeometry([x0, y0, z0, x1, y1, z1]: Box): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

function crossGeometry(): THREE.BufferGeometry[] {
  return [Math.PI / 4, -Math.PI / 4].map((angle) => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateY(angle);
    g.translate(0.5, 0.5, 0.5);
    return g;
  });
}

/** Every block of the structure as instanced meshes, one per block state and box. */
async function buildStructure(world: ItemWorld, t: StructureTemplate): Promise<THREE.Group> {
  const group = new THREE.Group();
  const cache = new Map<string, Promise<THREE.Texture>>();
  const byState = new Map<number, [number, number, number][]>();
  for (const b of t.blocks) {
    const entry = t.palette[b.state];
    if (!entry || AIR.has(entry.name)) continue;
    byState.set(b.state, [...(byState.get(b.state) ?? []), b.pos]);
  }
  const matrix = new THREE.Matrix4();
  await Promise.all(
    [...byState].map(async ([state, positions]) => {
      const entry = t.palette[state];
      const { materials, flat } = await blockMaterials(world, entry.name, cache);
      const shape = shapeOf(entry.name, entry.properties);
      const geometries = flat ? crossGeometry() : shape === null || shape === "cross" ? [boxGeometry([0, 0, 0, 1, 1, 1])] : shape.map(boxGeometry);
      for (const geometry of geometries) {
        const mesh = new THREE.InstancedMesh(geometry, flat ? materials[0] : materials, positions.length);
        positions.forEach(([x, y, z], i) => mesh.setMatrixAt(i, matrix.makeTranslation(x, y, z)));
        group.add(mesh);
      }
    }),
  );
  // Centered on the grid, bottom layer on y = 0.
  group.position.set(-t.size[0] / 2, 0, -t.size[2] / 2);
  return group;
}

/** Names and counts of the blocks a structure uses, most common first. */
function blockCounts(t: StructureTemplate): [string, number][] {
  const counts = new Map<string, number>();
  for (const b of t.blocks) {
    const name = t.palette[b.state]?.name;
    if (name && !AIR.has(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
}

/** 3D view of the structure file, with its size and the blocks it uses. */
export function StructurePreview({ file, version }: { file: string; version: number }) {
  const world = useContext(ItemContext);
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<{ scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; object: THREE.Object3D | null } | null>(null);
  const [loaded, setLoaded] = useState<{ structure: StructureTemplate | null; error: string | null } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoaded(null);
    if (!world || !/\.nbt$/i.test(file)) return;
    let live = true;
    api().loadStructure(world.root, file).then((r) => live && setLoaded(r), (e) => live && setLoaded({ structure: null, error: (e as Error).message }));
    return () => {
      live = false;
    };
  }, [world?.root, file, version]);

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
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2b2d31);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    view.current = { scene, camera, controls, object: null };
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
      renderer.render(scene, camera);
    });
    return () => {
      observer.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  const structure = loaded?.structure ?? null;
  useEffect(() => {
    const v = view.current;
    if (!v || !world) return;
    let cancelled = false;
    const show = async () => {
      const object = structure ? await buildStructure(world, structure) : null;
      if (cancelled) return;
      if (v.object) v.scene.remove(v.object);
      v.object = object;
      if (!object || !structure) return;
      const [w, h, d] = structure.size;
      const grid = new THREE.GridHelper(Math.max(w, d) + 2, Math.max(w, d) + 2, 0x6d6f78, 0x45474f);
      object.add(grid);
      grid.position.set(w / 2, 0, d / 2);
      v.scene.add(object);
      const reach = Math.max(w, h, d);
      v.controls.target.set(0, h / 2, 0);
      v.camera.position.set(reach * 1.3, h / 2 + reach * 0.9, reach * 1.6);
    };
    show();
    return () => {
      cancelled = true;
    };
  }, [structure, world]);

  const counts = useMemo(() => (structure ? blockCounts(structure) : []), [structure]);
  return (
    <div className="preview structure-preview">
      <div className="preview-canvas" ref={host} />
      {failed && <div className="preview-note">3D preview needs WebGL, which this computer's graphics driver did not provide.</div>}
      {!failed && !structure && (
        <div className="preview-note">{loaded?.error ?? (/\.nbt$/i.test(file) ? "Loading…" : "Import a structure block's .nbt file to see it here.")}</div>
      )}
      {structure && (
        <div className="structure-info">
          <div>
            {structure.size.join(" × ")} blocks · {counts.reduce((n, [, c]) => n + c, 0)} placed
            {structure.entities > 0 && ` · ${structure.entities} entities`}
          </div>
          <ul>
            {counts.slice(0, 8).map(([name, n]) => (
              <li key={name}>
                {n} {name.replace(/^minecraft:/, "")}
              </li>
            ))}
            {counts.length > 8 && <li className="muted">and {counts.length - 8} more</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
