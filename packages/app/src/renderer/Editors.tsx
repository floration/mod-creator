import { useContext, useEffect, useMemo, useState } from "react";
import { EMPTY_SLOTS, listFromSlots, patternFromSlots, sameShape, slotsFromList, slotsFromPattern, type Slots } from "@modcreator/core/recipe-grid";
import { ARMOR_PIECES, CreativeTab, EquipSound, MobBehavior, MobModel, OreHost, Rarity, SoundType, ToolTier, TreeShape, shapeBlocks, type ElementSpec } from "@modcreator/core/schema";
import {
  CheckField,
  ColorField,
  ListField,
  NumberField,
  OptionalGroup,
  RowsField,
  Section,
  SelectField,
  TextField,
  getAt,
  setAt,
  type Draft,
  type Errors,
} from "./forms";
import { pickAnimations, type EntityModelDef } from "@modcreator/core/blockbench";
import { api } from "./api";
import { blockbenchSheetLayout, mobSheetLayout } from "./Preview";
import { TextureContext, TextureField } from "./TextureField";
import { ItemContext, ItemIconView, ItemPicker, acceptsItem, dragItem, droppedItem, itemInfo } from "./items";

interface EditorProps {
  draft: Draft;
  errors: Errors;
  onChange: (draft: Draft) => void;
}

function Common(p: EditorProps & { nameHint?: string; idHint?: string; tab?: boolean; tags?: string; customClass?: boolean }) {
  const f = { draft: p.draft, errors: p.errors, onChange: p.onChange };
  return (
    <Section title="General">
      <TextField {...f} path={["name"]} label="Display name" hint={p.nameHint} />
      <TextField {...f} path={["id"]} label="Id" hint={p.idHint ?? "Lowercase, used in registry names and file names"} />
      {p.tab !== false && <SelectField {...f} path={["creativeTab"]} label="Creative tab" options={CreativeTab.options} optional />}
      {p.tags !== "" && <ListField {...f} path={["tags"]} label="Tags" placeholder={p.tags ?? "minecraft:mineable/pickaxe, minecraft:needs_iron_tool"} />}
      {p.customClass !== false && (
        <TextField
          {...f}
          path={["customClass"]}
          label="Custom class"
          optional
          placeholder="com.example.mymod.MyBlock"
          hint="Optional. A hand-written Java class to use instead of the vanilla one. Created once as a starter file."
        />
      )}
    </Section>
  );
}

const MODEL_TEMPLATES: Record<string, Draft> = {
  cube_all: { type: "cube_all", texture: "art/" },
  cube_column: { type: "cube_column", side: "art/", end: "art/" },
  custom: { type: "custom", model: "art/" },
};

