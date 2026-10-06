import { useContext, useMemo } from "react";
import { AdvancementFrame, CRITERION_TYPES, type AdvancementSpec } from "@modcreator/core/schema";
import { CheckField, ListField, NumberField, Row, RowsField, Section, SelectField, TextField, getAt, setAt, type Draft, type Errors } from "./forms";
import { TextureField } from "./TextureField";
import { ItemContext, ItemIconView } from "./items";
import { TagContext, TagInput, tagOptions, useElementOptions, useItemOptions, type TagOption } from "./TagField";

interface EditorProps {
  draft: Draft;
  errors: Errors;
  onChange: (draft: Draft) => void;
}

/** For each criterion type: the field it names, a label for it, a placeholder and what it means. */
const CRITERIA: Record<string, { field: string; label: string; placeholder: string; hint: string; icon?: boolean }> = {
  obtain: { field: "item", label: "Item", placeholder: "ruby or #minecraft:logs", hint: "Have it in the inventory", icon: true },
  kill: { field: "mob", label: "Mob", placeholder: "a mob id, or minecraft:zombie", hint: "Kill one" },
  visit: { field: "biome", label: "Biome", placeholder: "a biome id, or minecraft:plains", hint: "Stand in it" },
  craft: { field: "recipe", label: "Recipe", placeholder: "a recipe id, like ruby_block", hint: "Craft with this recipe" },
  eat: { field: "item", label: "Item", placeholder: "an item id, or minecraft:apple", hint: "Eat or drink it", icon: true },
  place: { field: "block", label: "Block", placeholder: "a block id, or minecraft:torch", hint: "Place it", icon: true },
  breed: { field: "mob", label: "Mob", placeholder: "a mob id, or minecraft:cow", hint: "Breed two of them" },
  tame: { field: "mob", label: "Mob", placeholder: "a tameable mob id, or minecraft:wolf", hint: "Tame one" },
};

/** Dropdown choices for each criterion field that takes an id or a tag: items, blocks, mobs and biomes. */
function useCriterionChoices(): Record<string, TagOption[]> {
  const tags = useContext(TagContext);
  const items = useItemOptions();
  const mobs = useElementOptions("mob");
  const biomes = useElementOptions("biome");
  return useMemo(
    () => ({
      item: [...items, ...tagOptions(tags, "item", true)],
      block: [...items, ...tagOptions(tags, "block", true)],
      mob: [...mobs, ...tagOptions(tags, "entity_type", true)],
      biome: [...biomes, ...tagOptions(tags, "worldgen/biome", true)],
    }),
    [tags, items, mobs, biomes],
  );
}

const FRAME_HINTS: Record<string, string> = {
  task: "Square, for ordinary steps",
  goal: "Rounded, for milestones",
  challenge: "Spiky with a purple title, for hard ones",
};

/** An advancement: vanilla advancement fields, criteria as rows and rewards. */
export function AdvancementEditor(p: EditorProps & { siblings: string[] }) {
  const f = { draft: p.draft, errors: p.errors, onChange: p.onChange };
  const parent: string | undefined = getAt(p.draft, ["advancement", "parent"]);
  const icon: string = getAt(p.draft, ["advancement", "icon"]) ?? "";
  const frame: string = getAt(p.draft, ["advancement", "frame"]) ?? "task";
  return (
    <>
      <Section title="Advancement">
        <TextField {...f} path={["name"]} label="Title" />
        <TextField {...f} path={["id"]} label="Id" hint="Lowercase. Other advancements name it as their parent" />
        <TextField {...f} path={["advancement", "description"]} label="Description" hint="Shown under the title, like Mine some azurite" />
        <Row label="Comes after" hint={parent ? "Unlocks on the line once its parent is done" : "No parent: this advancement starts its own tab in the advancements screen"} error={p.errors.get("advancement.parent")}>
          <input
            list="advancement-parents"
            value={parent ?? ""}
            placeholder="(none: starts a new tab)"
            onChange={(e) => p.onChange(setAt(p.draft, ["advancement", "parent"], e.target.value.trim() || undefined))}
          />
          <datalist id="advancement-parents">
            {p.siblings.map((id) => <option key={id} value={id} />)}
            <option value="minecraft:story/root" />
            <option value="minecraft:adventure/root" />
            <option value="minecraft:husbandry/root" />
          </datalist>
        </Row>
        <Row label="Icon" hint="An item id from this mod, or minecraft:..." error={p.errors.get("advancement.icon")}>
          <span className="icon-input">
            {icon && <ItemIconView refId={icon} size={24} />}
            <input value={icon} placeholder="ruby" onChange={(e) => p.onChange(setAt(p.draft, ["advancement", "icon"], e.target.value.trim()))} />
          </span>
        </Row>
        <SelectField {...f} path={["advancement", "frame"]} label="Frame" options={AdvancementFrame.options} hint={FRAME_HINTS[frame]} />
        {!parent && (
          <TextureField {...f} path={["advancement", "background"]} label="Tab background" optional hint="Optional. A 16x16 texture tiled behind the tab; vanilla stone when empty" />
        )}
      </Section>
      <CriteriaSection {...f} />
      <Section title="Rewards">
        <NumberField {...f} path={["advancement", "rewards", "experience"]} label="Experience" min={0} hint="Experience points, not levels. Level 5 takes 55" />
        <RowsField
          {...f}
          path={["advancement", "rewards", "items"]}
          label="Items"
          hint="Given to the player when the advancement is done"
          columns={[
            { key: "item", label: "Item", type: "text", placeholder: "ruby or minecraft:bread" },
            { key: "count", label: "Count", type: "number", min: 1, max: 99 },
          ]}
          template={{ item: "", count: 1 }}
        />
        <ListField {...f} path={["advancement", "rewards", "recipes"]} label="Recipes" placeholder="ruby_block, minecraft:lantern" hint="Unlocked in the recipe book" />
      </Section>
      <Section title="Display">
        <CheckField {...f} path={["advancement", "announce"]} label="Show a toast and a chat message when earned" />
        <CheckField {...f} path={["advancement", "hidden"]} label="Hidden until earned" />
      </Section>
    </>
  );
}

