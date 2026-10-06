import { useCallback, useEffect, useMemo, useState } from "react";
import { SCHEMAS } from "@modcreator/core/schema";
import { api, type ElementSpec, type Issue, type LoadedProject } from "./api";
import { BlockEditor, ItemEditor, OreEditor, RecipeEditor, newSpec } from "./Editors";
import type { Draft, Errors } from "./forms";
import { OrePreview } from "./OrePreview";
import { Preview } from "./Preview";

type Kind = "block" | "item" | "recipe" | "ore";
const KINDS: { kind: Kind; folder: string; title: string }[] = [
  { kind: "block", folder: "blocks", title: "Blocks" },
  { kind: "item", folder: "items", title: "Items" },
  { kind: "recipe", folder: "recipes", title: "Recipes" },
  { kind: "ore", folder: "worldgen", title: "Ore veins" },
];
const LAST_PROJECT = "modcreator.lastProject";

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
  const schema = SCHEMAS[draft.kind as Kind];
  const result = schema?.safeParse(draft);
  if (result && !result.success) for (const i of result.error.issues) errors.set(i.path.join("."), i.message);
  for (const i of issues) if (i.file === file && i.field && !errors.has(i.field)) errors.set(i.field, i.message);
  return errors;
}

export function App() {
  const [loaded, setLoaded] = useState<LoadedProject | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [log, setLog] = useState("");
  const [panel, setPanel] = useState<"problems" | "log">("problems");
  const [running, setRunning] = useState<string | null>(null);
  const [adding, setAdding] = useState<Kind | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const root = loaded?.root ?? null;

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

  // Reload when specs change on disk (edited in IntelliJ, VS Code or Blockbench), unless there are unsaved edits.
  useEffect(() => {
    return api().onProjectChanged(async (changedRoot) => {
      if (dirty) return;
      const next = await open(changedRoot, true);
      const el = next?.elements.find((e) => e.file === selected);
      if (el) setDraft(el.spec as Draft);
    });
  }, [dirty, open, selected]);

  const select = (file: string, spec: ElementSpec) => {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    setSelected(file);
    setDraft(spec as Draft);
    setDirty(false);
  };

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
    let file = selected;
    const kind = KINDS.find((k) => k.kind === draft.kind);
    // Renaming the id renames the file, so spec/<kind>/<id>.json always matches.
    if (kind && typeof draft.id === "string" && /^[a-z0-9_]+$/.test(draft.id)) {
      const wanted = `spec/${kind.folder}/${draft.id}.json`;
      if (wanted !== selected) {
        await api().saveSpec(root, wanted, draft);
        await api().deleteSpec(root, selected);
        file = wanted;
      }
    }
    if (file === selected) await api().saveSpec(root, file, draft);
    setSelected(file);
    setDirty(false);
    const next = await open(root, true);
    if (next && !next.issues.some((i) => i.severity === "error")) await generate(root);
  }, [root, selected, draft, open, generate]);

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
    if (!root || !/^[a-z0-9_]+$/.test(id)) return;
    const folder = KINDS.find((k) => k.kind === kind)!.folder;
    const file = `spec/${folder}/${id}.json`;
    const spec = newSpec(kind, id);
    await api().saveSpec(root, file, spec);
    setAdding(null);
    await open(root, true);
    setSelected(file);
    setDraft(spec);
    setDirty(false);
  };

  if (!loaded) return <Welcome error={error} onOpen={(dir) => open(dir)} />;

  const issues = loaded.issues;
  const errorCount = issues.filter((i) => i.severity === "error").length;

  return (
    <div className="app">
      <header className="toolbar">
        <strong className="project-name">{loaded.project.name}</strong>
        <span className="muted">{loaded.project.modId} · Minecraft {loaded.project.profile}</span>
        <span className="spacer" />
        <button onClick={async () => { const dir = await api().pickProject(); if (dir) open(dir); }}>Open</button>
        <button onClick={() => { storage(LAST_PROJECT, null); setLoaded(null); }}>Close</button>
        <button onClick={() => { setPanel("log"); generate(loaded.root); }}>Generate</button>
        <button disabled={!!running} onClick={() => runGradle("build")}>Build</button>
        <button disabled={!!running} onClick={() => runGradle("runClient")}>Run client</button>
        {running && <button className="danger" onClick={() => api().stopGradle()}>Stop {running}</button>}
      </header>

      <nav className="sidebar">
        {KINDS.map(({ kind, title }) => (
          <div key={kind} className="group">
            <div className="group-title">
              <span>{title}</span>
              <button className="icon" title={`New ${kind}`} onClick={() => setAdding(kind)}>+</button>
            </div>
            {adding === kind && <NewId onCancel={() => setAdding(null)} onSubmit={(id) => add(kind, id)} />}
            {loaded.elements
              .filter((e) => e.spec.kind === kind)
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
        ))}
        {issues.filter((i) => !loaded.elements.some((e) => e.file === i.file)).length > 0 && (
          <div className="group-title bad">Some spec files could not be read. See Problems.</div>
        )}
      </nav>

      <main className="editor">
        {draft && selected ? (
          <>
            <div className="editor-head">
              <span className="muted">{selected}</span>
              <span className="spacer" />
              <button onClick={() => api().openPath(loaded.root, selected)}>Open file</button>
              <button className="primary" disabled={!dirty} onClick={save}>{dirty ? "Save (Ctrl+S)" : "Saved"}</button>
            </div>
            <div className="editor-body">
              <div className="form">
                {draft.kind === "block" && <BlockEditor draft={draft} errors={errors} onChange={(d) => { setDraft(d); setDirty(true); }} />}
                {draft.kind === "item" && <ItemEditor draft={draft} errors={errors} onChange={(d) => { setDraft(d); setDirty(true); }} />}
                {draft.kind === "ore" && <OreEditor draft={draft} errors={errors} onChange={(d) => { setDraft(d); setDirty(true); }} />}
                {draft.kind === "recipe" && <RecipeEditor draft={draft} errors={errors} onChange={(d) => { setDraft(d); setDirty(true); }} />}
              </div>
              {(draft.kind === "block" || draft.kind === "item") && errors.size === 0 && <Preview root={loaded.root} spec={draft as ElementSpec} version={version} />}
              {draft.kind === "ore" && <OrePreview draft={draft} />}
            </div>
          </>
        ) : (
          <div className="empty">Pick a block, item, recipe or ore vein on the left, or add one with +.</div>
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
              <li key={n} className={i.severity} onClick={() => { const el = loaded.elements.find((e) => e.file === i.file); if (el) select(el.file, el.spec); }}>
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

function NewId({ onSubmit, onCancel }: { onSubmit: (id: string) => void; onCancel: () => void }) {
  const [id, setId] = useState("");
  const valid = /^[a-z0-9_]+$/.test(id);
  return (
    <form className="new-id" onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit(id); }}>
      <input autoFocus placeholder="id, like ruby_ore" value={id} onChange={(e) => setId(e.target.value.toLowerCase().replaceAll(" ", "_"))} onKeyDown={(e) => e.key === "Escape" && onCancel()} />
      <button disabled={!valid}>Add</button>
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