/** Checkboxes for stairs, slabs and the rest, with door and trapdoor art when those are on. */
function ShapesSection(p: EditorProps & { title: string; from: string }) {
  const f = { draft: p.draft, errors: p.errors, onChange: p.onChange };
  let added: string[] = [];
  try {
    added = shapeBlocks(p.draft as ElementSpec).map((b) => b.id);
  } catch {
    // A half-typed draft: no list yet.
  }
  return (
    <Section title={p.title}>
      <span className="field-hint">Each one copies {p.from}: its hardness, sound and tool. Recipes and tags come with them.</span>
      <CheckField {...f} path={["shapes", "stairs"]} label="Stairs" />
      <CheckField {...f} path={["shapes", "slab"]} label="Slab" />
      <CheckField {...f} path={["shapes", "wall"]} label="Wall" />
      <CheckField {...f} path={["shapes", "fence"]} label="Fence" />
      <CheckField {...f} path={["shapes", "fenceGate"]} label="Fence gate" />
      <CheckField {...f} path={["shapes", "button"]} label="Button" />
      <CheckField {...f} path={["shapes", "pressurePlate"]} label="Pressure plate" />
      <OptionalGroup {...f} path={["shapes", "door"]} label="Door" template={{ top: "", bottom: "", icon: "" }}>
        <TextureField {...f} path={["shapes", "door", "top"]} label="Door top half" hint="16x16. Transparent pixels make windows" />
        <TextureField {...f} path={["shapes", "door", "bottom"]} label="Door bottom half" />
        <TextureField {...f} path={["shapes", "door", "icon"]} label="Door icon" hint="16x16 inventory icon" />
      </OptionalGroup>
      <TextureField {...f} path={["shapes", "trapdoor"]} label="Trapdoor" optional hint="Optional. A 16x16 texture adds a trapdoor" />
      {added.length > 0 && <span className="field-hint">Adds {added.join(", ")}</span>}
    </Section>
  );
}

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
        {modelType === "cube_all" && <TextureField {...f} path={["block", "model", "texture"]} label="Texture" hint="A 16x16 PNG in art/" />}
        {modelType === "cube_column" && (
          <>
            <TextureField {...f} path={["block", "model", "side"]} label="Side texture" />
            <TextureField {...f} path={["block", "model", "end"]} label="End texture" />
          </>
        )}
        {modelType === "custom" && <TextField {...f} path={["block", "model", "model"]} label="Model file" hint="Block model JSON, for example exported from Blockbench" />}
      </Section>
      {modelType !== "custom" && <ShapesSection {...p} title="Shapes" from="this block" />}
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
        <TextureField {...f} path={["item", "texture"]} label="Texture" hint="A 16x16 PNG in art/" />
        <NumberField {...f} path={["item", "maxStackSize"]} label="Max stack size" min={1} max={99} />
        <SelectField {...f} path={["item", "rarity"]} label="Rarity" options={Rarity.options} />
      </Section>
      <Section title="Food">
        <OptionalGroup {...f} path={["item", "food"]} label="Can be eaten" template={{ nutrition: 4, saturation: 0.3 }}>
          <NumberField {...f} path={["item", "food", "nutrition"]} label="Nutrition" min={0} max={20} hint="Hunger points; each drumstick is 2. Apple 4, bread 5, steak 8" />
          <NumberField {...f} path={["item", "food", "saturation"]} label="Saturation" step={0.1} min={0} max={2} hint="How long it keeps you full. Apple 0.3, bread 0.6, steak 0.8" />
          <CheckField {...f} path={["item", "food", "alwaysEdible"]} label="Can be eaten when not hungry" />
        </OptionalGroup>
      </Section>
    </>
  );
}

export function ToolEditor(p: EditorProps) {
  const f = { draft: p.draft, errors: p.errors, onChange: p.onChange };
  return (
    <>
      <Common {...p} customClass={false} tags="minecraft:enchantable/fire_aspect" />
      <Section title="Tool">
        <SelectField {...f} path={["tool", "type"]} label="Type" options={["sword", "pickaxe", "axe", "shovel", "hoe"]} />
        <TextureField {...f} path={["tool", "texture"]} label="Texture" hint="A 16x16 PNG in art/, drawn pointing up and to the right" />
        <SelectField {...f} path={["tool", "tier"]} label="Can mine what this tier mines" options={ToolTier.options} />
        <TextField {...f} path={["tool", "repairItem"]} label="Repaired with" optional hint="Optional. An item from this mod or minecraft:..., used in an anvil" />
        <SelectField {...f} path={["tool", "rarity"]} label="Rarity" options={Rarity.options} />
      </Section>
      <Section title="Stats">
        <NumberField {...f} path={["tool", "durability"]} label="Durability" min={1} max={10000} hint="Iron 250, diamond 1561" />
        <NumberField {...f} path={["tool", "attackDamage"]} label="Attack damage" step={0.5} min={0} hint="Added to the base 1. Iron sword 5, diamond sword 6" />
        <NumberField {...f} path={["tool", "attackSpeed"]} label="Attack speed" step={0.1} min={-4} max={4} hint="Added to the base 4. Swords -2.4, axes about -3" />
        <NumberField {...f} path={["tool", "miningSpeed"]} label="Mining speed" step={0.5} min={0} hint="Iron 6, diamond 8, gold 12" />
        <NumberField {...f} path={["tool", "enchantability"]} label="Enchantability" min={0} max={50} hint="Iron 14, diamond 10, gold 22" />
      </Section>
    </>
  );
}

