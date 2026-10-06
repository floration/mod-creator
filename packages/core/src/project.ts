import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  ElementSpecSchema,
  KIND_FOLDERS,
  ProjectSchema,
  registeredBlocks,
  registeredItems,
  type ElementSpec,
  type Project,
} from "./schema.js";
import { GRADLE_READS_PROJECT } from "./profiles/v26_3/skeleton.js";

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

/** Biolith build for Minecraft 26.3 on Fabric (Modrinth version id; the number 3.8.0-beta.1 is shared with other loaders). */
export const BIOLITH_VERSION = "K3CS4Akl";

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
  issues.push(...(await checkSetup(root, parsed.data, elements)));
  return { root, project: parsed.data, elements, issues };
}

function checkReferences(root: string, elements: LoadedElement[]): Issue[] {
  const issues: Issue[] = [];
  const specs = elements.map((e) => e.spec);
  const items = new Set(specs.flatMap((s) => registeredItems(s).map(([id]) => id)));
  const blocks = new Set(specs.flatMap(registeredBlocks));
  const idsOf = (kind: string) => new Set(specs.filter((s) => s.kind === kind).map((s) => s.id));
  const trees = idsOf("tree");
  const plants = idsOf("plant");
  const mobs = idsOf("mob");
  const err = (file: string, field: string, message: string) => issues.push({ severity: "error", file, field, message });

  const checkBlock = (file: string, field: string, ref: string) => {
    if (ref.startsWith("#")) err(file, field, "Use a block id here, not a tag");
    else if (!ref.includes(":") && !blocks.has(ref)) err(file, field, `No block named "${ref}" in this project`);
  };
  const checkItem = (file: string, field: string, ref: string, tagOk = true) => {
    if (ref.startsWith("#")) {
      if (!tagOk) err(file, field, "Use an item id here, not a tag");
      return;
    }
    if (ref.includes(":")) return; // vanilla or other mod: checked in the dev client
    if (!items.has(ref)) err(file, field, `No item or block item named "${ref}" in this project`);
  };
  const checkLocal = (file: string, field: string, ref: string, ids: Set<string>, what: string) => {
    if (!ref.includes(":") && !ids.has(ref)) err(file, field, `No ${what} named "${ref}" in this project`);
  };
  const checkArt = (file: string, field: string, art: string) => {
    if (!existsSync(path.join(root, art))) err(file, field, `Missing file ${art}`);
  };

  // Ids share a registry across kinds: an item from an armor set can clash with a plain item.
  const claimed = new Map<string, string>();
  const claim = (file: string, key: string, label: string) => {
    const clash = claimed.get(key);
    if (clash && clash !== file) err(file, "id", `${label} is already used by ${clash}`);
    else claimed.set(key, file);
  };
  for (const { spec, file } of elements) {
    for (const [id] of registeredItems(spec)) claim(file, `item:${id}`, `Item id "${id}"`);
    for (const id of registeredBlocks(spec)) claim(file, `block:${id}`, `Block id "${id}"`);
    if (!["block", "item", "tool", "armor", "tree", "plant"].includes(spec.kind)) claim(file, `${spec.kind}:${spec.id}`, `Id "${spec.id}"`);
  }

  for (const { spec, file } of elements) {
    if (spec.kind === "block") {
      const m = spec.block.model;
      if (m.type === "cube_all") checkArt(file, "block.model.texture", m.texture);
      if (m.type === "cube_column") {
        checkArt(file, "block.model.side", m.side);
        checkArt(file, "block.model.end", m.end);
      }
      if (m.type === "custom") checkArt(file, "block.model.model", m.model);
      if (typeof spec.drops === "object") checkItem(file, "drops.item", spec.drops.item, false);
      if (typeof spec.drops === "object" && spec.drops.max < spec.drops.min) err(file, "drops.max", "max must be at least min");
    } else if (spec.kind === "item") {
      checkArt(file, "item.texture", spec.item.texture);
    } else if (spec.kind === "tool") {
      checkArt(file, "tool.texture", spec.tool.texture);
      if (spec.tool.repairItem) checkItem(file, "tool.repairItem", spec.tool.repairItem);
    } else if (spec.kind === "armor") {
      const a = spec.armor;
      if (!Object.values(a.pieces).some(Boolean)) err(file, "armor.pieces", "Add at least one piece");
      for (const [piece, art] of Object.entries(a.pieces)) if (art) checkArt(file, `armor.pieces.${piece}`, art);
      checkArt(file, "armor.layer1", a.layer1);
      checkArt(file, "armor.layer2", a.layer2);
      if (a.repairItem) checkItem(file, "armor.repairItem", a.repairItem);
    } else if (spec.kind === "tree") {
      for (const f of ["logSide", "logEnd", "planks", "leaves", "sapling"] as const) checkArt(file, `tree.${f}`, spec.tree[f]);
      if (spec.tree.fruit) checkItem(file, "tree.fruit.item", spec.tree.fruit.item, false);
    } else if (spec.kind === "plant") {
      checkArt(file, "plant.texture", spec.plant.texture);
      if (typeof spec.plant.drops === "object") checkItem(file, "plant.drops.item", spec.plant.drops.item, false);
    } else if (spec.kind === "mob") {
      const m = spec.mob;
      checkArt(file, "mob.texture", m.texture);
      if (m.babyTexture) checkArt(file, "mob.babyTexture", m.babyTexture);
      checkArt(file, "mob.spawnEgg", m.spawnEgg);
      checkItem(file, "mob.food", m.food);
      m.drops.forEach((d, i) => {
        checkItem(file, `mob.drops.${i}.item`, d.item, false);
        if (d.max < d.min) err(file, `mob.drops.${i}.max`, "max must be at least min");
      });
    } else if (spec.kind === "biome") {
      const b = spec.biome;
      b.trees.forEach((t, i) => checkLocal(file, `biome.trees.${i}.tree`, t.tree, trees, "tree"));
      b.plants.forEach((p, i) => checkLocal(file, `biome.plants.${i}.plant`, p.plant, plants, "plant"));
      b.spawns.forEach((s, i) => {
        checkLocal(file, `biome.spawns.${i}.mob`, s.mob, mobs, "mob");
        if (s.max < s.min) err(file, `biome.spawns.${i}.max`, "max must be at least min");
      });
      b.replaces.forEach((r, i) => {
        if (!r.biome.includes(":")) err(file, `biome.replaces.${i}.biome`, "Use a vanilla biome id like minecraft:plains");
      });
    } else if (spec.kind === "ore") {
      checkBlock(file, "ore.block", spec.ore.block);
      if (spec.ore.deepslateBlock) checkBlock(file, "ore.deepslateBlock", spec.ore.deepslateBlock);
      if (spec.ore.maxY < spec.ore.minY) err(file, "ore.maxY", "maxY must be at least minY");
    } else {
      const r = spec.recipe;
      checkItem(file, "recipe.result.item", r.result.item, false);
      if (r.type === "shaped") {
        if (new Set(r.pattern.map((row) => row.length)).size > 1) err(file, "recipe.pattern", "Every pattern row must be the same width");
        for (const row of r.pattern) {
          for (const ch of row) {
            if (ch !== " " && !(ch in r.key)) err(file, "recipe.pattern", `Pattern uses "${ch}" but key has no entry for it`);
          }
        }
        for (const [k, ref] of Object.entries(r.key)) checkItem(file, `recipe.key.${k}`, ref);
      } else if (r.type === "shapeless") {
        r.ingredients.forEach((ref, i) => checkItem(file, `recipe.ingredients.${i}`, ref));
      } else {
        checkItem(file, "recipe.ingredient", r.ingredient);
      }
    }
  }
  return issues;
}

