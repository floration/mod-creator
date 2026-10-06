import { existsSync } from "node:fs";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadProject, type Issue, type LoadedProject } from "./project.js";
import { extraJavaFiles, modContentJava, starterClassJava } from "./profiles/v26_3/java.js";
import { resourceFiles } from "./profiles/v26_3/resources.js";
import { jsonSchemas } from "./schema.js";

export const GENERATED_DIR = "src/generated";

export interface GenerateResult {
  /** False when the project has errors; nothing was written. */
  ok: boolean;
  issues: Issue[];
  /** Files written under src/generated, relative to the project root. */
  written: string[];
  /** Generated resources skipped because a hand-written file with the same path exists in src/main/resources. */
  overridden: string[];
  /** Starter classes created in src/main/java this run. */
  created: string[];
}

/** Everything the generator would write, without touching the disk. Paths are relative to the project root. */
export function plan(loaded: LoadedProject): Map<string, string | { copy: string }> {
  const { project, elements } = loaded;
  const specs = elements.map((e) => e.spec);
  const files = new Map<string, string | { copy: string }>();
  const javaDir = `${GENERATED_DIR}/java/${project.package.replaceAll(".", "/")}/generated`;
  files.set(`${javaDir}/ModContent.java`, modContentJava(project, specs));
  for (const [p, content] of extraJavaFiles(project, specs)) files.set(`${javaDir}/${p}`, content);
  for (const [p, content] of resourceFiles(project, specs)) files.set(`${GENERATED_DIR}/resources/${p}`, content);
  return files;
}

/** Rewrite src/generated from the specs. Never writes into src/main except to create missing starter classes. */
export async function generate(root: string): Promise<GenerateResult> {
  const loaded = await loadProject(root);
  root = loaded.root;
  const result: GenerateResult = { ok: false, issues: loaded.issues, written: [], overridden: [], created: [] };
  await writeSchemas(root);
  if (loaded.issues.some((i) => i.severity === "error")) return result;

  const generatedDir = path.join(root, GENERATED_DIR);
  await rm(generatedDir, { recursive: true, force: true });

  for (const [rel, content] of plan(loaded)) {
    const resourcePrefix = `${GENERATED_DIR}/resources/`;
    if (rel.startsWith(resourcePrefix)) {
      const handWritten = path.join(root, "src/main/resources", rel.slice(resourcePrefix.length));
      if (existsSync(handWritten)) {
        result.overridden.push(rel.slice(resourcePrefix.length));
        continue;
      }
    }
    const target = path.join(root, rel);
    await mkdir(path.dirname(target), { recursive: true });
    if (typeof content === "string") {
      await writeFile(target, content);
    } else {
      await copyFile(path.join(root, content.copy), target);
      const mcmeta = path.join(root, content.copy + ".mcmeta");
      if (existsSync(mcmeta)) await copyFile(mcmeta, target + ".mcmeta");
    }
    result.written.push(rel);
  }

  for (const { spec } of loaded.elements) {
    if ((spec.kind === "block" || spec.kind === "item" || spec.kind === "tool" || spec.kind === "plant") && spec.customClass) {
      const file = path.join(root, "src/main/java", ...spec.customClass.split(".")) + ".java";
      if (existsSync(file)) continue;
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, starterClassJava(spec.customClass, spec.kind === "tool" ? "item" : spec.kind));
      result.created.push(path.relative(root, file).split(path.sep).join("/"));
    }
  }

  result.ok = true;
  return result;
}

/** JSON Schemas for editor autocomplete, referenced from each spec's `$schema`. */
export async function writeSchemas(root: string): Promise<void> {
  const dir = path.join(root, ".modcreator", "schema");
  await mkdir(dir, { recursive: true });
  for (const [name, schema] of Object.entries(jsonSchemas())) {
    await writeFile(path.join(dir, `${name}.json`), JSON.stringify(schema, null, 2) + "\n");
  }
}