const PIECE_NAMES: Record<string, string> = { helmet: "Helmet", chestplate: "Chestplate", leggings: "Leggings", boots: "Boots" };

export function ArmorEditor(p: EditorProps) {
  const f = { draft: p.draft, errors: p.errors, onChange: p.onChange };
  const id = getAt(p.draft, ["id"]) ?? "";
  return (
    <>
      <Common {...p} customClass={false} tags="" nameHint="Set name; pieces are called Name Helmet, Name Chestplate and so on" />
      <Section title="Pieces">
        {ARMOR_PIECES.map((piece) => {
          const on = getAt(p.draft, ["armor", "pieces", piece]) !== undefined;
          return (
            <div key={piece}>
              <label className="field field-check">
                <input type="checkbox" checked={on} onChange={(e) => p.onChange(setAt(p.draft, ["armor", "pieces", piece], e.target.checked ? `art/${id}_${piece}.png` : undefined))} />
                <span className="field-label">{PIECE_NAMES[piece]} <span className="muted">({id}_{piece})</span></span>
              </label>
              {on && <TextureField {...f} path={["armor", "pieces", piece]} label="Icon" />}
            </div>
          );
        })}
      </Section>
      <Section title="Worn look">
        <TextureField {...f} size={[64, 32]} path={["armor", "layer1"]} label="Layer 1 texture" hint="64x32 PNG in the vanilla armor layout, for the helmet, chestplate and boots" />
        <TextureField {...f} size={[64, 32]} path={["armor", "layer2"]} label="Layer 2 texture" hint="64x32 PNG for the leggings" />
        <SelectField {...f} path={["armor", "equipSound"]} label="Equip sound" options={EquipSound.options} />
      </Section>
      <Section title="Stats">
        {ARMOR_PIECES.map((piece) => (
          <NumberField key={piece} {...f} path={["armor", "defense", piece]} label={`${PIECE_NAMES[piece]} armor points`} min={0} max={30} />
        ))}
        <span className="field-hint">Iron is 2, 6, 5, 2 and diamond 3, 8, 6, 3.</span>
        <NumberField {...f} path={["armor", "durability"]} label="Durability multiplier" min={1} max={200} hint="Iron 15, diamond 33" />
        <NumberField {...f} path={["armor", "toughness"]} label="Toughness" step={0.5} min={0} max={20} hint="Diamond 2, netherite 3" />
        <NumberField {...f} path={["armor", "knockbackResistance"]} label="Knockback resistance" step={0.05} min={0} max={1} hint="Netherite 0.1" />
        <NumberField {...f} path={["armor", "enchantability"]} label="Enchantability" min={0} max={50} />
        <TextField {...f} path={["armor", "repairItem"]} label="Repaired with" optional />
        <SelectField {...f} path={["armor", "rarity"]} label="Rarity" options={Rarity.options} />
      </Section>
    </>
  );
}

export function TreeEditor(p: EditorProps) {
  const f = { draft: p.draft, errors: p.errors, onChange: p.onChange };
  const id = getAt(p.draft, ["id"]) ?? "";
  return (
    <>
      <Common {...p} customClass={false} tags="" nameHint="Wood name; blocks are called Name Log, Name Planks, Name Leaves and Name Sapling" idHint={`Blocks are ${id}_log, ${id}_planks, ${id}_leaves and ${id}_sapling`} />
      <Section title="Textures">
        <TextureField {...f} path={["tree", "logSide"]} label="Log bark" />
        <TextureField {...f} path={["tree", "logEnd"]} label="Log rings" />
        <TextureField {...f} path={["tree", "planks"]} label="Planks" />
        <TextureField {...f} path={["tree", "leaves"]} label="Leaves" hint="Use transparent pixels for gaps" />
        <TextureField {...f} path={["tree", "sapling"]} label="Sapling" />
      </Section>
      <Section title="Shape">
        <SelectField {...f} path={["tree", "shape"]} label="Grows like" options={TreeShape.options} />
        <NumberField {...f} path={["tree", "trunkHeight"]} label="Trunk height" min={1} max={32} hint="Optional. Leave empty for the shape's own" />
        <NumberField {...f} path={["tree", "trunkHeightRandom"]} label="Extra random height" min={0} max={24} hint="Optional. Up to this many more blocks" />
        <NumberField {...f} path={["tree", "leafRadius"]} label="Leaf radius" min={0} max={8} hint="Optional. Oak, birch and fancy oak only" />
      </Section>
      <Section title="Leaf drops">
        <NumberField {...f} path={["tree", "saplingChance"]} label="Sapling chance" step={0.01} min={0} max={1} hint="Oak 0.05, jungle 0.025" />
        <OptionalGroup {...f} path={["tree", "fruit"]} label="Drops a fruit, like oak apples" template={{ item: "", chance: 0.02 }}>
          <TextField {...f} path={["tree", "fruit", "item"]} label="Fruit item" />
          <NumberField {...f} path={["tree", "fruit", "chance"]} label="Chance" step={0.005} min={0} max={1} hint="Oak apples are 0.005" />
        </OptionalGroup>
      </Section>
      <ShapesSection {...p} title="Wood set" from="the planks" />
    </>
  );
}

