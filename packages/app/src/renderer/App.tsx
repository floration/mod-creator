import { useCallback, useEffect, useMemo, useState } from "react";
import { AdvancementSpecSchema, ProjectSchema, SCHEMAS } from "@modcreator/core/schema";
import { AdvancementEditor, AdvancementTree, type AdvancementNode } from "./AdvancementEditor";
import { StructureEditor, StructurePreview } from "./StructureEditor";
import { SoundEditor } from "./SoundEditor";
import { EffectEditor } from "./EffectEditor";
import { EnchantmentEditor } from "./EnchantmentEditor";
import { api, type ElementSpec, type Issue, type LoadedProject, type TagSources, type VanillaCatalog } from "./api";
import { ArmorEditor, BiomeEditor, BlockEditor, ItemEditor, MobEditor, OreEditor, PlantEditor, RecipeEditor, ToolEditor, TreeEditor, newSpec, type Kind } from "./Editors";
import { BiomePreview } from "./BiomePreview";
import { getAt, type Draft, type Errors } from "./forms";
import { ItemContext, type ItemWorld } from "./items";
import { OrePreview } from "./OrePreview";
import { Preview } from "./Preview";
import { ProjectEditor } from "./ProjectEditor";
import { TextureContext, type TextureWorld } from "./TextureField";
import { TagContext, type TagWorld } from "./TagField";

const KINDS: { kind: Kind; folder: string; title: string }[] = [
  { kind: "block", folder: "blocks", title: "Blocks" },
  { kind: "item", folder: "items", title: "Items" },
  { kind: "tool", folder: "tools", title: "Tools and weapons" },
  { kind: "armor", folder: "armor", title: "Armor" },
  { kind: "recipe", folder: "recipes", title: "Recipes" },
  { kind: "ore", folder: "worldgen", title: "Ore veins" },
  { kind: "tree", folder: "trees", title: "Trees" },
  { kind: "plant", folder: "plants", title: "Plants" },
  { kind: "mob", folder: "mobs", title: "Mobs" },
  { kind: "biome", folder: "biomes", title: "Biomes" },
  { kind: "structure", folder: "structures", title: "Structures" },
  { kind: "sound", folder: "sounds", title: "Sounds" },
  { kind: "effect", folder: "effects", title: "Effects" },
  { kind: "enchantment", folder: "enchantments", title: "Enchantments" },
  { kind: "advancement", folder: "advancements", title: "Advancements" },
];

const EDITORS = { block: BlockEditor, item: ItemEditor, ore: OreEditor, tool: ToolEditor, armor: ArmorEditor, tree: TreeEditor, plant: PlantEditor, mob: MobEditor, biome: BiomeEditor, structure: StructureEditor, sound: SoundEditor, effect: EffectEditor, enchantment: EnchantmentEditor };
const PREVIEWED = new Set(["block", "item", "tool", "armor", "tree", "plant", "mob"]);
const LAST_PROJECT = "modcreator.lastProject";
/** The project settings page edits this file like any spec. */
const PROJECT_FILE = "modcreator.json";

/** The open file's content as loaded: a spec, or the project settings. */
function specAt(loaded: LoadedProject, file: string | null): unknown {
  if (file === PROJECT_FILE) return loaded.project;
  return loaded.elements.find((e) => e.file === file)?.spec;
}

function storage(key: string, value?: string | null): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable; remembering the last project is only a convenience.
  }
  return null;
}

/** Field errors for the open draft: schema errors first, then project-level issues for the same file. */
function draftErrors(draft: Draft | null, file: string | null, issues: Issue[]): Errors {
  const errors: Errors = new Map();
  if (!draft) return errors;
  const schema = file === PROJECT_FILE ? ProjectSchema : SCHEMAS[draft.kind as Kind];
  const result = schema?.safeParse(draft);
  if (result && !result.success) for (const i of result.error.issues) errors.set(i.path.join("."), i.message);
  for (const i of issues) if (i.file === file && i.field && !errors.has(i.field)) errors.set(i.field, i.message);
  return errors;
}

