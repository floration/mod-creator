import { useContext, useState } from "react";
import { TREE_SHAPES, TREE_SHAPE_LABELS, TWO_BY_TWO_SHAPES, blocksToLayout, growTree, layoutBlocks, layoutOrigin, layoutSize, leafDistances, structureToLayout, vanillaTreeConfig, type CustomLayout, type VanillaTreeShape } from "@modcreator/core/trees";
import { TreeShape } from "@modcreator/core/schema";
import { api } from "./api";
import { CheckField, NumberField, Row, Section, getAt, setAt, type Draft, type Errors } from "./forms";
import { TextureContext } from "./TextureField";

interface EditorProps {
  draft: Draft;
  errors: Errors;
  onChange: (draft: Draft) => void;
}

const VANILLA = Object.keys(TREE_SHAPES) as VanillaTreeShape[];

/** A vanilla tree grown with a random seed, as a layout to edit by hand. */
function grownLayout(shape: VanillaTreeShape, seed = Math.floor(Math.random() * 1_000_000)): CustomLayout {
  return blocksToLayout(growTree(vanillaTreeConfig({ shape }) as any, seed));
}

/** How the tree grows: a vanilla shape with tweaks, or a layout built by hand. */
export function TreeShapeSection(p: EditorProps) {
  const f = { draft: p.draft, errors: p.errors, onChange: p.onChange };
  const shape: string = getAt(p.draft, ["tree", "shape"]) ?? "oak";
  const setShape = (next: string) => {
    let draft = setAt(p.draft, ["tree", "shape"], next);
    // A new custom tree starts as the vanilla tree it was, so there is something to edit.
    if (next === "custom" && !getAt(p.draft, ["tree", "custom"])) {
      draft = setAt(draft, ["tree", "custom"], { ...grownLayout(shape === "custom" ? "oak" : (shape as VanillaTreeShape), 0), randomRotation: true });
    }
    p.onChange(draft);
  };
  const radiusFixed = shape !== "custom" && typeof (TREE_SHAPES as Record<string, any>)[shape]?.foliage_placer.radius === "number";
  return (
    <Section title="Shape">
      <Row
        label="Grows like"
        hint={
          shape === "custom"
            ? "Build it layer by layer below, or import one you built in game"
            : TWO_BY_TWO_SHAPES.includes(shape)
              ? "Needs four saplings in a square, like dark oak. The preview is the game's own generator"
              : "The preview is the game's own generator: press Grow another to see how trees vary"
        }
        error={p.errors.get("tree.shape")}
      >
        <select value={shape} onChange={(e) => setShape(e.target.value)}>
          {TreeShape.options.map((o) => (
            <option key={o} value={o}>
              {TREE_SHAPE_LABELS[o]}
            </option>
          ))}
        </select>
      </Row>
      {shape === "custom" ? (
        <CustomTreeEditor {...p} />
      ) : (
        <>
          <NumberField {...f} path={["tree", "trunkHeight"]} label="Trunk height" min={1} max={32} hint={`Optional. ${TREE_SHAPE_LABELS[shape as VanillaTreeShape]} is ${(TREE_SHAPES as Record<string, any>)[shape]?.trunk_placer.base_height}`} />
          <NumberField {...f} path={["tree", "trunkHeightRandom"]} label="Extra random height" min={0} max={24} hint={`Optional. Up to this many more blocks; normally ${(TREE_SHAPES as Record<string, any>)[shape]?.trunk_placer.height_rand_a}`} />
          {radiusFixed && <NumberField {...f} path={["tree", "leafRadius"]} label="Leaf radius" min={0} max={8} hint={`Optional. Normally ${(TREE_SHAPES as Record<string, any>)[shape].foliage_placer.radius}`} />}
        </>
      )}
    </Section>
  );
}

const BRUSHES = [
  { ch: "L", label: "Log", title: "Upright log" },
  { ch: "X", label: "Log E-W", title: "Log lying east-west" },
  { ch: "Z", label: "Log N-S", title: "Log lying north-south" },
  { ch: "#", label: "Leaves", title: "Leaves" },
  { ch: ".", label: "Erase", title: "Nothing" },
] as const;

