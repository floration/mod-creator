import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  ElementSpecSchema,
  KIND_FOLDERS,
  ProjectSchema,
  registeredBlocks,
  registeredItems,
  shapeBlocks,
  type AdvancementSpec,
  type ElementSpec,
  type MobSpec,
  type Project,
} from "./schema.js";
import { parseBlockbench, type EntityModelDef } from "./blockbench.js";
import { parseStructure } from "./nbt.js";
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
  /** Blockbench models used by mobs, by project-relative path. */
  models: Record<string, EntityModelDef>;
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
  const models = await loadModels(root, elements, issues);
  issues.push(...(await checkStructures(root, parsed.data.modId, elements)));
  issues.push(...(await checkSounds(root, elements)));
  return { root, project: parsed.data, elements, issues, models };
}

/** Read the Blockbench models mobs use; a model that can't be used is an error on the mob. */
async function loadModels(root: string, elements: LoadedElement[], issues: Issue[]): Promise<Record<string, EntityModelDef>> {
  const models: Record<string, EntityModelDef> = {};
  for (const { spec, file } of elements) {
    if (spec.kind !== "mob" || spec.mob.model !== "blockbench") continue;
    const model = spec.mob.blockbench;
    if (!model) {
      issues.push({ severity: "error", file, field: "mob.blockbench", message: "Choose the .bbmodel file for this mob's body" });
      continue;
    }
    if (model in models || !existsSync(path.join(root, model))) continue; // a missing file is reported with the art
    try {
      models[model] = parseBlockbench(await readJson(path.join(root, model)));
    } catch (e) {
      issues.push({ severity: "error", file, field: "mob.blockbench", message: `${model}: ${(e as Error).message}` });
    }
  }
  return models;
}

/** The world version of Minecraft 26.3; structure files saved by a newer game may not load. */
export const DATA_VERSION = 5023;

/** Read each structure's `.nbt`: it has to be a structure file, and the blocks it uses from this mod have to exist. */
async function checkStructures(root: string, modId: string, elements: LoadedElement[]): Promise<Issue[]> {
  const issues: Issue[] = [];
  const blocks = new Set(elements.flatMap((e) => registeredBlocks(e.spec)));
  for (const { spec, file } of elements) {
    if (spec.kind !== "structure") continue;
    const nbt = path.join(root, spec.structure.file);
    if (!spec.structure.file.endsWith(".nbt") || !existsSync(nbt)) continue; // reported with the art
    const at = (severity: Issue["severity"], message: string) => issues.push({ severity, file, field: "structure.file", message });
    try {
      const t = parseStructure(await readFile(nbt));
      if (t.blocks.length === 0) at("error", `${spec.structure.file} has no blocks in it`);
      if (t.dataVersion > DATA_VERSION) at("warning", `${spec.structure.file} was saved by a newer Minecraft (data version ${t.dataVersion}) than 26.3 (${DATA_VERSION}) and may not load`);
      const missing = [...new Set(t.palette.map((p) => p.name))].filter((n) => n.startsWith(`${modId}:`) && !blocks.has(n.slice(modId.length + 1)));
      if (missing.length) at("error", `${spec.structure.file} uses ${missing.join(", ")}, which this mod doesn't have`);
    } catch (e) {
      at("error", `${spec.structure.file} can't be read: ${(e as Error).message}`);
    }
  }
  return issues;
}

/** Channel count of an Ogg Vorbis file, from its first page; null when it isn't one. */
export function oggChannels(data: Buffer): number | null {
  if (data.length < 28 || data.toString("latin1", 0, 4) !== "OggS") return null;
  const packet = 27 + data[26];
  if (data.length < packet + 12 || data[packet] !== 1 || data.toString("latin1", packet + 1, packet + 7) !== "vorbis") return null;
  return data[packet + 11];
}

/** Each sound file has to be Ogg Vorbis, the only format Minecraft plays; stereo files don't fade with distance. */
async function checkSounds(root: string, elements: LoadedElement[]): Promise<Issue[]> {
  const issues: Issue[] = [];
  for (const { spec, file } of elements) {
    if (spec.kind !== "sound") continue;
    for (const [i, f] of spec.sound.files.entries()) {
      const full = path.join(root, f.file);
      if (!f.file.endsWith(".ogg") || !existsSync(full)) continue; // reported with the art
      const channels = oggChannels(await readFile(full));
      const field = `sound.files.${i}.file`;
      if (channels === null) issues.push({ severity: "error", file, field, message: `${f.file} isn't Ogg Vorbis. Export it as .ogg (Vorbis) from Audacity or another editor` });
      else if (channels > 1 && !spec.sound.stream) issues.push({ severity: "warning", file, field, message: `${f.file} is stereo, so it plays equally loud everywhere. Make it mono for sounds that should come from a place` });
    }
  }
  return issues;
}