export function PlantEditor(p: EditorProps) {
  const f = { draft: p.draft, errors: p.errors, onChange: p.onChange };
  const drops = getAt(p.draft, ["plant", "drops"]) ?? "nothing";
  const dropKind = typeof drops === "object" ? "item" : drops;
  return (
    <>
      <Common {...p} tags="minecraft:replaceable_by_trees, minecraft:sword_efficient" />
      <Section title="Plant">
        <TextureField {...f} path={["plant", "texture"]} label="Texture" hint="A 16x16 PNG drawn as two crossed planes, like short grass" />
        <CheckField {...f} path={["plant", "offset"]} label="Nudge each plant randomly, like grass" />
      </Section>
      <Section title="Drops">
        <label className="field">
          <span className="field-label">When broken without shears</span>
          <select
            value={dropKind}
            onChange={(e) => {
              const v = e.target.value;
              p.onChange(setAt(p.draft, ["plant", "drops"], v === "item" ? { item: "minecraft:wheat_seeds", chance: 0.125 } : v));
            }}
          >
            <option value="nothing">Nothing</option>
            <option value="self">Itself</option>
            <option value="item">Sometimes an item, like seeds</option>
          </select>
        </label>
        {dropKind === "item" && (
          <>
            <TextField {...f} path={["plant", "drops", "item"]} label="Item" />
            <NumberField {...f} path={["plant", "drops", "chance"]} label="Chance" step={0.005} min={0} max={1} hint="Grass drops seeds 0.125 of the time" />
          </>
        )}
        <span className="field-hint">Shears always drop the plant itself.</span>
      </Section>
    </>
  );
}

/** A mob's Blockbench model as the app reads it, or why it can't be used. */
function useBlockbench(file: string | undefined): { model: EntityModelDef | null; error: string | null } {
  const world = useContext(TextureContext);
  const [result, setResult] = useState<{ model: EntityModelDef | null; error: string | null }>({ model: null, error: null });
  useEffect(() => {
    setResult({ model: null, error: null });
    if (!world || !file || !file.endsWith(".bbmodel")) return;
    let live = true;
    api().loadBlockbench(world.root, file).then((r) => live && setResult(r));
    return () => {
      live = false;
    };
  }, [world?.root, world?.version, file]);
  return result;
}

const BEHAVIOR_HINTS: Record<string, string> = {
  animal: "Wanders, runs when hurt, and breeds when fed",
  neutral: "Like an animal, but fights back when hurt, with its herd",
  tameable: "Feeding it may tame it. Tamed, it follows you, fights for you, and sits when you click it",
  hostile: "Spawns in the dark and attacks players. Doesn't breed",
};