/** Each criterion is a type and the thing it names; `obtain` also has a count. */
function CriteriaSection(p: EditorProps) {
  const path = ["advancement", "criteria"];
  const rows: Draft[] = getAt(p.draft, path) ?? [];
  const setRows = (next: Draft[]) => p.onChange(setAt(p.draft, path, next));
  const setRow = (i: number, row: Draft) => setRows(rows.map((r, n) => (n === i ? row : r)));
  const requires: string = getAt(p.draft, ["advancement", "requires"]) ?? "all";
  const listError = p.errors.get(path.join("."));
  const choices = useCriterionChoices();
  const rowError = rows.map((row, i) => p.errors.get(`${path.join(".")}.${i}.${(CRITERIA[row.type] ?? CRITERIA.obtain).field}`)).find(Boolean);
  return (
    <Section title="To complete it">
      {rows.length > 0 && (
        <table className="rows criteria">
          <tbody>
            {rows.map((row, i) => {
              const kind = CRITERIA[row.type] ?? CRITERIA.obtain;
              const at = `${path.join(".")}.${i}`;
              const error = p.errors.get(`${at}.${kind.field}`) ?? p.errors.get(`${at}.count`) ?? p.errors.get(`${at}.type`);
              return (
                <tr key={i}>
                  <td>
                    <select
                      value={row.type}
                      title={kind.hint}
                      onChange={(e) => {
                        const next = CRITERIA[e.target.value];
                        const value = row[kind.field] ?? "";
                        setRow(i, { type: e.target.value, [next.field]: next.field === kind.field ? value : "", ...(e.target.value === "obtain" ? { count: 1 } : {}) });
                      }}
                    >
                      {CRITERION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className={error ? "has-error" : ""} title={error}>
                    <span className="icon-input">
                      {kind.icon && row[kind.field] && <ItemIconView refId={row[kind.field]} size={20} />}
                      {choices[kind.field] ? (
                        <TagInput single compact values={row[kind.field] ? [row[kind.field]] : []} options={choices[kind.field]} placeholder={kind.placeholder} onChange={(v) => setRow(i, { ...row, [kind.field]: v[0] ?? "" })} />
                      ) : (
                        <input value={row[kind.field] ?? ""} placeholder={kind.placeholder} onChange={(e) => setRow(i, { ...row, [kind.field]: e.target.value.trim() })} />
                      )}
                    </span>
                  </td>
                  <td>
                    {row.type === "obtain" && (
                      <input
                        type="number"
                        className="count"
                        min={1}
                        title="How many"
                        value={row.count ?? 1}
                        onChange={(e) => setRow(i, { ...row, count: e.target.value === "" ? undefined : Number(e.target.value) })}
                      />
                    )}
                  </td>
                  <td>
                    <button className="icon" title="Remove" onClick={() => setRows(rows.filter((_, n) => n !== i))}>×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <button className="link" onClick={() => setRows([...rows, { type: "obtain", item: "", count: 1 }])}>+ Add a criterion</button>
      {listError && <span className="field-error">{listError}</span>}
      {rowError && <span className="field-error">{rowError}</span>}
      {rows.length > 1 && (
        <SelectField {...p} path={["advancement", "requires"]} label="Done when" options={["all", "any"]} hint={requires === "any" ? "Any one criterion completes it" : "Every criterion has to be met, in any order"} />
      )}
    </Section>
  );
}

// ---- Advancement tree ----

export interface AdvancementNode {
  file: string;
  spec: AdvancementSpec;
}

const COL = 132;
const ROW = 64;
const PAD = 16;
const BOX = 30;

interface Placed {
  key: string;
  label: string;
  icon: string | null;
  frame: string;
  file: string | null;
  x: number;
  y: number;
  parent: string | null;
}

/** Lays out each tab as a tree, left to right: children in a column after their parent, parents centered on their children. */
export function layoutAdvancementTrees(nodes: AdvancementNode[]): { title: string; placed: Placed[]; width: number; height: number }[] {
  const ids = new Set(nodes.map((n) => n.spec.id));
  const children = new Map<string, AdvancementNode[]>();
  const roots: string[] = [];
  const external = new Map<string, string>();
  for (const n of nodes) {
    const parent = n.spec.advancement.parent;
    // A parent from Minecraft, another mod or a typo becomes a grey node at the top of the line.
    const key = !parent ? n.spec.id : ids.has(parent) && parent !== n.spec.id ? parent : `?${parent}`;
    if (key === n.spec.id) roots.push(key);
    else {
      if (key.startsWith("?") && !external.has(key)) {
        external.set(key, parent!);
        roots.push(key);
      }
      children.set(key, [...(children.get(key) ?? []), n]);
    }
  }

  const byId = new Map(nodes.map((n) => [n.spec.id, n]));
  const tabs: { title: string; placed: Placed[]; width: number; height: number }[] = [];
  const done = new Set<string>();
  for (const root of roots) {
    const placed: Placed[] = [];
    let next = 0;
    let depth = 0;
    const place = (key: string, level: number, parent: string | null): number => {
      if (done.has(key)) return next; // a loop; the Problems panel reports it
      done.add(key);
      depth = Math.max(depth, level);
      const kids = children.get(key) ?? [];
      const rows = kids.map((k) => place(k.spec.id, level + 1, key));
      const row = rows.length ? (rows[0] + rows[rows.length - 1]) / 2 : next++;
      const n = byId.get(key);
      placed.push({
        key,
        label: n ? n.spec.name : external.get(key) ?? key,
        icon: n ? n.spec.advancement.icon : null,
        frame: n ? n.spec.advancement.frame : "external",
        file: n ? n.file : null,
        x: PAD + level * COL,
        y: PAD + row * ROW,
        parent,
      });
      return row;
    };
    place(root, 0, null);
    const first = byId.get(root);
    tabs.push({
      title: first ? first.spec.name : `After ${external.get(root)}`,
      placed,
      width: PAD * 2 + depth * COL + COL,
      height: PAD * 2 + Math.max(next, 1) * ROW,
    });
  }
  // Advancements whose parents loop never reach a root; show them on their own so they can still be opened.
  const stray = nodes.filter((n) => !done.has(n.spec.id));
  if (stray.length) {
    tabs.push({
      title: "In a parent loop",
      placed: stray.map((n, i) => ({ key: n.spec.id, label: n.spec.name, icon: n.spec.advancement.icon, frame: n.spec.advancement.frame, file: n.file, x: PAD, y: PAD + i * ROW, parent: null })),
      width: PAD * 2 + COL,
      height: PAD * 2 + stray.length * ROW,
    });
  }
  return tabs;
}

/** Every advancement tab in the project as a tree, like the advancements screen. Clicking an advancement opens it. */
export function AdvancementTree(p: { nodes: AdvancementNode[]; current: string; onOpen: (file: string) => void }) {
  const world = useContext(ItemContext);
  const tabs = layoutAdvancementTrees(p.nodes);
  const currentTab = tabs.findIndex((t) => t.placed.some((n) => n.file === p.current));
  const ordered = currentTab > 0 ? [tabs[currentTab], ...tabs.filter((_, i) => i !== currentTab)] : tabs;
  return (
    <div className="adv-trees">
      {ordered.map((tab, t) => {
        const at = new Map(tab.placed.map((n) => [n.key, n]));
        return (
          <div key={t} className="adv-tab">
            <div className="adv-title">{tab.title}</div>
            <div className="adv-canvas" style={{ width: tab.width, height: tab.height }}>
              <svg width={tab.width} height={tab.height}>
                {tab.placed.map((n) => {
                  const from = n.parent ? at.get(n.parent) : undefined;
                  if (!from) return null;
                  const x1 = from.x + BOX;
                  const y1 = from.y + BOX / 2;
                  const x2 = n.x;
                  const y2 = n.y + BOX / 2;
                  const mid = (x1 + x2) / 2;
                  return <path key={n.key} d={`M${x1},${y1} H${mid} V${y2} H${x2}`} />;
                })}
              </svg>
              {tab.placed.map((n) => (
                <button
                  key={n.key}
                  className={`adv-node frame-${n.frame}${n.file === p.current ? " current" : ""}`}
                  style={{ left: n.x, top: n.y }}
                  disabled={!n.file}
                  title={n.file ? n.label : `${n.label} (from Minecraft or another mod)`}
                  onClick={() => n.file && p.onOpen(n.file)}
                >
                  <span className="adv-box">{n.icon && world ? <ItemIconView refId={n.icon} size={20} /> : "?"}</span>
                  <span className="adv-label">{n.label}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
