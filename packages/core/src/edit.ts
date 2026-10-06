import { checkReferences, recipeIds, type Issue, type LoadedElement, type LoadedProject } from "./project.js";
import { registeredBlocks, registeredItems, type ElementSpec } from "./schema.js";

/** A spec file to write back after a change elsewhere in the project. */
export interface SpecEdit {
  file: string;
  spec: ElementSpec;
  /** Field paths that were changed, like `recipe.key.R`. */
  fields: string[];
}

const key = (i: Issue) => `${i.file}\u0000${i.field ?? ""}\u0000${i.message}`;

/** Errors that `elements` has and the project as loaded does not. */
function newIssues(loaded: LoadedProject, elements: LoadedElement[]): Issue[] {
  const before = new Set(checkReferences(loaded.root, loaded.elements).map(key));
  return checkReferences(loaded.root, elements).filter((i) => i.severity === "error" && !before.has(key(i)));
}

/** What would break if the spec in `file` were deleted: the other specs' fields that point at it. */
export function dependentsOf(loaded: LoadedProject, file: string): Issue[] {
  return newIssues(loaded, loaded.elements.filter((e) => e.file !== file)).filter((i) => i.file !== file);
}

/** Ids other specs can point at: the items, blocks and recipes a spec creates, and the other kinds by id. */
function referenceableIds(spec: ElementSpec): Set<string> {
  const ids = new Set([...registeredItems(spec).map(([id]) => id), ...registeredBlocks(spec), ...recipeIds(spec)]);
  if (["tree", "plant", "mob", "biome", "advancement", "sound", "effect"].includes(spec.kind)) ids.add(spec.id);
  return ids;
}

function getPath(obj: unknown, path: string[]): unknown {
  return path.reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function setPath(obj: unknown, path: string[], value: unknown): void {
  const parent = getPath(obj, path.slice(0, -1));
  if (parent && typeof parent === "object") (parent as Record<string, unknown>)[path[path.length - 1]] = value;
}

/**
 * The edits that keep other specs pointing at an element whose id changes from `file`'s spec to `renamed`.
 * Derived ids follow too: renaming the armor set `ruby` turns `ruby_helmet` into `gem_helmet`.
 */
export function renameEdits(loaded: LoadedProject, file: string, renamed: ElementSpec): SpecEdit[] {
  const old = loaded.elements.find((e) => e.file === file)?.spec;
  if (!old || old.id === renamed.id) return [];
  const oldIds = referenceableIds(old);
  const newIds = referenceableIds(renamed);
  const mapped = (ref: string): string | null => {
    if (!oldIds.has(ref)) return null;
    const next = renamed.id + ref.slice(old.id.length);
    return newIds.has(next) ? next : null;
  };

  const placeholder = `__renamed__/${renamed.id}.json`;
  const after = loaded.elements.map((e) => (e.file === file ? { file: placeholder, spec: renamed } : e));
  const edits = new Map<string, SpecEdit>();
  for (const issue of newIssues(loaded, after)) {
    if (!issue.field || issue.file === placeholder) continue;
    const element = loaded.elements.find((e) => e.file === issue.file);
    if (!element) continue;
    const edit = edits.get(issue.file) ?? { file: issue.file, spec: structuredClone(element.spec), fields: [] };
    const path = issue.field.split(".");
    const value = getPath(edit.spec, path);
    const next = typeof value === "string" ? mapped(value) : null;
    if (next === null) continue;
    setPath(edit.spec, path, next);
    edit.fields.push(issue.field);
    edits.set(issue.file, edit);
  }
  return [...edits.values()];
}
