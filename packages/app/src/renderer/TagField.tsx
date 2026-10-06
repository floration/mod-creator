import { createContext, useContext, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Row, getAt, setAt, type Draft, type Errors } from "./forms";
import type { TagSources } from "./api";
import { registeredItems } from "@modcreator/core/schema";
import { ItemContext } from "./items";

/** What the tag fields need: every known tag, and which namespace is this mod's. */
export interface TagWorld {
  modId: string;
  /** Null until loaded. */
  sources: TagSources | null;
}

export const TagContext = createContext<TagWorld | null>(null);

/** One suggestion in a tag field's dropdown. */
export interface TagOption {
  /** What gets stored, like `minecraft:logs` or `#minecraft:logs`. */
  value: string;
  /** Where it comes from: Minecraft, Fabric, this mod's id. */
  source: string;
  /** A display name, when there is one. */
  name?: string;
  /** A short look at what is in it. */
  detail?: string;
}

const MAX_SHOWN = 60;

/** `minecraft:stone` -> `stone`; other namespaces stay. Tag entries keep their `#`. */
const short = (v: string) => v.replace(/^(#?)minecraft:/, "$1");

function preview(values: string[]): string {
  if (values.length === 0) return "empty";
  const shown = values.slice(0, 4).map(short).join(", ");
  return values.length > 4 ? `${shown} +${values.length - 4} more` : shown;
}

/**
 * Every tag of one registry (`block`, `item`, `entity_type`, `worldgen/biome`...) as dropdown options.
 * A vanilla tag the mod adds to shows the mod's entries too.
 */
export function tagOptions(world: TagWorld | null, type: string, hash: boolean): TagOption[] {
  const sources = world?.sources;
  if (!sources) return [];
  const merged = new Map<string, { values: string[]; name?: string; own: string[] }>();
  for (const list of [sources.minecraft[type], sources.fabric[type]]) {
    for (const e of list ?? []) merged.set(e.id, { values: e.values, name: e.name, own: [] });
  }
  for (const e of sources.mod[type] ?? []) {
    const known = merged.get(e.id);
    if (known) known.own = e.values;
    else merged.set(e.id, { values: [], own: e.values });
  }
  return [...merged].map(([id, t]) => {
    const ns = id.slice(0, id.indexOf(":"));
    const source = ns === "minecraft" ? "Minecraft" : ns === "c" ? "Fabric" : ns;
    const detail = t.values.length && t.own.length ? `${preview(t.values)}; ${world!.modId} adds ${preview(t.own)}` : preview(t.values.length ? t.values : t.own);
    return { value: hash ? `#${id}` : id, source, name: t.name, detail };
  });
}

/** Options for plain ids, like biomes, listed next to the tags. */
export function idOptions(ids: string[], source: string): TagOption[] {
  return ids.map((value) => ({ value, source }));
}

/** This mod's items and Minecraft's, for fields that take an item or an item tag. */
export function useItemOptions(): TagOption[] {
  const items = useContext(ItemContext);
  return useMemo(() => {
    if (!items) return [];
    const own = items.elements.flatMap((spec) => registeredItems(spec).map(([id, name]) => ({ value: `${items.modId}:${id}`, source: items.modId, name })));
    const vanilla = (items.vanilla?.items ?? []).map((e) => ({ value: e.id, source: "Minecraft", name: e.name }));
    return [...own, ...vanilla];
  }, [items]);
}

/**
 * This mod's biomes, enchantments or mobs (by bare id, as specs write them) and Minecraft's biomes or enchantments,
 * for fields that take one of those or a tag of them.
 */
export function useElementOptions(kind: "biome" | "enchantment" | "mob"): TagOption[] {
  const items = useContext(ItemContext);
  const tags = useContext(TagContext);
  return useMemo(() => {
    const own = (items?.elements ?? []).flatMap((e) => (e.kind === kind ? [{ value: e.id, source: items!.modId, name: e.name }] : []));
    const vanilla = kind === "biome" ? tags?.sources?.biomes : kind === "enchantment" ? tags?.sources?.enchantments : [];
    return [...own, ...idOptions(vanilla ?? [], "Minecraft")];
  }, [items, tags, kind]);
}

/** Best matches first: a match at the start of the id's path, then at the start of a word, then anywhere. */
function rank(options: TagOption[], query: string, prefer?: string, modId?: string): TagOption[] {
  const words = query.toLowerCase().replace(/^#/, "").split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    const order = [modId, "Minecraft", "Fabric"];
    const weight = (o: TagOption) => (prefer && o.value.replace(/^#/, "").startsWith(prefer) ? 0 : 1 + (order.indexOf(o.source) + 1 || order.length + 1));
    return [...options].sort((a, b) => weight(a) - weight(b) || a.value.localeCompare(b.value));
  }
  const scored: [TagOption, number][] = [];
  for (const o of options) {
    const id = o.value.toLowerCase().replace(/^#/, "");
    const path = id.slice(id.indexOf(":") + 1);
    const name = o.name?.toLowerCase() ?? "";
    let score = 0;
    for (const w of words) {
      if (path.startsWith(w) || id.startsWith(w)) score += 0;
      else if (new RegExp(`[/_:]${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(id)) score += 1;
      else if (id.includes(w)) score += 2;
      else if (name.includes(w)) score += 3;
      else {
        score = -1;
        break;
      }
    }
    if (score >= 0) scored.push([o, score]);
  }
  const order = (o: TagOption) => [modId, "Minecraft", "Fabric"].indexOf(o.source) + 1 || 4;
  return scored
    .sort((a, b) => a[1] - b[1] || order(a[0]) - order(b[0]) || a[0].value.length - b[0].value.length || a[0].value.localeCompare(b[0].value))
    .map(([o]) => o);
}

/** Whether a stored value is a known tag, a new tag of this mod's, or a typo. */
function status(world: TagWorld | null, options: TagOption[], value: string): { kind: "known" | "new" | "unknown"; title: string } {
  const found = options.find((o) => o.value === value);
  if (found) return { kind: "known", title: `${found.name ? `${found.name}: ` : ""}${found.detail ?? found.source}` };
  const bare = value.replace(/^#/, "");
  const ns = bare.includes(":") ? bare.slice(0, bare.indexOf(":")) : world?.modId;
  if (ns === world?.modId) return { kind: "new", title: `A new ${world?.modId} tag. Generating creates it.` };
  const sources = world?.sources;
  const loaded = ns === "minecraft" ? Object.keys(sources?.minecraft ?? {}).length > 0 : ns === "c" ? Object.keys(sources?.fabric ?? {}).length > 0 : false;
  return loaded
    ? { kind: "unknown", title: `${ns === "c" ? "Fabric" : "Minecraft"} has no tag called ${bare}. Check the spelling.` }
    : { kind: "known", title: `From ${ns}; Mod Creator can't check it` };
}

interface InputProps {
  values: string[];
  onChange: (values: string[]) => void;
  options: TagOption[];
  /** One value instead of a list. */
  single?: boolean;
  placeholder?: string;
  /** Ids starting with this go first while nothing is typed, like `minecraft:enchantable/`. */
  prefer?: string;
  /** Stored values start with `#` (true) or not (false). Typed values get fixed to match. Mixed lists leave them alone. */
  hash?: boolean;
  compact?: boolean;
}

/** A text box with a dropdown of matching tags. Lists show their tags as chips; Backspace removes the last one. */
export function TagInput(p: InputProps) {
  const world = useContext(TagContext);
  const [text, setText] = useState(p.single ? p.values[0] ?? "" : "");
  const [open, setOpen] = useState(false);
  // Until the person types, a single field's dropdown lists everything rather than filtering by the current value.
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [up, setUp] = useState(false);
  // Keep a single field's text in step with the draft when something else changes it.
  const stored = p.values[0] ?? "";
  const [lastStored, setLastStored] = useState(stored);
  if (p.single && stored !== lastStored) {
    setLastStored(stored);
    setText(stored);
  }

  const query = p.single && !typed ? "" : text;
  const matches = useMemo(() => {
    const taken = new Set(p.single ? [] : p.values);
    return rank(p.options.filter((o) => !taken.has(o.value)), query, p.prefer, world?.modId);
  }, [p.options, p.values, p.single, query, p.prefer, world?.modId]);
  const shown = matches.slice(0, MAX_SHOWN);

  const normalize = (raw: string) => {
    const v = raw.trim();
    if (!v || p.hash === undefined) return v;
    return p.hash ? (v.startsWith("#") ? v : `#${v}`) : v.replace(/^#/, "");
  };

  const commit = (raw: string) => {
    const v = normalize(raw);
    setTyped(false);
    if (p.single) {
      setLastStored(v);
      setText(v);
      p.onChange(v ? [v] : []);
    } else {
      setText("");
      if (v && !p.values.includes(v)) p.onChange([...p.values, v]);
    }
    setActive(0);
  };

  /** Open the dropdown, above the box when the scrolling form has more room there than below. */
  const show = () => {
    setOpen(true);
    const box = input.current?.parentElement;
    if (!box) return;
    let clip: HTMLElement | null = box.parentElement;
    while (clip && !/(auto|scroll|hidden)/.test(getComputedStyle(clip).overflowY)) clip = clip.parentElement;
    const r = box.getBoundingClientRect();
    const area = clip?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
    const below = area.bottom - r.bottom;
    setUp(below < 220 && r.top - area.top > below);
  };

  const pick = (o: TagOption) => {
    commit(o.value);
    if (p.single) setOpen(false);
    input.current?.focus();
  };

  const move = (to: number) => {
    const next = Math.max(0, Math.min(shown.length - 1, to));
    setActive(next);
    list.current?.children[next]?.scrollIntoView({ block: "nearest" });
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) show();
      else move(active + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(active - 1);
    } else if (e.key === "Enter" || (e.key === "Tab" && open && typed && text.trim() && shown.length > 0)) {
      e.preventDefault();
      if (open && shown[active] && (typed || !text.trim())) pick(shown[active]);
      else commit(text);
    } else if (e.key === "," && !p.single) {
      e.preventDefault();
      commit(text);
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && !p.single && text === "" && p.values.length) {
      p.onChange(p.values.slice(0, -1));
    }
  };

  return (
    <div className={`tag-input${p.compact ? " compact" : ""}`}>
      <div className="tag-box" onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); input.current?.focus(); } }}>
        {!p.single && p.values.map((v, i) => {
          const s = status(world, p.options, v);
          return (
            <span key={v} className={`tag-chip ${s.kind}`} title={s.title}>
              {v}
              <button type="button" className="tag-remove" title="Remove" onClick={(e) => { e.preventDefault(); p.onChange(p.values.filter((_, n) => n !== i)); }}>×</button>
            </span>
          );
        })}
        <input
          ref={input}
          value={text}
          className={p.single && text && status(world, p.options, normalize(text)).kind === "unknown" ? "tag-unknown" : undefined}
          title={p.single && text ? status(world, p.options, normalize(text)).title : undefined}
          placeholder={p.values.length && !p.single ? "" : p.placeholder}
          onChange={(e) => { setText(e.target.value); setTyped(true); if (!open) show(); setActive(0); }}
          onFocus={() => { setTyped(false); show(); }}
          onBlur={() => { setOpen(false); if (p.single ? normalize(text) !== (p.values[0] ?? "") : text.trim()) commit(text); }}
          onKeyDown={onKey}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      {open && (
        <div className={`tag-menu${up ? " up" : ""}`} ref={list} onMouseDown={(e) => e.preventDefault()}>
          {shown.map((o, i) => (
            <div key={o.value} className={`tag-option${i === active ? " active" : ""}`} onMouseEnter={() => setActive(i)} onClick={() => pick(o)}>
              <span className="tag-option-id">{o.value}{o.name && <span className="muted"> {o.name}</span>}</span>
              <span className="tag-option-source">{o.source}</span>
              {o.detail && <span className="tag-option-detail">{o.detail}</span>}
            </div>
          ))}
          {shown.length === 0 && (
            <div className="tag-empty">
              {p.options.length === 0
                ? world?.sources
                  ? "No tags of this kind found. Type one; Minecraft's list needs the Minecraft jar (see the recipe editor)."
                  : "Loading tags..."
                : text.trim()
                  ? `No tag matches. Enter keeps "${normalize(text)}"${normalize(text).replace(/^#/, "").includes(":") ? "" : ` as a new ${world?.modId} tag`}.`
                  : "Every tag is already added."}
            </div>
          )}
          {matches.length > MAX_SHOWN && <div className="tag-empty">{matches.length - MAX_SHOWN} more. Keep typing to narrow it down.</div>}
        </div>
      )}
    </div>
  );
}

interface FieldProps {
  draft: Draft;
  path: string[];
  errors: Errors;
  onChange: (draft: Draft) => void;
  label: string;
  hint?: string;
  placeholder?: string;
  /** Registry folder the tags belong to: `block`, `item`, `entity_type`, `worldgen/biome`... */
  type: string;
  /** Stored with a leading `#`. Fields that also take plain ids (a biome or a biome tag) need it. */
  hash?: boolean;
  /** Plain ids offered next to the tags. */
  extra?: TagOption[];
  prefer?: string;
}

function useOptions(p: Pick<FieldProps, "type" | "hash" | "extra">) {
  const world = useContext(TagContext);
  return useMemo(() => [...(p.extra ?? []), ...tagOptions(world, p.type, !!p.hash)], [world, p.type, p.hash, p.extra]);
}

/** First error for the list or any of its entries. */
function listError(errors: Errors, path: string[]) {
  const key = path.join(".");
  return errors.get(key) ?? [...errors].find(([k]) => k.startsWith(`${key}.`))?.[1];
}

/** A list of tags, stored as an array, with autofill from Minecraft's, Fabric's and the mod's own tags. */
export function TagListField(p: FieldProps) {
  const options = useOptions(p);
  const values: string[] = getAt(p.draft, p.path) ?? [];
  return (
    <Row label={p.label} hint={p.hint} error={listError(p.errors, p.path)}>
      <TagInput values={values} options={options} placeholder={p.placeholder} prefer={p.prefer} hash={p.extra ? undefined : !!p.hash} onChange={(next) => p.onChange(setAt(p.draft, p.path, next))} />
    </Row>
  );
}

/** One tag (or, with `extra`, one id), with the same autofill. */
export function TagTextField(p: FieldProps & { optional?: boolean }) {
  const options = useOptions(p);
  const value: string | undefined = getAt(p.draft, p.path);
  return (
    <Row label={p.label} hint={p.hint} error={p.errors.get(p.path.join("."))}>
      <TagInput
        single
        values={value ? [value] : []}
        options={options}
        placeholder={p.placeholder}
        prefer={p.prefer}
        hash={p.extra ? undefined : !!p.hash}
        onChange={(next) => p.onChange(setAt(p.draft, p.path, next[0] ?? (p.optional ? undefined : "")))}
      />
    </Row>
  );
}

/** Which tag registry an element's own `tags` list fills, by its kind. */
export function elementTagType(kind: string): string | null {
  switch (kind) {
    case "block":
    case "plant":
      return "block";
    case "item":
    case "tool":
    case "armor":
      return "item";
    case "biome":
      return "worldgen/biome";
    default:
      return null;
  }
}