/** The project's advancements for the advancement tree, with the open one as currently edited (when it still parses). */
function advancementNodes(loaded: LoadedProject, selected: string, draft: Draft): AdvancementNode[] {
  const nodes = loaded.elements.flatMap((e) => (e.spec.kind === "advancement" ? [{ file: e.file, spec: e.spec }] : []));
  const parsed = AdvancementSpecSchema.safeParse(draft);
  if (!parsed.success) return nodes;
  const edited = { file: selected, spec: parsed.data };
  return nodes.some((n) => n.file === selected) ? nodes.map((n) => (n.file === selected ? edited : n)) : [...nodes, edited];
}

/** A spec as JSON text, for telling whether the file on disk changed since the form was loaded. */
const snapshot = (spec: unknown) => (spec === undefined ? null : JSON.stringify(spec));

/** What happened on disk to the open file while the form had unsaved edits. */
type Conflict = "changed" | "missing";

export function App() {
  const [loaded, setLoaded] = useState<LoadedProject | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  /** The open file as it was on disk when the form was loaded or last saved. */
  const [base, setBase] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [log, setLog] = useState("");
  const [panel, setPanel] = useState<"problems" | "log">("problems");
  const [running, setRunning] = useState<string | null>(null);
  const [adding, setAdding] = useState<Kind | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const [search, setSearch] = useState("");
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [vanilla, setVanilla] = useState<VanillaCatalog | null>(null);

  const root = loaded?.root ?? null;
  const mcVersion = loaded?.project.profile ?? null;

  // Minecraft's item names and icons, for the recipe editor's slots.
  useEffect(() => {
    if (!mcVersion) return;
    api().loadVanilla(mcVersion).then(setVanilla, () => setVanilla(null));
  }, [mcVersion]);

  // Every tag the tag fields offer. The mod's own change on each reload; Minecraft's when another jar is picked.
  const [tagSources, setTagSources] = useState<TagSources | null>(null);
  useEffect(() => {
    if (!root) return;
    let live = true;
    api().tags(root).then((t) => live && setTagSources(t), () => live && setTagSources(null));
    return () => {
      live = false;
    };
  }, [root, loaded, vanilla]);
  const tagWorld = useMemo<TagWorld | null>(() => loaded && { modId: loaded.project.modId, sources: tagSources }, [loaded, tagSources]);

  const world = useMemo<ItemWorld | null>(
    () =>
      loaded && {
        root: loaded.root,
        modId: loaded.project.modId,
        version: loaded.project.profile,
        elements: loaded.elements.map((e) => e.spec),
        vanilla,
        pickJar: async () => {
          const next = await api().pickMinecraftJar(loaded.project.profile);
          if (next) setVanilla(next);
        },
      },
    [loaded, vanilla],
  );

  const textures = useMemo<TextureWorld | null>(
    () => loaded && { root: loaded.root, version, saved: () => setVersion((v) => v + 1) },
    [loaded, version],
  );

  const open = useCallback(async (dir: string, keepSelection = false) => {
    try {
      const next = await api().loadProject(dir);
      setLoaded(next);
      setError(null);
      setVersion((v) => v + 1);
      storage(LAST_PROJECT, next.root);
      if (!keepSelection) {
        setSelected(null);
        setDraft(null);
        setDirty(false);
        setBase(null);
        setConflict(null);
      }
      return next;
    } catch (e) {
      setError((e as Error).message);
      storage(LAST_PROJECT, null);
      return null;
    }
  }, []);

  useEffect(() => {
    api().initialProject().then((initial) => {
      const dir = initial ?? storage(LAST_PROJECT);
      if (dir) open(dir);
    });
    const offLog = api().onGradleLog((text) => setLog((l) => (l + text).slice(-200_000)));
    return offLog;
  }, [open]);

  // Reload when specs change on disk (edited in IntelliJ, VS Code or Blockbench). Unsaved edits to the open
  // file are kept, and if that file changed underneath them the editor asks which version to keep.
  useEffect(() => {
    return api().onProjectChanged(async (changedRoot) => {
      const next = await open(changedRoot, true);
      if (!next || !selected) return;
      const found = specAt(next, selected);
      const el = found === undefined ? undefined : { spec: found };
      if (!dirty) {
        if (el) {
          setDraft(el.spec as Draft);
          setBase(snapshot(el.spec));
        } else if (!next.issues.some((i) => i.file === selected)) {
          // Deleted outside the app: nothing left to show.
          setSelected(null);
          setDraft(null);
          setBase(null);
        }
        return;
      }
      const onDisk = snapshot(el?.spec);
      if (onDisk === base) return;
      if (!el) setConflict("missing");
      else if (onDisk === snapshot(draft)) {
        // Someone saved exactly what the form holds: nothing left to save.
        setBase(onDisk);
        setDirty(false);
        setConflict(null);
      } else setConflict("changed");
    });
  }, [dirty, open, selected, base, draft]);

  /** True when there is nothing unsaved, or the user agrees to throw it away. */
  const discardOk = useCallback(() => !dirty || confirm("Discard unsaved changes?"), [dirty]);

  const select = (file: string, spec: unknown) => {
    if (!discardOk()) return;
    setSelected(file);
    setDraft(spec as Draft);
    setDirty(false);
    setBase(snapshot(spec));
    setConflict(null);
  };

  /** Resolve a conflict: keep the form's edits (Save will overwrite the file), or load the file from disk. */
  const keepMine = () => {
    setBase(snapshot(loaded && specAt(loaded, selected)));
    setConflict(null);
  };
  const takeTheirs = () => {
    const spec = loaded ? specAt(loaded, selected) : undefined;
    if (spec !== undefined) {
      setDraft(spec as Draft);
      setBase(snapshot(spec));
    } else {
      setSelected(null);
      setDraft(null);
      setBase(null);
    }
    setDirty(false);
    setConflict(null);
  };

  // Closing the window with unsaved edits asks first (the main process shows the question).
  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  const errors = useMemo(() => draftErrors(draft, selected, loaded?.issues ?? []), [draft, selected, loaded]);

  const generate = useCallback(async (dir: string) => {
    const result = await api().generate(dir);
    const lines = result.ok
      ? [`Generated ${result.written.length} files into src/generated.`, ...result.overridden.map((f) => `  kept your src/main/resources/${f}`), ...result.created.map((f) => `  created starter class ${f}`)]
      : ["Generate stopped: fix the problems first."];
    setLog((l) => l + lines.join("\n") + "\n");
    if (!result.ok) setPanel("problems");
    return result.ok;
  }, []);

  const save = useCallback(async () => {
    if (!root || !selected || !draft) return;
    if (conflict === "changed" && !confirm("This file was changed outside Mod Creator. Save over those changes?")) return;
    // A broken modcreator.json would stop the project from opening at all, so it only saves when valid.
    if (selected === PROJECT_FILE && !ProjectSchema.safeParse(draft).success) {
      alert("Fix the highlighted settings first.");
      return;
    }
    let file = selected;
    const kind = KINDS.find((k) => k.kind === draft.kind);
    // Renaming the id renames the file, so spec/<kind>/<id>.json always matches.
    if (kind && typeof draft.id === "string" && /^[a-z0-9_]+$/.test(draft.id)) {
      const wanted = `spec/${kind.folder}/${draft.id}.json`;
      if (wanted !== selected) {
        // Other specs that point at the old id follow it to the new one.
        const edits = await api().renameEdits(root, selected, draft as ElementSpec);
        await api().saveSpec(root, wanted, draft);
        await api().deleteSpec(root, selected);
        for (const edit of edits) await api().saveSpec(root, edit.file, edit.spec);
        if (edits.length > 0) {
          setLog((l) => l + [`Renamed ${selected} to ${wanted}. Updated references in:`, ...edits.map((e) => `  ${e.file} (${e.fields.join(", ")})`)].join("\n") + "\n");
        }
        file = wanted;
      }
    }
    if (file === selected) await api().saveSpec(root, file, draft);
    setSelected(file);
    setDirty(false);
    setConflict(null);
    const next = await open(root, true);
    setBase(snapshot(next ? specAt(next, file) : undefined));
    if (next && !next.issues.some((i) => i.severity === "error")) await generate(root);
  }, [root, selected, draft, conflict, open, generate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  /** Delete the open element after saying which other specs point at it. */
  const remove = async () => {
    if (!root || !selected || !draft) return;
    const label = "name" in draft && typeof draft.name === "string" ? draft.name : selected;
    const broken = await api().dependents(root, selected);
    const message = broken.length
      ? `Delete ${label}? These still point at it and will show errors until you change them:\n\n${broken.map((i) => `${i.file} (${i.field})`).join("\n")}`
      : `Delete ${label}?${dirty ? " Your unsaved changes are lost too." : ""}`;
    if (!confirm(message)) return;
    await api().deleteSpec(root, selected);
    setLog((l) => l + `Deleted ${selected}.\n`);
    await open(root);
  };

  /** Copy the open element, as saved, under a new id. */
  const duplicate = async (id: string) => {
    if (!root || !selected || !loaded || !/^[a-z0-9_]+$/.test(id) || !discardOk()) return;
    const source = loaded.elements.find((e) => e.file === selected);
    const kind = source && KINDS.find((k) => k.kind === source.spec.kind);
    if (!source || !kind) return;
    const file = `spec/${kind.folder}/${id}.json`;
    if (loaded.elements.some((e) => e.file === file) && !confirm(`${file} already exists. Replace it?`)) return;
    const spec = { ...structuredClone(source.spec), id } as ElementSpec;
    if ("name" in spec && typeof spec.name === "string") spec.name = `${spec.name} copy`;
    await api().saveSpec(root, file, spec);
    setDuplicating(false);
    const next = await open(root, true);
    const copy = next?.elements.find((e) => e.file === file)?.spec ?? spec;
    setSelected(file);
    setDraft(copy as Draft);
    setDirty(false);
    setBase(snapshot(copy));
    setConflict(null);
  };

  const runGradle = async (task: "build" | "runClient") => {
    if (!root) return;
    setPanel("log");
    if (!(await generate(root))) return;
    setRunning(task);
    try {
      await api().runGradle(root, task);
    } catch (e) {
      setLog((l) => l + `${(e as Error).message}\n`);
    } finally {
      setRunning(null);
    }
  };

  const add = async (kind: Kind, id: string) => {
    if (!root || !/^[a-z0-9_]+$/.test(id) || !discardOk()) return;
    const folder = KINDS.find((k) => k.kind === kind)!.folder;
    const file = `spec/${folder}/${id}.json`;
    const spec = newSpec(kind, id);
    await api().saveSpec(root, file, spec);
    setAdding(null);
    const next = await open(root, true);
    setSelected(file);
    setDraft(spec);
    setDirty(false);
    setBase(snapshot(next?.elements.find((e) => e.file === file)?.spec));
    setConflict(null);
  };

  if (!loaded) return <Welcome error={error} onOpen={(dir) => open(dir)} />;

  const issues = loaded.issues;
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const query = search.trim().toLowerCase();
  const matches = (e: LoadedProject["elements"][number]) =>
    !query || [e.spec.id, "name" in e.spec ? e.spec.name : "", e.file].some((t) => t.toLowerCase().includes(query));

  return (
    <div className="app">
      <header className="toolbar">
        <strong className="project-name">{loaded.project.name}</strong>
        <span className="muted">{loaded.project.modId} {loaded.project.version} · Minecraft {loaded.project.profile}</span>
        <button className={selected === PROJECT_FILE ? "active" : ""} onClick={() => select(PROJECT_FILE, loaded.project)}>Settings</button>
        <span className="spacer" />
        <button onClick={async () => { if (!discardOk()) return; const dir = await api().pickProject(); if (dir) open(dir); }}>Open</button>
        <button onClick={() => { if (!discardOk()) return; storage(LAST_PROJECT, null); setLoaded(null); setSelected(null); setDraft(null); setDirty(false); setConflict(null); }}>Close</button>
        <button onClick={() => { setPanel("log"); generate(loaded.root); }}>Generate</button>
        <button disabled={!!running} onClick={() => runGradle("build")}>Build</button>
        <button disabled={!!running} onClick={() => runGradle("runClient")}>Run client</button>
        {running && <button className="danger" onClick={() => api().stopGradle()}>Stop {running}</button>}
      </header>

      <nav className="sidebar">
        <input
          className="search"
          type="search"
          placeholder="Search by name or id"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setSearch("")}
        />
        {KINDS.map(({ kind, title }) => {
          const all = loaded.elements.filter((e) => e.spec.kind === kind);
          const shown = all.filter(matches);
          if (query && shown.length === 0) return null;
          return (
          <div key={kind} className="group">
            <div className="group-title">
              <span>{title}</span>
              {all.length > 0 && <span className="count">{query ? `${shown.length}/${all.length}` : all.length}</span>}
              <span className="spacer" />
              <button className="icon" title={`New ${kind}`} onClick={() => setAdding(kind)}>+</button>
            </div>
            {adding === kind && <NewId onCancel={() => setAdding(null)} onSubmit={(id) => add(kind, id)} />}
            {shown
              .map((e) => {
                const bad = issues.some((i) => i.file === e.file && i.severity === "error");
                return (
                  <button key={e.file} className={`item${e.file === selected ? " active" : ""}${bad ? " bad" : ""}`} onClick={() => select(e.file, e.spec)}>
                    <span>{"name" in e.spec ? e.spec.name : e.spec.id}</span>
                    {"name" in e.spec && <span className="muted">{e.spec.id}</span>}
                  </button>
                );
              })}
          </div>
          );
        })}
        {query && !loaded.elements.some(matches) && <div className="muted search-empty">Nothing matches "{search.trim()}".</div>}
        {issues.filter((i) => !loaded.elements.some((e) => e.file === i.file)).length > 0 && (
          <div className="group-title bad">Some spec files could not be read. See Problems.</div>
        )}
      </nav>

      <main className="editor">
        {draft && selected ? (
          <TextureContext.Provider value={textures}>
          <TagContext.Provider value={tagWorld}>
            <div className="editor-head">
              <span className="muted">{selected}</span>
              <span className="spacer" />
              {selected !== PROJECT_FILE && (duplicating ? (
                <NewId placeholder="id for the copy" label="Duplicate" onCancel={() => setDuplicating(false)} onSubmit={duplicate} />
              ) : (
                <button onClick={() => setDuplicating(true)}>Duplicate</button>
              ))}
              {selected !== PROJECT_FILE && <button onClick={remove}>Delete</button>}
              <button onClick={() => api().openPath(loaded.root, selected)}>Open file</button>
              <button className="primary" disabled={!dirty} onClick={save}>{dirty ? "Save (Ctrl+S)" : "Saved"}</button>
            </div>
            {conflict && (
              <div className="conflict">
                <span>
                  {conflict === "changed"
                    ? "This file was changed outside Mod Creator while you had unsaved edits."
                    : "This file was deleted or can no longer be read (see Problems) while you had unsaved edits."}
                </span>
                <span className="spacer" />
                <button onClick={keepMine}>{conflict === "changed" ? "Keep my edits" : "Keep my edits (Save recreates it)"}</button>
                <button onClick={takeTheirs}>{conflict === "changed" ? "Load the file's version" : "Discard my edits"}</button>
              </div>
            )}
            <div className="editor-body">
              <div className={`form${["recipe", "sound", "effect", "enchantment"].includes(draft.kind) ? " wide" : ""}`}>
                {selected === PROJECT_FILE && <ProjectEditor draft={draft} errors={errors} onChange={(d) => { setDraft(d); setDirty(true); }} />}
                {selected !== PROJECT_FILE && draft.kind in EDITORS && (() => {
                  const Editor = EDITORS[draft.kind as keyof typeof EDITORS];
                  return (
                    <ItemContext.Provider value={world}>
                      <Editor draft={draft} errors={errors} onChange={(d) => { setDraft(d); setDirty(true); }} />
                    </ItemContext.Provider>
                  );
                })()}
                {draft.kind === "advancement" && (
                  <ItemContext.Provider value={world}>
                    <AdvancementEditor
                      draft={draft}
                      errors={errors}
                      siblings={loaded.elements.flatMap((e) => (e.spec.kind === "advancement" && e.file !== selected ? [e.spec.id] : []))}
                      onChange={(d) => { setDraft(d); setDirty(true); }}
                    />
                  </ItemContext.Provider>
                )}
                {draft.kind === "recipe" && (
                  <ItemContext.Provider value={world}>
                    <RecipeEditor key={selected} draft={draft} errors={errors} onChange={(d) => { setDraft(d); setDirty(true); }} />
                  </ItemContext.Provider>
                )}
              </div>
              {PREVIEWED.has(draft.kind) && errors.size === 0 && <Preview root={loaded.root} spec={draft as ElementSpec} version={version} />}
              {draft.kind === "ore" && <OrePreview draft={draft} />}
              {draft.kind === "biome" && <BiomePreview draft={draft} />}
              {draft.kind === "structure" && (
                <ItemContext.Provider value={world}>
                  <StructurePreview file={getAt(draft, ["structure", "file"]) ?? ""} version={version} />
                </ItemContext.Provider>
              )}
              {draft.kind === "advancement" && (
                <ItemContext.Provider value={world}>
                  <AdvancementTree nodes={advancementNodes(loaded, selected, draft)} current={selected} onOpen={(file) => select(file, specAt(loaded, file))} />
                </ItemContext.Provider>
              )}
            </div>
          </TagContext.Provider>
          </TextureContext.Provider>
        ) : (
          <div className="empty">Pick something on the left, or add one with +.</div>
        )}
      </main>

      <section className="panel">
        <div className="tabs">
          <button className={panel === "problems" ? "active" : ""} onClick={() => setPanel("problems")}>
            Problems {errorCount > 0 && <span className="badge">{errorCount}</span>}
          </button>
          <button className={panel === "log" ? "active" : ""} onClick={() => setPanel("log")}>Output</button>
          <span className="spacer" />
          {panel === "log" && <button className="link" onClick={() => setLog("")}>Clear</button>}
        </div>
        {panel === "problems" ? (
          <ul className="problems">
            {issues.length === 0 && <li className="muted">No problems.</li>}
            {issues.map((i, n) => (
              <li key={n} className={i.severity} onClick={() => { const spec = specAt(loaded, i.file); if (spec !== undefined) select(i.file, spec); }}>
                <span className="sev">{i.severity}</span> {i.file}
                {i.field && <span className="muted"> · {i.field}</span>}: {i.message}
              </li>
            ))}
          </ul>
        ) : (
          <pre className="log">{log || "Generate, Build and Run client output shows here."}</pre>
        )}
      </section>
    </div>
  );
}

function NewId({ onSubmit, onCancel, placeholder = "id, like ruby_ore", label = "Add" }: { onSubmit: (id: string) => void; onCancel: () => void; placeholder?: string; label?: string }) {
  const [id, setId] = useState("");
  const valid = /^[a-z0-9_]+$/.test(id);
  return (
    <form className="new-id" onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit(id); }}>
      <input autoFocus placeholder={placeholder} value={id} onChange={(e) => setId(e.target.value.toLowerCase().replaceAll(" ", "_"))} onKeyDown={(e) => e.key === "Escape" && onCancel()} />
      <button disabled={!valid}>{label}</button>
    </form>
  );
}

