import { EFFECT_ATTRIBUTES, EnchantmentSlot, VANILLA_EFFECTS } from "@modcreator/core/schema";
import { CheckField, ListField, NumberField, Row, Section, TextField, getAt, setAt, type Draft, type Errors } from "./forms";

interface EditorProps {
  draft: Draft;
  errors: Errors;
  onChange: (draft: Draft) => void;
}

/** Each effect type: its label, what the amount means and the starting row. */
const EFFECT_TYPES: Record<string, { label: string; unit: string; template: Draft }> = {
  damage: { label: "Extra damage", unit: "damage", template: { type: "damage", amount: 1, perLevel: 0.5 } },
  protection: { label: "Protection", unit: "points, ~4% each", template: { type: "protection", amount: 1, perLevel: 1 } },
  knockback: { label: "Knockback", unit: "strength", template: { type: "knockback", amount: 1, perLevel: 1 } },
  ignite: { label: "Sets target on fire", unit: "seconds", template: { type: "ignite", amount: 4, perLevel: 4 } },
  effect_on_hit: { label: "Effect on target", unit: "seconds", template: { type: "effect_on_hit", effect: "minecraft:slowness", amplifier: 0, amount: 2, perLevel: 1 } },
  attribute: { label: "Attribute", unit: "amount", template: { type: "attribute", attribute: "movement_speed", operation: "multiply_total", amount: 0.1, perLevel: 0.1 } },
};

const ITEM_TAGS = [
  "weapon", "melee_weapon", "sharp_weapon", "sweeping", "fire_aspect", "mining", "mining_loot", "durability", "armor",
  "head_armor", "chest_armor", "leg_armor", "foot_armor", "equippable", "bow", "crossbow", "trident", "mace", "fishing", "lunge", "vanishing",
].map((t) => `#minecraft:enchantable/${t}`);

/** Value at a level, the way vanilla's linear numbers work. */
const atLevel = (amount: number, perLevel: number, level: number) => Math.round((amount + perLevel * (level - 1)) * 100) / 100;