export function MobEditor(p: EditorProps) {
  const f = { draft: p.draft, errors: p.errors, onChange: p.onChange };
  const model = getAt(p.draft, ["mob", "model"]) ?? "pig";
  const custom = model === "blockbench";
  const bb = useBlockbench(custom ? getAt(p.draft, ["mob", "blockbench"]) : undefined);
  const world = useContext(TextureContext);
  const sheet: [number, number] = bb.model ? [bb.model.textureWidth, bb.model.textureHeight] : [64, 64];
  const { walk, idle } = bb.model ? pickAnimations(bb.model) : { walk: null, idle: null };
  const behavior: string = getAt(p.draft, ["mob", "behavior"]) ?? "animal";

  /** Save the texture embedded in the .bbmodel to art/<id>.png and use it. */
  const useEmbedded = async () => {
    if (!world || !bb.model?.embeddedTexture) return;
    const file = `art/${getAt(p.draft, ["id"]) || "mob"}.png`;
    await api().saveArt(world.root, file, bb.model.embeddedTexture);
    world.saved();
    p.onChange(setAt(p.draft, ["mob", "texture"], file));
  };

  return (
    <>
      <Common {...p} tab={false} tags="" customClass={false} idHint="Lowercase. The spawn egg is <id>_spawn_egg" />
      <Section title="Look">
        <SelectField {...f} path={["mob", "model"]} label="Body" options={MobModel.options} hint={custom ? "Your own model, made in Blockbench" : "Borrows this animal's model and animations"} />
        {custom && (
          <>
            <TextField {...f} path={["mob", "blockbench"]} placeholder="art/name.bbmodel" label="Blockbench model" hint="A .bbmodel in art/, made with Blockbench's Modded Entity format and Box UV" />
            {bb.error && <span className="field-hint bad">{bb.error}</span>}
            {bb.model && (
              <span className="field-hint">
                {bb.model.parts.length} top-level parts, {bb.model.textureWidth}x{bb.model.textureHeight} texture. Walk animation: {walk?.name ?? "none"}. Idle animation: {idle?.name ?? "none"}.
                {" "}Animations whose names contain "walk" and "idle" play in game.
              </span>
            )}
            {bb.model?.embeddedTexture && (
              <button type="button" onClick={useEmbedded}>Use the texture saved in the model</button>
            )}
          </>
        )}
        <TextureField
          {...f}
          size={sheet}
          guide={custom ? (bb.model ? blockbenchSheetLayout(bb.model) : null) : mobSheetLayout(model)}
          path={["mob", "texture"]}
          label="Texture"
          hint={custom ? `${sheet[0]}x${sheet[1]} PNG in the model's layout` : `64x64 PNG in the vanilla ${model} layout`}
        />
        <TextureField {...f} size={sheet} path={["mob", "babyTexture"]} label="Baby texture" optional hint={custom ? "Optional. Babies use the same model at half size" : `Optional. In the vanilla baby ${model} layout`} />
        <TextureField {...f} path={["mob", "spawnEgg"]} label="Spawn egg icon" />
      </Section>
      <Section title="Behavior">
        <NumberField {...f} path={["mob", "health"]} label="Health" min={1} max={1024} hint="In half hearts. Pig 10, cow 10" />
        <NumberField {...f} path={["mob", "speed"]} label="Speed" step={0.05} min={0} max={2} hint="Pig 0.25, cow 0.2" />
        <SelectField {...f} path={["mob", "behavior"]} label="Acts like" options={MobBehavior.options} hint={BEHAVIOR_HINTS[behavior]} />
        <CheckField {...f} path={["mob", "flies"]} label="Flies" hint="Flies around like a parrot instead of walking, and takes no fall damage" />
        {behavior !== "animal" && (
          <NumberField {...f} path={["mob", "attackDamage"]} label="Attack damage" step={0.5} min={0} max={100} hint="Per hit, in half hearts. Zombie 3, wolf 4" />
        )}
        <TextField
          {...f}
          path={["mob", "food"]}
          label="Food"
          optional={behavior === "hostile"}
          hint={behavior === "hostile" ? "Not needed: hostile mobs don't breed" : `${behavior === "tameable" ? "Tames, tempts" : "Tempts"} and breeds it. An item, or a tag like #minecraft:pig_food`}
        />
        <NumberField {...f} path={["mob", "width"]} label="Hitbox width" step={0.1} min={0.1} max={16} />
        <NumberField {...f} path={["mob", "height"]} label="Hitbox height" step={0.1} min={0.1} max={16} />
      </Section>
      <Section title="Drops">
        <RowsField
          {...f}
          path={["mob", "drops"]}
          label="Drops when killed"
          hint="Looting adds up to one more per level"
          columns={[
            { key: "item", label: "Item", type: "text", placeholder: "minecraft:porkchop" },
            { key: "min", label: "Min", type: "number", min: 0 },
            { key: "max", label: "Max", type: "number", min: 0 },
          ]}
          template={{ item: "", min: 1, max: 1 }}
        />
      </Section>
      <Section title="Sounds">
        <TextField {...f} path={["mob", "sounds", "ambient"]} label="Ambient" optional placeholder={custom ? "minecraft:entity.bee.loop" : `minecraft:entity.${model}.ambient`} />
        <TextField {...f} path={["mob", "sounds", "hurt"]} label="Hurt" optional placeholder={custom ? "minecraft:entity.bee.hurt" : `minecraft:entity.${model}.hurt`} />
        <TextField {...f} path={["mob", "sounds", "death"]} label="Death" optional placeholder={custom ? "minecraft:entity.bee.death" : `minecraft:entity.${model}.death`} />
        <span className="field-hint">
          A sound from this mod by id, or a vanilla one starting with minecraft:. {custom ? "Leave empty for no sound." : `Leave empty to use the ${model}'s own sounds.`}
        </span>
      </Section>
    </>
  );
}