/** Project-level needs of some kinds: a library for biomes, a client entrypoint for mobs. */
async function checkSetup(root: string, project: Project, elements: LoadedElement[]): Promise<Issue[]> {
  const issues: Issue[] = [];
  const biome = elements.find((e) => e.spec.kind === "biome");
  if (biome && !project.dependencies.some((d) => d.slug === "biolith")) {
    issues.push({
      severity: "warning",
      file: PROJECT_FILE,
      field: "dependencies",
      message: `Biomes are placed in the world by the Biolith library. Add { "slug": "biolith", "version": "${BIOLITH_VERSION}" } to dependencies, or the biome won't generate.`,
    });
  }
  // Projects created before build.gradle read modcreator.json list dependencies by hand.
  const gradleFile = path.join(root, "build.gradle");
  if (existsSync(gradleFile)) {
    const gradle = await readFile(gradleFile, "utf8");
    if (!gradle.includes(GRADLE_READS_PROJECT)) {
      for (const d of project.dependencies) {
        const coords = `maven.modrinth:${d.slug}:${d.version}`;
        if (!gradle.includes(coords)) {
          issues.push({
            severity: "warning",
            file: "build.gradle",
            message: `build.gradle is missing the ${d.slug} dependency. Add implementation "${coords}" inside dependencies { }, or replace build.gradle with a new project's copy, which reads dependencies from modcreator.json.`,
          });
        }
      }
    }
  }
  const mob = elements.find((e) => e.spec.kind === "mob");
  const modJson = path.join(root, "src/main/resources/fabric.mod.json");
  if (mob && existsSync(modJson)) {
    const text = await readFile(modJson, "utf8");
    const client = `${project.package}.generated.ModContentClient`;
    if (!text.includes(client)) {
      issues.push({
        severity: "warning",
        file: "src/main/resources/fabric.mod.json",
        message: `Mobs need a client entrypoint to be drawn. Add "client": ["${client}"] under "entrypoints".`,
      });
    }
  }
  return issues;
}
