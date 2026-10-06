import { EFFECT_ATTRIBUTES } from "@modcreator/core/schema";
import { CheckField, ColorField, NumberField, OptionalGroup, Row, RowsField, Section, SelectField, TextField, getAt, setAt, type Draft, type Errors } from "./forms";
import { ItemIconView } from "./items";
import { TextureField } from "./TextureField";

interface EditorProps {
  draft: Draft;
  errors: Errors;
  onChange: (draft: Draft) => void;
}

const CATEGORY_HINTS: Record<string, string> = {
  beneficial: "Blue in tooltips, like Speed",
  harmful: "Red in tooltips, like Poison",
  neutral: "Neither, like Glowing",
};

/** 3:00 for 180 seconds. */
function clock(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A status effect: its look, the attributes it changes and an optional potion brewed from an awkward potion. */
export function EffectEditor(p: EditorProps) {
  const f = { draft: p.draft, errors: p.errors, onChange: p.onChange };
  const id: string = getAt(p.draft, ["id"]) ?? "";
  const category: string = getAt(p.draft, ["effect", "category"]) ?? "beneficial";
  const potion: { ingredient?: string; seconds?: number; longer?: boolean; stronger?: boolean } | undefined = getAt(p.draft, ["effect", "potion"]);
  const ingredient = potion?.ingredient ?? "";
  const seconds = potion?.seconds ?? 180;
  return (
    <>
      <Section title="General">
        <TextField {...f} path={["name"]} label="Display name" hint="Shown in the inventory and on potions, like Grove Stride" />
        <TextField {...f} path={["id"]} label="Id" hint={`Foods name it by this id. In game: /effect give @s <modid>:${id || "<id>"}`} />
        <SelectField {...f} path={["effect", "category"]} label="Category" options={["beneficial", "harmful", "neutral"]} hint={CATEGORY_HINTS[category]} />
        <ColorField {...f} path={["effect", "color"]} label="Color" fallback="#6ab0ff" hint="Particles and potion liquid" />
        <TextureField {...f} path={["effect", "icon"]} label="Icon" hint="An 18x18 PNG in art/, shown in the inventory and the corner of the screen" />
      </Section>
      <Section title="While it lasts">
        <RowsField
          {...f}
          path={["effect", "modifiers"]}
          label="Changes"
          hint="multiply_total 0.2 is 20% faster; add 0.5 on step_height steps up half a block more. Each level adds the amount again."
          columns={[
            { key: "attribute", label: "Attribute", type: "select", options: EFFECT_ATTRIBUTES },
            { key: "amount", label: "Amount", type: "number", step: 0.05 },
            { key: "operation", label: "How", type: "select", options: ["add", "multiply_base", "multiply_total"] },
          ]}
          template={{ attribute: "movement_speed", amount: 0.2, operation: "multiply_total" }}
          addLabel="+ Add a change"
        />
      </Section>
      <Section title="Potion">
        <OptionalGroup {...f} path={["effect", "potion"]} label="Can be brewed" template={{ ingredient: "", seconds: 180, longer: true, stronger: false }}>
          <Row label="Ingredient" hint="Added to an awkward potion in a brewing stand. An item from this mod or minecraft:..." error={p.errors.get("effect.potion.ingredient")}>
            <span className="icon-input">
              {ingredient && <ItemIconView refId={ingredient} size={24} />}
              <input value={ingredient} placeholder="azure_plum" onChange={(e) => p.onChange(setAt(p.draft, ["effect", "potion", "ingredient"], e.target.value.trim()))} />
            </span>
          </Row>
          <NumberField {...f} path={["effect", "potion", "seconds"]} label="Lasts (seconds)" min={1} hint={`${clock(seconds)}. Vanilla potions last 3:00`} />
          <CheckField {...f} path={["effect", "potion", "longer"]} label={`Redstone makes it last longer (${clock((seconds * 8) / 3)})`} />
          <CheckField {...f} path={["effect", "potion", "stronger"]} label={`Glowstone dust makes it level II (${clock(seconds / 2)})`} />
          <span className="field-hint">Gunpowder turns any of them into a splash potion, and dragon's breath a splash potion into a lingering one for tipped arrows.</span>
        </OptionalGroup>
      </Section>
    </>
  );
}
