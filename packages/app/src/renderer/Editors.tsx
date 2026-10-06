import { useContext, useEffect, useMemo, useState } from "react";
import { EMPTY_SLOTS, listFromSlots, patternFromSlots, sameShape, slotsFromList, slotsFromPattern, type Slots } from "@modcreator/core/recipe-grid";
import { CreativeTab, OreHost, SoundType } from "@modcreator/core/schema";
import {
  CheckField,
  ListField,
  NumberField,
  Section,
  SelectField,
  TextField,
  getAt,
  setAt,
  type Draft,
  type Errors,
} from "./forms";
import { ItemContext, ItemIconView, ItemPicker, acceptsItem, dragItem, droppedItem, itemInfo } from "./items";

interface EditorProps {
  draft: Draft;
  errors: Errors;
  onChange: (draft: Draft) => void;
}

function Common(p: EditorProps) {
  const f = { draft: p.draft, errors: p.errors, onChange: p.onChange };
  return (
    <Section title="General">
      <TextField {...f} path={["name"]} label="Display name" />
      <TextField {...f} path={["id"]} label="Id" hint="Lowercase, used in registry names and file names" />
      <SelectField {...f} path={["creativeTab"]} label="Creative tab" options={CreativeTab.options} optional />
      <ListField {...f} path={["tags"]} label="Tags" placeholder="minecraft:mineable/pickaxe, minecraft:needs_iron_tool" />
      <TextField
        {...f}
        path={["customClass"]}
        label="Custom class"
        optional
        placeholder="com.example.mymod.MyBlock"
        hint="Optional. A hand-written Java class to use instead of the vanilla one. Created once as a starter file."
      />
    </Section>
  );
}

const MODEL_TEMPLATES: Record<string, Draft> = {
  cube_all: { type: "cube_all", texture: "art/" },
  cube_column: { type: "cube_column", side: "art/", end: "art/" },
  custom: { type: "custom", model: "art/" },
};

export function BlockEditor(p: EditorProps) {
  const f = { draft: p.draft, errors: p.errors, onChange: p.onChange };
  const modelType = getAt(p.draft, ["block", "model", "type"]) ?? "cube_all";
  const drops = getAt(p.draft, ["drops"]) ?? "self";
  const dropKind = typeof drops === "object" ? "item" : drops;
  return (
    <>
      <Common {...p} />
      <Section title="Block">
        <NumberField {...f} path={["block", "hardness"]} label="Hardness" step={0.1} hint="Stone 1.5, iron ore 3, obsidian 50" />
        <NumberField {...f} path={["block", "resistance"]} label="Blast resistance" step={0.1} />
        <SelectField {...f} path={["block", "sound"]} label="Sound" options={SoundType.options} />
        <NumberField {...f} path={["block", "lightLevel"]} label="Light level" min={0} max={15} />
        <CheckField {...f} path={["block", "requiresTool"]} label="Needs the right tool to drop anything" />
        <CheckField {...f} path={["hasItem"]} label="Has a block item" />
      </Section>
      <Section title="Model">
        <label className="field">
          <span className="field-label">Shape</span>
          <select value={modelType} onChange={(e) => p.onChange(setAt(p.draft, ["block", "model"], MODEL_TEMPLATES[e.target.value]))}>
            <option value="cube_all">Cube, one texture</option>
            <option value="cube_column">Column, side and end textures</option>
            <option value="custom">Custom model JSON</option>
          </select>
        </label>
        {modelType === "cube_all" && <TextField {...f} path={["block", "model", "texture"]} label="Texture" hint="A 16x16 PNG in art/" />}
        {modelType === "cube_column" && (
          <>
            <TextField {...f} path={["block", "model", "side"]} label="Side texture" />
            <TextField {...f} path={["block", "model", "end"]} label="End texture" />
          </>
        )}
        {modelType === "custom" && <TextField {...f} path={["block", "model", "model"]} label="Model file" hint="Block model JSON, for example exported from Blockbench" />}
      </Section>
      <Section title="Drops">
        <label className="field">
          <span className="field-label">When broken</span>
          <select
            value={dropKind}
            onChange={(e) => {
              const v = e.target.value;
              p.onChange(setAt(p.draft, ["drops"], v === "item" ? { item: "", min: 1, max: 1, fortune: false } : v));
            }}
          >
            <option value="self">Drops itself</option>
            <option value="item">Drops another item</option>
            <option value="none">Drops nothing</option>
          </select>
        </label>
        {dropKind === "item" && (
          <>
            <TextField {...f} path={["drops", "item"]} label="Item" hint="An id from this mod, or minecraft:diamond" />
            <NumberField {...f} path={["drops", "min"]} label="Min count" min={0} />
            <NumberField {...f} path={["drops", "max"]} label="Max count" min={0} />
            <CheckField {...f} path={["drops", "fortune"]} label="Fortune increases drops" />
          </>
        )}
      </Section>
    </>
  );
}