/** Broken references, id clashes and missing art across a set of elements. */
export function checkReferences(root: string, elements: LoadedElement[]): Issue[] {
  const issues: Issue[] = [];
  const specs = elements.map((e) => e.spec);
  const items = new Set(specs.flatMap((s) => registeredItems(s).map(([id]) => id)));
  const blocks = new Set(specs.flatMap(registeredBlocks));
  const idsOf = (kind: string) => new Set(specs.filter((s) => s.kind === kind).map((s) => s.id));
  const trees = idsOf("tree");
  const plants = idsOf("plant");
  const mobs = idsOf("mob");
  const biomes = idsOf("biome");
  const sounds = idsOf("sound");
  const advancements = idsOf("advancement");
  const recipes = new Set(specs.flatMap(recipeIds));
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

  const checkAdvancement = (file: string, spec: AdvancementSpec) => {
    const a = spec.advancement;
    if (a.parent) {
      if (a.parent === spec.id) err(file, "advancement.parent", "An advancement can't be its own parent");
      else checkLocal(file, "advancement.parent", a.parent, advancements, "advancement");
      if (!a.parent.includes(":") && advancements.has(a.parent) && parentLoop(spec.id, specs)) {
        err(file, "advancement.parent", "Parents go round in a loop; one advancement in the line needs no parent");
      }
      if (a.background) issues.push({ severity: "warning", file, field: "advancement.background", message: "Only a tab's first advancement (one without a parent) shows a background" });
    }
    if (a.background) checkArt(file, "advancement.background", a.background);
    checkItem(file, "advancement.icon", a.icon, false);
    const mobSpec = (ref: string) => specs.find((s): s is MobSpec => s.kind === "mob" && s.id === ref);
    a.criteria.forEach((c, i) => {
      const at = `advancement.criteria.${i}`;
      switch (c.type) {
        case "obtain":
        case "eat":
          checkItem(file, `${at}.item`, c.item);
          break;
        case "place":
          if (!c.block.startsWith("#")) checkBlock(file, `${at}.block`, c.block);
          break;
        case "visit":
          checkLocal(file, `${at}.biome`, c.biome, biomes, "biome");
          break;
        case "craft":
          checkLocal(file, `${at}.recipe`, c.recipe, recipes, "recipe");
          break;
        case "kill":
        case "breed":
        case "tame": {
          checkLocal(file, `${at}.mob`, c.mob, mobs, "mob");
          const mob = mobSpec(c.mob);
          if (mob && c.type === "tame" && mob.mob.behavior !== "tameable") err(file, `${at}.mob`, `${mob.name} can't be tamed; set its Acts like to tameable`);
          if (mob && c.type === "breed" && mob.mob.behavior === "hostile") err(file, `${at}.mob`, `${mob.name} is hostile and doesn't breed`);
          break;
        }
      }
    });
    a.rewards.items.forEach((r, i) => checkItem(file, `advancement.rewards.items.${i}.item`, r.item, false));
    a.rewards.recipes.forEach((r, i) => checkLocal(file, `advancement.rewards.recipes.${i}`, r, recipes, "recipe"));
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
    if (spec.kind === "block" || spec.kind === "tree") {
      const door = spec.shapes.door;
      if (door) for (const f of ["top", "bottom", "icon"] as const) checkArt(file, `shapes.door.${f}`, door[f]);
      if (spec.shapes.trapdoor) checkArt(file, "shapes.trapdoor", spec.shapes.trapdoor);
    }
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
      if (spec.block.model.type === "custom" && shapeBlocks(spec).length > 0) {
        err(file, "shapes", "Shapes need a cube_all or cube_column block to take their textures from");
      }
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
      if (m.model === "blockbench" && m.blockbench) checkArt(file, "mob.blockbench", m.blockbench);
      if (m.food) checkItem(file, "mob.food", m.food);
      else if (m.behavior !== "hostile") err(file, "mob.food", "Pick the item that tempts and breeds it (only hostile mobs go without)");
      for (const [k, ref] of Object.entries(m.sounds)) {
        if (ref && !ref.includes(":") && !sounds.has(ref)) err(file, `mob.sounds.${k}`, `No sound named "${ref}" in this project. Vanilla sounds start with minecraft:`);
      }
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
    } else if (spec.kind === "advancement") {
      checkAdvancement(file, spec);
    } else if (spec.kind === "sound") {
      spec.sound.files.forEach((f, i) => {
        if (!f.file.endsWith(".ogg")) err(file, `sound.files.${i}.file`, "Minecraft only plays .ogg files");
        else checkArt(file, `sound.files.${i}.file`, f.file);
      });
    } else if (spec.kind === "structure") {
      const st = spec.structure;
      if (!st.file.endsWith(".nbt")) err(file, "structure.file", "Pick the .nbt file a structure block saved");
      else checkArt(file, "structure.file", st.file);
      st.biomes.forEach((b, i) => { if (!b.startsWith("#")) checkLocal(file, `structure.biomes.${i}`, b, biomes, "biome"); });
      if (st.separation >= st.spacing) err(file, "structure.separation", "Separation has to be less than spacing");
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

/** Recipe ids a spec creates: its own for recipe specs, and the crafting and stonecutter recipes of shapes and planks. */
export function recipeIds(spec: ElementSpec): string[] {
  if (spec.kind === "recipe") return [spec.id];
  if (spec.kind !== "block" && spec.kind !== "tree") return [];
  const ids = spec.kind === "tree" ? [`${spec.id}_planks`] : [];
  if (spec.kind === "block" && !spec.hasItem) return ids;
  for (const b of shapeBlocks(spec)) {
    ids.push(b.id);
    if (spec.kind === "block" && spec.block.sound !== "wood" && (b.shape === "stairs" || b.shape === "slab" || b.shape === "wall")) ids.push(`${b.id}_from_${spec.id}_stonecutting`);
  }
  return ids;
}

/** True when following parents up from advancement `id` comes back to it. */
function parentLoop(id: string, specs: ElementSpec[]): boolean {
  const parentOf = new Map(specs.flatMap((s) => (s.kind === "advancement" && s.advancement.parent ? [[s.id, s.advancement.parent] as const] : [])));
  const seen = new Set<string>();
  for (let at: string | undefined = parentOf.get(id); at !== undefined; at = parentOf.get(at)) {
    if (at === id) return true;
    if (seen.has(at)) return false;
    seen.add(at);
  }
  return false;
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