export function BiomeEditor(p: EditorProps) {
  const f = { draft: p.draft, errors: p.errors, onChange: p.onChange };
  return (
    <>
      <Common {...p} tab={false} customClass={false} tags="minecraft:is_forest" />
      <Section title="Where it generates">
        <RowsField
          {...f}
          path={["biome", "replaces"]}
          label="Takes over part of"
          hint="Vanilla Overworld biomes. Share 0.3 turns about 30% of that biome into this one. Placed by the Biolith library."
          columns={[
            { key: "biome", label: "Biome", type: "text", placeholder: "minecraft:plains" },
            { key: "share", label: "Share", type: "number", step: 0.05, min: 0.01, max: 1 },
          ]}
          template={{ biome: "minecraft:plains", share: 0.25 }}
        />
      </Section>
      <Section title="Climate">
        <NumberField {...f} path={["biome", "temperature"]} label="Temperature" step={0.05} min={-2} max={2} hint="Snow below 0.15. Plains 0.8, taiga 0.25, desert 2" />
        <NumberField {...f} path={["biome", "downfall"]} label="Downfall" step={0.05} min={0} max={1} hint="Wetness; affects grass and foliage colors when not set" />
        <CheckField {...f} path={["biome", "precipitation"]} label="Rains or snows" />
      </Section>
      <Section title="Colors">
        <ColorField {...f} path={["biome", "colors", "sky"]} label="Sky" fallback="#78a7ff" />
        <ColorField {...f} path={["biome", "colors", "fog"]} label="Fog" optional fallback="#c0d8ff" />
        <ColorField {...f} path={["biome", "colors", "water"]} label="Water" fallback="#3f76e4" />
        <ColorField {...f} path={["biome", "colors", "waterFog"]} label="Underwater fog" optional fallback="#050533" />
        <ColorField {...f} path={["biome", "colors", "grass"]} label="Grass" optional fallback="#91bd59" />
        <ColorField {...f} path={["biome", "colors", "foliage"]} label="Leaves" optional fallback="#77ab2f" />
      </Section>
      <Section title="Vegetation">
        <RowsField
          {...f}
          path={["biome", "trees"]}
          label="Trees"
          columns={[
            { key: "tree", label: "Tree", type: "text", placeholder: "a tree id from this mod" },
            { key: "perChunk", label: "Per chunk", type: "number", min: 1, max: 64 },
          ]}
          template={{ tree: "", perChunk: 4 }}
        />
        <RowsField
          {...f}
          path={["biome", "plants"]}
          label="Plants"
          columns={[
            { key: "plant", label: "Plant", type: "text", placeholder: "a plant id from this mod" },
            { key: "patchesPerChunk", label: "Patches per chunk", type: "number", min: 1, max: 32 },
          ]}
          template={{ plant: "", patchesPerChunk: 4 }}
        />
        <ListField {...f} path={["biome", "vanillaFeatures"]} label="Vanilla features" placeholder="minecraft:flower_default, minecraft:patch_grass_plain" hint="Vanilla placed features to add, like flowers" />
      </Section>
      <Section title="Creatures">
        <RowsField
          {...f}
          path={["biome", "spawns"]}
          label="Spawns"
          hint="Vanilla monsters, bats and glow squid always spawn too"
          columns={[
            { key: "mob", label: "Mob", type: "text", placeholder: "minecraft:sheep" },
            { key: "weight", label: "Weight", type: "number", min: 1 },
            { key: "min", label: "Min", type: "number", min: 1 },
            { key: "max", label: "Max", type: "number", min: 1 },
          ]}
          template={{ mob: "", weight: 10, min: 2, max: 4 }}
        />
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

export type Kind = "block" | "item" | "recipe" | "ore" | "tool" | "armor" | "tree" | "plant" | "mob" | "biome" | "advancement" | "structure" | "sound";

/** Starting point for a new spec of each kind. */
export function newSpec(kind: Kind, id: string): Draft {
  const name = id.split("_").map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ");
  const base = { $schema: `../../.modcreator/schema/${kind}.json`, kind, id, name };
  const art = (suffix = "") => `art/${id}${suffix}.png`;
  switch (kind) {
    case "block":
      return { ...base, tags: [], block: { hardness: 1.5, resistance: 6, sound: "stone", model: { type: "cube_all", texture: art() } } };
    case "item":
      return { ...base, item: { texture: art() } };
    case "ore":
      return { ...base, ore: { block: "", replaces: "stone_and_deepslate", veinSize: 8, veinsPerChunk: 4, minY: -64, maxY: 64, distribution: "uniform" } };
    case "tool":
      return { ...base, creativeTab: "combat", tool: { type: "sword", texture: art(), tier: "iron", durability: 250, miningSpeed: 6, attackDamage: 5, attackSpeed: -2.4, enchantability: 14 } };
    case "armor":
      return {
        ...base,
        creativeTab: "combat",
        armor: {
          pieces: Object.fromEntries(ARMOR_PIECES.map((piece) => [piece, art(`_${piece}`)])),
          layer1: art("_layer_1"),
          layer2: art("_layer_2"),
          durability: 15,
          defense: { helmet: 2, chestplate: 6, leggings: 5, boots: 2 },
        },
      };
    case "tree":
      return { ...base, tree: { logSide: art("_log"), logEnd: art("_log_top"), planks: art("_planks"), leaves: art("_leaves"), sapling: art("_sapling"), shape: "oak" } };
    case "plant":
      return { ...base, creativeTab: "natural_blocks", plant: { texture: art(), drops: "nothing" } };
    case "mob":
      return { ...base, mob: { model: "pig", texture: art(), spawnEgg: art("_spawn_egg"), health: 10, speed: 0.25, food: "minecraft:carrot", drops: [] } };
    case "biome":
      return { ...base, tags: [], biome: { temperature: 0.7, downfall: 0.8, colors: { sky: "#78a7ff", water: "#3f76e4" }, replaces: [{ biome: "minecraft:plains", share: 0.25 }], trees: [], plants: [], spawns: [] } };
    case "recipe":
      return { $schema: base.$schema, kind, id, recipe: RECIPE_TEMPLATES.shaped({ item: "", count: 1 }) };
    case "sound":
      return { ...base, sound: { files: [] } };
    case "structure":
      return { ...base, structure: { file: `art/${id}.nbt`, biomes: ["minecraft:plains"], spacing: 32, separation: 8, placement: "surface", y: 0, terrain: "beard_thin" } };
    case "advancement":
      return { ...base, advancement: { description: "", icon: "minecraft:book", frame: "task", criteria: [{ type: "obtain", item: "", count: 1 }] } };
  }
}