/** Paints a hand-built tree one horizontal layer at a time. */
function CustomTreeEditor(p: EditorProps) {
  const f = { draft: p.draft, errors: p.errors, onChange: p.onChange };
  const world = useContext(TextureContext);
  const raw: (CustomLayout & { randomRotation?: boolean }) | undefined = getAt(p.draft, ["tree", "custom"]);
  const [layer, setLayer] = useState(0);
  const [brush, setBrush] = useState<string>("#");
  const [painting, setPainting] = useState(false);
  const [copyFrom, setCopyFrom] = useState<VanillaTreeShape>("oak");
  const [error, setError] = useState<string | null>(null);
  if (!raw) return null;
  const { width, depth, height } = layoutSize(raw);
  const [ox, oz] = layoutOrigin(raw);
  // Rows padded to the full width, so every cell can be painted.
  const layers = raw.layers.map((l) => Array.from({ length: depth }, (_, z) => (l[z] ?? "").padEnd(width, ".")));
  const current = Math.min(layer, height - 1);

  const save = (next: Partial<CustomLayout>) => p.onChange(setAt(p.draft, ["tree", "custom"], { ...raw, layers, origin: [ox, oz], ...next }));
  const paint = (x: number, z: number) => {
    if (layers[current][z][x] === brush) return;
    const next = layers.map((l) => [...l]);
    next[current][z] = next[current][z].slice(0, x) + brush + next[current][z].slice(x + 1);
    save({ layers: next });
  };
  /** Adds (1) or removes (-1) a ring of cells around every layer, keeping the sapling in place. */
  const ring = (d: 1 | -1) => {
    if (d < 0 && (width <= 1 || depth <= 1)) return;
    const next = layers.map((l) => {
      const rows = d > 0 ? ["", ...l, ""].map((r) => `.${r.padEnd(width, ".")}.`) : l.slice(1, -1).map((r) => r.slice(1, -1));
      return rows.length ? rows : ["."];
    });
    save({ layers: next, origin: [Math.max(0, ox + d), Math.max(0, oz + d)] });
  };
  const addLayer = () => {
    const next = [...layers];
    next.splice(current + 1, 0, Array(depth).fill(".".repeat(width)));
    save({ layers: next });
    setLayer(current + 1);
  };
  const removeLayer = () => {
    if (height <= 1) return;
    save({ layers: layers.filter((_, i) => i !== current) });
    setLayer(Math.max(0, current - 1));
  };
  const importNbt = async () => {
    if (!world) return;
    setError(null);
    try {
      const rel = await api().importFile(world.root, "nbt");
      if (!rel) return;
      const { structure, error } = await api().loadStructure(world.root, rel);
      if (!structure) throw new Error(error ?? "Couldn't read the structure");
      p.onChange(setAt(p.draft, ["tree", "custom"], { ...structureToLayout(structure), randomRotation: raw.randomRotation ?? true }));
      setLayer(0);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const blocks = layoutBlocks({ layers, origin: [ox, oz] });
  const distances = leafDistances(blocks);
  const decaying = [...distances.values()].filter((d) => d >= 7).length;
  const trunkMissing = layers[0][oz]?.[ox] === undefined || !"LXZ".includes(layers[0][oz][ox]);
  const below = current > 0 ? layers[current - 1] : null;

  return (
    <div className="tree-builder">
      <div className="tree-builder-bar">
        {BRUSHES.map((b) => (
          <button key={b.ch} type="button" title={b.title} className={brush === b.ch ? "primary" : ""} onClick={() => setBrush(b.ch)}>
            <span className={`tree-cell tree-cell-${cellClass(b.ch)}`} /> {b.label}
          </button>
        ))}
      </div>
      <div className="tree-builder-bar">
        <button type="button" className="icon" title="Layer above" disabled={current >= height - 1} onClick={() => setLayer(current + 1)}>▲</button>
        <button type="button" className="icon" title="Layer below" disabled={current <= 0} onClick={() => setLayer(current - 1)}>▼</button>
        <span>
          Layer {current + 1} of {height} <span className="muted">({current === 0 ? "sapling level" : `${current} above the sapling`})</span>
        </span>
        <span className="spacer" />
        <button type="button" onClick={addLayer}>Add layer above</button>
        <button type="button" onClick={removeLayer} disabled={height <= 1}>Remove layer</button>
      </div>
      <div
        className="tree-grid"
        style={{ gridTemplateColumns: `repeat(${width}, 18px)` }}
        onMouseLeave={() => setPainting(false)}
        onMouseUp={() => setPainting(false)}
      >
        {layers[current].map((row, z) =>
          [...row].map((ch, x) => {
            const ghost = below && ch === "." && below[z][x] !== "." ? " tree-cell-ghost" : "";
            const sapling = current === 0 && x === ox && z === oz ? " tree-cell-sapling" : "";
            const far = ch === "#" && distances.get(`${x - ox},${current},${z - oz}`) === 7 ? " tree-cell-far" : "";
            return (
              <span
                key={`${x},${z}`}
                className={`tree-cell tree-cell-${cellClass(ch)}${ghost}${sapling}${far}`}
                title={`${x - ox}, ${z - oz}${sapling ? " (sapling)" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setPainting(true);
                  paint(x, z);
                }}
                onMouseEnter={() => painting && paint(x, z)}
              />
            );
          }),
        )}
      </div>
      <div className="tree-builder-bar">
        <span className="muted">
          {width} × {depth}, {height} tall. North is up.
        </span>
        <span className="spacer" />
        <button type="button" onClick={() => ring(1)}>Wider</button>
        <button type="button" onClick={() => ring(-1)} disabled={width <= 1 || depth <= 1}>Narrower</button>
      </div>
      {trunkMissing && <div className="field-error">The sapling square (outlined, bottom layer) should be a log, or the tree grows floating.</div>}
      {decaying > 0 && <div className="tree-warning">{decaying} leaves are more than 6 blocks from a log, so they will decay. They're marked with a dot.</div>}
      <CheckField {...f} path={["tree", "custom", "randomRotation"]} label="Turn each tree a random quarter turn" />
      <div className="tree-builder-bar">
        <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value as VanillaTreeShape)} style={{ width: "auto" }}>
          {VANILLA.map((s) => (
            <option key={s} value={s}>
              {TREE_SHAPE_LABELS[s]}
            </option>
          ))}
        </select>
        <button
          type="button"
          title="Replace this layout with a tree grown by the game's generator, then edit it. Press again for a different one"
          onClick={() => {
            save({ ...grownLayout(copyFrom) });
            setLayer(0);
          }}
        >
          Start from a grown tree
        </button>
        <span className="spacer" />
        <button type="button" title="Build the tree in Run client, save it with a structure block, then import the .nbt" onClick={importNbt}>
          Import .nbt
        </button>
      </div>
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}

const cellClass = (ch: string) => (ch === "L" ? "log" : ch === "X" ? "logx" : ch === "Z" ? "logz" : ch === "#" ? "leaves" : "air");
