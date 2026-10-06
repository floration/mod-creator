import { useState } from "react";
import { suggestedVersion } from "@modcreator/core/modrinth";
import { api, type ModrinthProject, type ModrinthVersion } from "./api";
import { ListField, Section, TextField, getAt, setAt, type Draft, type Errors } from "./forms";

interface Dependency {
  slug: string;
  version: string;
  required?: boolean;
}

/** modcreator.json: the mod's name, version, description, authors and Modrinth dependencies. */
export function ProjectEditor(p: { draft: Draft; errors: Errors; onChange: (draft: Draft) => void }) {
  const f = { draft: p.draft, errors: p.errors, onChange: p.onChange };
  const minecraft: string = getAt(p.draft, ["profile"]) ?? "26.3";
  const deps: Dependency[] = getAt(p.draft, ["dependencies"]) ?? [];
  const setDeps = (next: Dependency[]) => p.onChange(setAt(p.draft, ["dependencies"], next));

  return (
    <>
      <Section title="Mod">
        <TextField {...f} path={["name"]} label="Name" hint="Shown in the game's mod list" />
        <TextField {...f} path={["version"]} label="Version" hint="Like 0.1.0. Goes in the jar's name and fabric.mod.json on the next build" />
        <TextField {...f} path={["description"]} label="Description" />
        <ListField {...f} path={["authors"]} label="Authors" placeholder="q, a friend" hint="Separate names with commas" />
        <span className="field-hint">
          Mod id {getAt(p.draft, ["modId"])}, Java package {getAt(p.draft, ["package"])}, Minecraft {minecraft}. These are fixed once a mod exists; changing them
          means editing fabric.mod.json and moving the Java sources by hand.
        </span>
      </Section>
      <Section title="Dependencies">
        <span className="field-hint">Other mods this one needs. build.gradle reads this list on every build, and required ones go in the jar's fabric.mod.json.</span>
        {deps.length > 0 && (
          <table className="rows deps">
            <thead>
              <tr>
                <th>Mod</th>
                <th>Build</th>
                <th>Required</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {deps.map((d, i) => (
                <DependencyRow
                  key={`${i}:${d.slug}`}
                  dep={d}
                  minecraft={minecraft}
                  error={p.errors.get(`dependencies.${i}.slug`) ?? p.errors.get(`dependencies.${i}.version`)}
                  onChange={(next) => setDeps(deps.map((x, n) => (n === i ? next : x)))}
                  onRemove={() => setDeps(deps.filter((_, n) => n !== i))}
                />
              ))}
            </tbody>
          </table>
        )}
        <ModrinthSearch
          minecraft={minecraft}
          has={(slug) => deps.some((d) => d.slug === slug)}
          onAdd={(slug, version) => setDeps([...deps, { slug, version, required: true }])}
        />
      </Section>
    </>
  );
}

/** One dependency. Its build can be typed, or picked from the mod's Fabric builds for this Minecraft version. */
function DependencyRow(p: { dep: Dependency; minecraft: string; error?: string; onChange: (d: Dependency) => void; onRemove: () => void }) {
  const [versions, setVersions] = useState<ModrinthVersion[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = async () => {
    setProblem(null);
    try {
      const list = await api().modrinthVersions(p.dep.slug, p.minecraft);
      if (list.length === 0) setProblem(`No Fabric build of ${p.dep.slug} for Minecraft ${p.minecraft} on Modrinth`);
      setVersions(list);
    } catch (e) {
      setProblem((e as Error).message);
    }
  };
  const known = versions?.find((v) => v.id === p.dep.version || v.versionNumber === p.dep.version);
  return (
    <>
      <tr>
        <td className={p.error ? "has-error" : ""} title={p.error}>
          <input value={p.dep.slug} placeholder="modrinth slug" onChange={(e) => p.onChange({ ...p.dep, slug: e.target.value.trim() })} />
        </td>
        <td>
          {versions && versions.length > 0 ? (
            <select value={known?.id ?? p.dep.version} onChange={(e) => p.onChange({ ...p.dep, version: e.target.value })}>
              {!known && <option value={p.dep.version}>{p.dep.version || "(pick one)"}</option>}
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.versionNumber}
                  {v.type !== "release" ? ` (${v.type})` : ""}
                </option>
              ))}
            </select>
          ) : (
            <span className="dep-version">
              <input value={p.dep.version} placeholder="version id" onChange={(e) => p.onChange({ ...p.dep, version: e.target.value.trim() })} />
              <button className="link" disabled={!p.dep.slug} onClick={load}>Pick</button>
            </span>
          )}
        </td>
        <td>
          <input type="checkbox" checked={p.dep.required !== false} onChange={(e) => p.onChange({ ...p.dep, required: e.target.checked })} />
        </td>
        <td>
          <button className="icon" title="Remove" onClick={p.onRemove}>×</button>
        </td>
      </tr>
      {problem && (
        <tr>
          <td colSpan={4} className="field-hint bad">{problem}</td>
        </tr>
      )}
    </>
  );
}

/** Search Modrinth for Fabric mods on this Minecraft version and add one with its newest release. */
function ModrinthSearch(p: { minecraft: string; has: (slug: string) => boolean; onAdd: (slug: string, version: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ModrinthProject[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const search = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setProblem(null);
    try {
      setResults(await api().modrinthSearch(query.trim(), p.minecraft));
    } catch (e) {
      setProblem(`Couldn't reach Modrinth: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const add = async (mod: ModrinthProject) => {
    setProblem(null);
    try {
      const pick = suggestedVersion(await api().modrinthVersions(mod.slug, p.minecraft));
      if (!pick) return setProblem(`${mod.title} has no Fabric build for Minecraft ${p.minecraft}`);
      p.onAdd(mod.slug, pick.id);
    } catch (e) {
      setProblem(`Couldn't reach Modrinth: ${(e as Error).message}`);
    }
  };

  return (
    <div className="modrinth">
      <form className="modrinth-search" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input type="search" placeholder={`Find a Fabric mod for ${p.minecraft} on Modrinth`} value={query} onChange={(e) => setQuery(e.target.value)} />
        <button disabled={busy || !query.trim()}>{busy ? "Searching" : "Search"}</button>
      </form>
      {problem && <span className="field-hint bad">{problem}</span>}
      {results && results.length === 0 && <span className="field-hint">No Fabric mods for {p.minecraft} match "{query.trim()}".</span>}
      {results && results.length > 0 && (
        <ul className="modrinth-results">
          {results.map((m) => (
            <li key={m.slug}>
              {m.iconUrl ? <img src={m.iconUrl} alt="" /> : <span className="no-icon" />}
              <span className="modrinth-text">
                <strong>{m.title}</strong> <span className="muted">{m.slug} · {m.downloads.toLocaleString()} downloads</span>
                <span className="muted">{m.description}</span>
              </span>
              <button disabled={p.has(m.slug)} onClick={() => add(m)}>{p.has(m.slug) ? "Added" : "Add"}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
