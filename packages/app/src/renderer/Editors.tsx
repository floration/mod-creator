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

export function RecipeEditor(p: EditorProps) {
  const f = { draft: p.draft, errors: p.errors, onChange: p.onChange };
  const type: string = getAt(p.draft, ["recipe", "type"]) ?? "shaped";
  const key: Record<string, string> = getAt(p.draft, ["recipe", "key"]) ?? {};
  const pattern: string[] = getAt(p.draft, ["recipe", "pattern"]) ?? [];
  return (
    <>
      <Section title="General">
        <TextField {...f} path={["id"]} label="Id" />
        <label className="field">
          <span className="field-label">Type</span>
          <select
            value={type}
            onChange={(e) => p.onChange(setAt(p.draft, ["recipe"], RECIPE_TEMPLATES[e.target.value](getAt(p.draft, ["recipe", "result"]) ?? { item: "", count: 1 })))}
          >
            {Object.keys(RECIPE_TEMPLATES).map((t) => (
              <option key={t} value={t}>
                {t.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
      </Section>
      {type === "shaped" && (
        <Section title="Crafting grid">
          <div className="grid-pattern">
            {[0, 1, 2].map((row) => (
              <input
                key={row}
                maxLength={3}
                value={pattern[row] ?? ""}
                placeholder="   "
                onChange={(e) => {
                  const next = [...pattern];
                  next[row] = e.target.value;
                  while (next.length && !next[next.length - 1]?.trim()) next.pop();
                  p.onChange(setAt(p.draft, ["recipe", "pattern"], next.length ? next : [""]));
                }}
              />
            ))}
          </div>
          <span className="field-hint">One letter per slot, space for empty. Then say what each letter means below.</span>
          {[...new Set(pattern.join("").replaceAll(" ", ""))].map((ch) => (
            <TextField key={ch} {...f} path={["recipe", "key", ch]} label={`"${ch}" is`} placeholder="ruby, minecraft:stick or #minecraft:planks" />
          ))}
          {Object.keys(key).filter((k) => !pattern.join("").includes(k)).length > 0 && (
            <button className="link" onClick={() => p.onChange(setAt(p.draft, ["recipe", "key"], Object.fromEntries(Object.entries(key).filter(([k]) => pattern.join("").includes(k)))))}>
              Remove unused letters
            </button>
          )}
        </Section>
      )}
      {type === "shapeless" && (
        <Section title="Ingredients">
          <ListField {...f} path={["recipe", "ingredients"]} label="Ingredients" placeholder="ruby_block" hint="Comma-separated, up to 9" />
        </Section>
      )}
      {!["shaped", "shapeless"].includes(type) && (
        <Section title="Cooking">
          <TextField {...f} path={["recipe", "ingredient"]} label="Ingredient" />
          <NumberField {...f} path={["recipe", "experience"]} label="Experience" step={0.1} min={0} />
          <NumberField {...f} path={["recipe", "cookingTime"]} label="Cooking time (ticks)" min={1} hint="20 ticks = 1 second" />
        </Section>
      )}
      <Section title="Result">
        <TextField {...f} path={["recipe", "result", "item"]} label="Item" />
        <NumberField {...f} path={["recipe", "result", "count"]} label="Count" min={1} max={99} />
      </Section>
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