function EffectsField(p: EditorProps) {
  const path = ["enchantment", "effects"];
  const rows: Draft[] = getAt(p.draft, path) ?? [];
  const maxLevel: number = getAt(p.draft, ["enchantment", "maxLevel"]) ?? 1;
  const setRows = (next: Draft[]) => p.onChange(setAt(p.draft, path, next));
  const set = (i: number, key: string, value: unknown) => setRows(rows.map((r, n) => (n === i ? setAt(r, [key], value) : r)));
  const num = (v: string) => (v === "" ? undefined : Number(v));
  const error = rows.flatMap((_, i) => [...p.errors.entries()].filter(([k]) => k.startsWith(`${path.join(".")}.${i}.`)).map(([, m]) => m))[0] ?? p.errors.get(path.join("."));
  return (
    <div className="field rows-field">
      <span className="field-label">What it does</span>
      {rows.map((r, i) => {
        const t = EFFECT_TYPES[r.type] ?? EFFECT_TYPES.damage;
        return (
          <div className="enchant-effect" key={i}>
            <select value={r.type} onChange={(e) => setRows(rows.map((x, n) => (n === i ? EFFECT_TYPES[e.target.value].template : x)))}>
              {Object.entries(EFFECT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            {r.type === "effect_on_hit" && (
              <>
                <input list="vanilla-effects" value={r.effect ?? ""} placeholder="minecraft:slowness" title="An effect from this mod by id, or minecraft:..." onChange={(e) => set(i, "effect", e.target.value.trim())} />
                <label className="inline">Level <input type="number" min={0} max={255} value={r.amplifier ?? 0} onChange={(e) => set(i, "amplifier", num(e.target.value))} /></label>
              </>
            )}
            {r.type === "attribute" && (
              <>
                <select value={r.attribute} onChange={(e) => set(i, "attribute", e.target.value)}>
                  {EFFECT_ATTRIBUTES.map((a) => <option key={a}>{a}</option>)}
                </select>
                <select value={r.operation ?? "add"} onChange={(e) => set(i, "operation", e.target.value)}>
                  {["add", "multiply_base", "multiply_total"].map((o) => <option key={o}>{o}</option>)}
                </select>
              </>
            )}
            {r.type === "damage" && (
              <input value={r.against ?? ""} placeholder="against any mob" title="Only against this mob, or an entity tag like #minecraft:undead" onChange={(e) => set(i, "against", e.target.value.trim() || undefined)} />
            )}
            <label className="inline">At I <input type="number" step={0.5} value={r.amount ?? 1} onChange={(e) => set(i, "amount", num(e.target.value))} /></label>
            <label className="inline">+ per level <input type="number" step={0.5} value={r.perLevel ?? 1} onChange={(e) => set(i, "perLevel", num(e.target.value))} /></label>
            <button className="icon" title="Remove" onClick={() => setRows(rows.filter((_, n) => n !== i))}>×</button>
            <span className="field-hint">
              {Array.from({ length: Math.min(maxLevel, 5) }, (_, n) => `${["I", "II", "III", "IV", "V"][n]}: ${atLevel(r.amount ?? 1, r.perLevel ?? 1, n + 1)}`).join(" · ")} {t.unit}
            </span>
          </div>
        );
      })}
      <datalist id="vanilla-effects">
        {VANILLA_EFFECTS.map((e) => <option key={e} value={`minecraft:${e}`} />)}
      </datalist>
      <button className="link" onClick={() => setRows([...rows, EFFECT_TYPES.damage.template])}>+ Add an effect</button>
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

/** An enchantment: the items that take it, its levels and rarity, and what it does at each level. */
export function EnchantmentEditor(p: EditorProps) {
  const f = { draft: p.draft, errors: p.errors, onChange: p.onChange };
  const id: string = getAt(p.draft, ["id"]) ?? "";
  const slots: string[] = getAt(p.draft, ["enchantment", "slots"]) ?? ["mainhand"];
  const toggleSlot = (s: string, on: boolean) => p.onChange(setAt(p.draft, ["enchantment", "slots"], on ? [...slots, s] : slots.filter((x) => x !== s)));
  return (
    <>
      <Section title="General">
        <TextField {...f} path={["name"]} label="Display name" hint="Shown on the item, like Lurker's Bane" />
        <TextField {...f} path={["id"]} label="Id" hint={`In game: /enchant @s <modid>:${id || "<id>"}`} />
        <NumberField {...f} path={["enchantment", "maxLevel"]} label="Max level" min={1} max={255} hint="Sharpness 5, Fire Aspect 2, Mending 1" />
      </Section>
      <Section title="Items">
        <TextField {...f} path={["enchantment", "items"]} label="Goes on" list="enchantable-tags" placeholder="#minecraft:enchantable/sharp_weapon" hint="An item tag like #minecraft:enchantable/armor, or one item. Used by the anvil" />
        <TextField {...f} path={["enchantment", "tableItems"]} label="Enchanting table offers it on" optional list="enchantable-tags" placeholder="(same as above)" hint="Optional. Narrower than the above, like Bane of Arthropods only on melee weapons" />
        <datalist id="enchantable-tags">{ITEM_TAGS.map((t) => <option key={t} value={t} />)}</datalist>
        <Row label="Works while in" error={p.errors.get("enchantment.slots")}>
          <span className="checks">
            {EnchantmentSlot.options.map((s) => (
              <label key={s} className="inline">
                <input type="checkbox" checked={slots.includes(s)} onChange={(e) => toggleSlot(s, e.target.checked)} /> {s}
              </label>
            ))}
          </span>
        </Row>
      </Section>
      <Section title="Effects">
        <EffectsField {...p} />
      </Section>
      <Section title="Finding it">
        <CheckField {...f} path={["enchantment", "treasure"]} label="Treasure: only from loot and trades, not the enchanting table" />
        <CheckField {...f} path={["enchantment", "curse"]} label="Curse: red, and a grindstone can't remove it" />
        <NumberField {...f} path={["enchantment", "weight"]} label="Weight" min={1} max={1024} hint="How often it comes up. Sharpness 10, Fire Aspect 2, Silk Touch 1" />
        <NumberField {...f} path={["enchantment", "anvilCost"]} label="Anvil cost" min={0} max={255} hint="Levels an anvil charges per enchantment level. Sharpness 1, Fire Aspect 4" />
        <NumberField {...f} path={["enchantment", "minCost", "base"]} label="Lowest enchanting power at level I" hint="Sharpness 1, Fire Aspect 10. A full bookshelf setup reaches 30, plus bonuses" />
        <NumberField {...f} path={["enchantment", "minCost", "perLevel"]} label="Added per level" />
        <NumberField {...f} path={["enchantment", "maxCost", "base"]} label="Highest enchanting power at level I" hint="Usually the lowest + 20" />
        <NumberField {...f} path={["enchantment", "maxCost", "perLevel"]} label="Added per level" />
        <ListField {...f} path={["enchantment", "exclusiveWith"]} label="Can't be combined with" placeholder="#minecraft:exclusive_set/damage, minecraft:mending" />
      </Section>
    </>
  );
}