function Welcome({ error, onOpen }: { error: string | null; onOpen: (dir: string) => void }) {
  const [form, setForm] = useState({ name: "", modId: "", package: "" });
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const slug = form.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

  const create = async () => {
    const modId = form.modId || slug;
    const pkg = form.package || `com.example.${modId.replaceAll("-", "_")}`;
    const parent = await api().pickNewFolder();
    if (!parent) return;
    setCreating(true);
    try {
      const dir = await api().createProject(`${parent}/${modId}`, { name: form.name, modId, package: pkg });
      onOpen(dir);
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="welcome">
      <h1>Mod Creator</h1>
      <p className="muted">Build Minecraft 26.3 Fabric mods from forms. Everything is saved as plain files you can also edit by hand.</p>
      {error && <p className="bad">{error}</p>}
      <div className="welcome-cards">
        <div className="card">
          <h2>Open a project</h2>
          <p className="muted">A folder with a modcreator.json, like examples/ruby.</p>
          <button className="primary" onClick={async () => { const dir = await api().pickProject(); if (dir) onOpen(dir); }}>Open folder</button>
        </div>
        <div className="card">
          <h2>New mod</h2>
          <label className="field"><span className="field-label">Name</span><input value={form.name} placeholder="Ruby" onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field"><span className="field-label">Mod id</span><input value={form.modId} placeholder={slug || "ruby"} onChange={(e) => setForm({ ...form, modId: e.target.value })} /></label>
          <label className="field"><span className="field-label">Java package</span><input value={form.package} placeholder={`com.example.${slug || "ruby"}`} onChange={(e) => setForm({ ...form, package: e.target.value })} /></label>
          {problem && <p className="bad">{problem}</p>}
          <button className="primary" disabled={!form.name || creating} onClick={create}>Choose a parent folder and create</button>
          <p className="field-hint">Suggested parent folder: Documents/MinecraftMods</p>
        </div>
      </div>
    </div>
  );
}