export function ItemEditor(p: EditorProps) {
  const f = { draft: p.draft, errors: p.errors, onChange: p.onChange };
  return (
    <>
      <Common {...p} />
      <Section title="Item">
        <TextField {...f} path={["item", "texture"]} label="Texture" hint="A 16x16 PNG in art/" />
        <NumberField {...f} path={["item", "maxStackSize"]} label="Max stack size" min={1} max={99} />
        <SelectField {...f} path={["item", "rarity"]} label="Rarity" options={["common", "uncommon", "rare", "epic"]} />
      </Section>
    </>
  );
}

const RECIPE_TEMPLATES: Record<string, (result: Draft) => Draft> = {
  shaped: (result) => ({ type: "shaped", pattern: ["   ", "   ", "   "], key: {}, result }),
  shapeless: (result) => ({ type: "shapeless", ingredients: [], result }),
  smelting: (result) => ({ type: "smelting", ingredient: "", result, experience: 0.1, cookingTime: 200 }),
  blasting: (result) => ({ type: "blasting", ingredient: "", result, experience: 0.1, cookingTime: 100 }),
  smoking: (result) => ({ type: "smoking", ingredient: "", result, experience: 0.1, cookingTime: 100 }),
  campfire_cooking: (result) => ({ type: "campfire_cooking", ingredient: "", result, experience: 0.1, cookingTime: 600 }),
};

const RECIPE_TYPE_NAMES: Record<string, string> = {
  shaped: "Crafting table, shaped",
  shapeless: "Crafting table, any arrangement",
  smelting: "Furnace",
  blasting: "Blast furnace",
  smoking: "Smoker",
  campfire_cooking: "Campfire",
};

/** The table's contents as the spec stores them, whatever the recipe type. */
function recipeSlots(recipe: Draft | undefined): Slots {
  if (recipe?.type === "shaped") return slotsFromPattern(recipe.pattern ?? [], recipe.key ?? {});
  if (recipe?.type === "shapeless") return slotsFromList(recipe.ingredients ?? []);
  return [recipe?.ingredient || null, ...EMPTY_SLOTS.slice(1)];
}

/** Write the table back into the recipe: pattern and key for shaped, a list for shapeless, one slot for cooking. */
function withSlots(recipe: Draft, slots: Slots): Draft {
  if (recipe.type === "shaped") return { ...recipe, ...patternFromSlots(slots, recipe.key ?? {}) };
  if (recipe.type === "shapeless") return { ...recipe, ingredients: listFromSlots(slots) };
  return { ...recipe, ingredient: slots[0] ?? "" };
}

