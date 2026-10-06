import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  ElementSpecSchema,
  KIND_FOLDERS,
  ProjectSchema,
  type ElementSpec,
  type Project,
} from "./schema.js";

export interface Issue {
  severity: "error" | "warning";
  /** Path relative to the project root. */
  file: string;
  /** Field path inside the file, like `block.model.texture`. */
  field?: string;
  message: string;
}

export interface LoadedElement {
  spec: ElementSpec;
  /** Path relative to the project root, with forward slashes. */
  file: string;
}

export interface LoadedProject {
  root: string;
  project: Project;
  elements: LoadedElement[];
  issues: Issue[];
}

export const PROJECT_FILE = "modcreator.json";

function rel(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

/** Read `modcreator.json` and every spec file. Invalid files are reported as issues, not thrown. */
export async function loadProject(root: string): Promise<LoadedProject> {
  root = path.resolve(root);
  const projectFile = path.join(root, PROJECT_FILE);
  if (!existsSync(projectFile)) {
    throw new Error(`No ${PROJECT_FILE} in ${root}. Create a project with \`modcreator new\`.`);
  }
  const parsed = ProjectSchema.safeParse(await readJson(projectFile));
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`${PROJECT_FILE} is invalid: ${detail}`);
  }

  const issues: Issue[] = [];
  const elements: LoadedElement[] = [];
  for (const [kind, folder] of Object.entries(KIND_FOLDERS)) {
    const dir = path.join(root, "spec", folder);
    if (!existsSync(dir)) continue;
    for (const name of (await readdir(dir)).sort()) {
      if (!name.endsWith(".json")) continue;
      const file = path.join(dir, name);
      const relFile = rel(root, file);
      let raw: unknown;
      try {
        raw = await readJson(file);
      } catch (e) {
        issues.push({ severity: "error", file: relFile, message: `Not valid JSON: ${(e as Error).message}` });
        continue;
      }
      const result = ElementSpecSchema.safeParse(raw);
      if (!result.success) {
        for (const i of result.error.issues) {
          issues.push({ severity: "error", file: relFile, field: i.path.join("."), message: i.message });
        }
        continue;
      }
      const spec = result.data;
      if (spec.kind !== kind) {
        issues.push({ severity: "error", file: relFile, field: "kind", message: `A ${spec.kind} spec belongs in spec/${KIND_FOLDERS[spec.kind]}/` });
        continue;
      }
      if (name !== `${spec.id}.json`) {
        issues.push({ severity: "warning", file: relFile, field: "id", message: `File name should be ${spec.id}.json` });
      }
      elements.push({ spec, file: relFile });
    }
  }

  issues.push(...checkReferences(root, elements));
  return { root, project: parsed.data, elements, issues };
}

/** Ids defined in this project that resolve to an item (items, and blocks with an item). */
function itemIds(elements: LoadedElement[]): Set<string> {
  const ids = new Set<string>();
  for (const { spec } of elements) {
    if (spec.kind === "item" || (spec.kind === "block" && spec.hasItem)) ids.add(spec.id);
  }
  return ids;
}

function checkReferences(root: string, elements: LoadedElement[]): Issue[] {
  const issues: Issue[] = [];
  const items = itemIds(elements);
  const blocks = new Set(elements.flatMap(({ spec }) => (spec.kind === "block" ? [spec.id] : [])));
  const checkBlock = (file: string, field: string, ref: string) => {
    if (ref.startsWith("#")) issues.push({ severity: "error", file, field, message: "Use a block id here, not a tag" });
    else if (!ref.includes(":") && !blocks.has(ref)) issues.push({ severity: "error", file, field, message: `No block named "${ref}" in this project` });
  };
  const seen = new Map<string, string>();
  const checkItem = (file: string, field: string, ref: string) => {
    if (ref.includes(":")) return; // vanilla, other mod or tag: checked in the dev client
    if (!items.has(ref)) issues.push({ severity: "error", file, field, message: `No item or block item named "${ref}" in this project` });
  };
  const checkArt = (file: string, field: string, art: string) => {
    if (!existsSync(path.join(root, art))) issues.push({ severity: "error", file, field, message: `Missing file ${art}` });
  };

  for (const { spec, file } of elements) {
    const key = spec.kind === "recipe" || spec.kind === "ore" ? `${spec.kind}:${spec.id}` : `item:${spec.id}`;
    const clash = seen.get(key);
    if (clash) issues.push({ severity: "error", file, field: "id", message: `Id "${spec.id}" is already used by ${clash}` });
    seen.set(key, file);

    if (spec.kind === "block") {
      const m = spec.block.model;
      if (m.type === "cube_all") checkArt(file, "block.model.texture", m.texture);
      if (m.type === "cube_column") {
        checkArt(file, "block.model.side", m.side);
        checkArt(file, "block.model.end", m.end);
      }
      if (m.type === "custom") checkArt(file, "block.model.model", m.model);
      if (typeof spec.drops === "object") checkItem(file, "drops.item", spec.drops.item);
      if (typeof spec.drops === "object" && spec.drops.max < spec.drops.min) {
        issues.push({ severity: "error", file, field: "drops.max", message: "max must be at least min" });
      }
    } else if (spec.kind === "item") {
      checkArt(file, "item.texture", spec.item.texture);
    } else if (spec.kind === "ore") {
      checkBlock(file, "ore.block", spec.ore.block);
      if (spec.ore.deepslateBlock) checkBlock(file, "ore.deepslateBlock", spec.ore.deepslateBlock);
      if (spec.ore.maxY < spec.ore.minY) issues.push({ severity: "error", file, field: "ore.maxY", message: "maxY must be at least minY" });
    } else {
      const r = spec.recipe;
      checkItem(file, "recipe.result.item", r.result.item);
      if (r.type === "shaped") {
        if (new Set(r.pattern.map((row) => row.length)).size > 1) {
          issues.push({ severity: "error", file, field: "recipe.pattern", message: "Every pattern row must be the same width" });
        }
        for (const row of r.pattern) {
          for (const ch of row) {
            if (ch !== " " && !(ch in r.key)) issues.push({ severity: "error", file, field: "recipe.pattern", message: `Pattern uses "${ch}" but key has no entry for it` });
          }
        }
        for (const [k, ref] of Object.entries(r.key)) if (!ref.startsWith("#")) checkItem(file, `recipe.key.${k}`, ref);
      } else if (r.type === "shapeless") {
        r.ingredients.forEach((ref, i) => { if (!ref.startsWith("#")) checkItem(file, `recipe.ingredients.${i}`, ref); });
      } else if (!r.ingredient.startsWith("#")) {
        checkItem(file, "recipe.ingredient", r.ingredient);
      }
    }
  }
  return issues;
}