function Slot(p: { refId: string | null; label: string; held: string | null; onSet: (ref: string | null, from?: number) => void; onHold: (ref: string) => void; index?: number; big?: boolean }) {
  const world = useContext(ItemContext)!;
  const [over, setOver] = useState(false);
  const info = p.refId ? itemInfo(world, p.refId) : null;
  return (
    <div className={`slot-cell${p.big ? " big" : ""}`}>
      <button
        className={`slot${over ? " over" : ""}${info && !info.known ? " unknown" : ""}`}
        aria-label={info ? `${p.label}: ${info.name}` : `${p.label}: empty`}
        title={p.refId ? `${info!.name}\n${p.refId} (${info!.source})\nRight-click to empty` : p.held ? "Click to place" : "Empty. Pick an item below first."}
        onClick={() => {
          if (p.held) p.onSet(p.held);
          else if (p.refId) p.onHold(p.refId);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          p.onSet(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Delete" || e.key === "Backspace") p.onSet(null);
        }}
        draggable={!!p.refId}
        onDragStart={(e) => p.refId && dragItem(e, p.refId, p.index)}
        onDragOver={(e) => {
          if (!acceptsItem(e)) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const dropped = droppedItem(e);
          if (dropped) p.onSet(dropped.ref, dropped.from);
        }}
      >
        {p.refId && <ItemIconView refId={p.refId} size={p.big ? 44 : 36} />}
      </button>
      <span className={`slot-name${info && !info.known ? " bad" : ""}`}>{info ? info.name : ""}</span>
    </div>
  );
}

export function RecipeEditor(p: EditorProps) {
  const f = { draft: p.draft, errors: p.errors, onChange: p.onChange };
  const world = useContext(ItemContext);
  const recipe: Draft = getAt(p.draft, ["recipe"]) ?? {};
  const type: string = recipe.type ?? "shaped";
  const cooking = !["shaped", "shapeless"].includes(type);
  const result: string | null = getAt(p.draft, ["recipe", "result", "item"]) || null;
  const [held, setHeld] = useState<string | null>(null);

  // The table is kept here so a shape doesn't jump to the top-left corner while you build it.
  // It is reset from the spec only when the spec changes to a different recipe (another file, or a hand edit).
  const fromSpec = useMemo(() => recipeSlots(recipe), [JSON.stringify(recipe)]);
  const [slots, setSlots] = useState<Slots>(fromSpec);
  useEffect(() => {
    const same = type === "shaped" ? sameShape(slots, fromSpec) : JSON.stringify(listFromSlots(slots)) === JSON.stringify(listFromSlots(fromSpec));
    if (!same) setSlots(fromSpec);
  }, [fromSpec]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setHeld(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const writeSlots = (next: Slots) => {
    setSlots(next);
    p.onChange(setAt(p.draft, ["recipe"], withSlots(recipe, next)));
  };
  const setSlot = (i: number) => (ref: string | null, from?: number) => {
    const next = [...slots];
    // Dragging from another slot moves the item rather than copying it.
    if (from !== undefined && from !== i) next[from] = null;
    next[i] = ref;
    writeSlots(next);
  };
  const setResult = (ref: string | null) => p.onChange(setAt(p.draft, ["recipe", "result", "item"], ref ?? ""));
  const changeType = (next: string) => {
    const fresh = RECIPE_TEMPLATES[next](getAt(p.draft, ["recipe", "result"]) ?? { item: "", count: 1 });
    // Keep what's in the table when switching between crafting and cooking types.
    const carried = next === "shaped" || next === "shapeless" ? (cooking ? slots.slice(0, 1) : slots) : listFromSlots(slots).slice(0, 1);
    p.onChange(setAt(p.draft, ["recipe"], withSlots(fresh, [...carried, ...EMPTY_SLOTS].slice(0, 9))));
  };

  if (!world) return null;
  return (
    <>
      <Section title="General">
        <TextField {...f} path={["id"]} label="Id" />
        <label className="field">
          <span className="field-label">Made in</span>
          <select value={type} onChange={(e) => changeType(e.target.value)}>
            {Object.keys(RECIPE_TEMPLATES).map((t) => (
              <option key={t} value={t}>
                {RECIPE_TYPE_NAMES[t]}
              </option>
            ))}
          </select>
        </label>
      </Section>
      <Section title={cooking ? RECIPE_TYPE_NAMES[type] : "Crafting table"}>
        <div className="crafting">
          {cooking ? (
            <div className="cook-input">
              <Slot refId={slots[0]} index={0} label="Ingredient" held={held} onHold={setHeld} onSet={setSlot(0)} />
              <span className={`flame flame-${type}`} aria-hidden />
            </div>
          ) : (
            <div className="craft-grid">
              {slots.map((ref, i) => (
                <Slot key={i} refId={ref} index={i} label={`Slot ${i + 1}`} held={held} onHold={setHeld} onSet={setSlot(i)} />
              ))}
            </div>
          )}
          <span className="craft-arrow" aria-hidden>→</span>
          <div className="craft-result">
            <Slot refId={result} label="Result" big held={held} onHold={setHeld} onSet={(ref) => setResult(ref)} />
            <label className="count">
              <span className="muted">×</span>
              <input
                type="number"
                min={1}
                max={99}
                value={getAt(p.draft, ["recipe", "result", "count"]) ?? 1}
                onChange={(e) => p.onChange(setAt(p.draft, ["recipe", "result", "count"], e.target.value === "" ? undefined : Number(e.target.value)))}
              />
            </label>
          </div>
        </div>
        {["recipe.pattern", "recipe.key", "recipe.ingredients", "recipe.ingredient", "recipe.result.item"].map((k) =>
          p.errors.get(k) ? <div key={k} className="field-error">{p.errors.get(k)}</div> : null,
        )}
        <div className="held-bar">
          {held ? (
            <>
              <ItemIconView refId={held} size={20} />
              <span>
                Holding <strong>{itemInfo(world, held).name}</strong>. Click slots to place it.
              </span>
              <button className="link" onClick={() => setHeld(null)}>Let go (Esc)</button>
            </>
          ) : (
            <span className="muted">Pick an item below, then click slots to place it, or drag it in. Right-click a slot to empty it.</span>
          )}
          <span className="spacer" />
          {!cooking && listFromSlots(slots).length > 0 && <button className="link" onClick={() => writeSlots([...EMPTY_SLOTS])}>Clear table</button>}
        </div>
        {type === "shaped" && <span className="field-hint">The shape works anywhere in the table, so empty rows and columns around it aren't saved.</span>}
        {type === "shapeless" && <span className="field-hint">The ingredients can go in any slots in game.</span>}
        <ItemPicker held={held} onHold={setHeld} />
      </Section>
      {cooking && (
        <Section title="Cooking">
          <NumberField {...f} path={["recipe", "experience"]} label="Experience" step={0.1} min={0} />
          <NumberField {...f} path={["recipe", "cookingTime"]} label="Cooking time (ticks)" min={1} hint="20 ticks = 1 second" />
        </Section>
      )}
    </>
  );
}

export function OreEditor(p: EditorProps) {
  const f = { draft: p.draft, errors: p.errors, onChange: p.onChange };
  const replaces = getAt(p.draft, ["ore", "replaces"]) ?? "stone_and_deepslate";
  return (
    <>
      <Section title="General">
        <TextField {...f} path={["name"]} label="Name" />
        <TextField {...f} path={["id"]} label="Id" />
      </Section>
      <Section title="Vein">
        <TextField {...f} path={["ore", "block"]} label="Ore block" hint="A block from this mod, or minecraft:..." />
        <SelectField {...f} path={["ore", "replaces"]} label="Generates in" options={OreHost.options} hint="Netherrack generates in the Nether, end stone in the End, the rest in the Overworld" />
        {(replaces === "deepslate" || replaces === "stone_and_deepslate") && (
          <TextField {...f} path={["ore", "deepslateBlock"]} label="Deepslate variant" optional hint="Optional. Used where the vein replaces deepslate; defaults to the ore block" />
        )}
        <NumberField {...f} path={["ore", "veinSize"]} label="Blocks per vein" min={1} max={64} hint="Iron 9, gold 9, diamond 4" />
        <NumberField {...f} path={["ore", "veinsPerChunk"]} label="Veins per chunk" min={1} max={128} hint="Iron 10, diamond 7" />
        <NumberField {...f} path={["ore", "airExposureSkip"]} label="Skip chance next to air" step={0.1} min={0} max={1} hint="0 to 1. Diamond uses 0.5 so fewer ores show in caves" />
      </Section>
      <Section title="Height">
        <NumberField {...f} path={["ore", "minY"]} label="Lowest Y" min={-64} max={320} />
        <NumberField {...f} path={["ore", "maxY"]} label="Highest Y" min={-64} max={320} />
        <SelectField {...f} path={["ore", "distribution"]} label="Spread" options={["uniform", "triangle"]} hint="Triangle makes veins most common halfway between the two heights" />
      </Section>
    </>
  );
}

/** Starting point for a new spec of each kind. */
export function newSpec(kind: "block" | "item" | "recipe" | "ore", id: string): Draft {
  const name = id.split("_").map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ");
  const schema = `../../.modcreator/schema/${kind}.json`;
  if (kind === "block") {
    return { $schema: schema, kind, id, name, tags: [], block: { hardness: 1.5, resistance: 6, sound: "stone", model: { type: "cube_all", texture: `art/${id}.png` } } };
  }
  if (kind === "item") return { $schema: schema, kind, id, name, item: { texture: `art/${id}.png` } };
  if (kind === "ore") {
    return { $schema: schema, kind, id, name, ore: { block: "", replaces: "stone_and_deepslate", veinSize: 8, veinsPerChunk: 4, minY: -64, maxY: 64, distribution: "uniform" } };
  }
  return { $schema: schema, kind, id, recipe: RECIPE_TEMPLATES.shaped({ item: "", count: 1 }) };
}
