import { existsSync } from "node:fs";
import { chmod, cp, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROJECT_FILE } from "./project.js";
import { ProjectSchema, type Project } from "./schema.js";
import { writeSchemas } from "./generate.js";
import {
  MOD_GITIGNORE,
  buildGradle,
  entrypointClass,
  entrypointJava,
  fabricModJson,
  gradleProperties,
  settingsGradle,
} from "./profiles/v26_3/skeleton.js";

/** Gradle wrapper files shipped with the profile (gradlew, gradlew.bat, gradle/wrapper/*). */
export const WRAPPER_DIR = fileURLToPath(new URL("../profiles/26.3/wrapper/", import.meta.url));

export interface CreateOptions {
  modId: string;
  name: string;
  package: string;
  description?: string;
  authors?: string[];
  /** Path to the CLI's index.js; written into gradle.properties so builds regenerate. */
  cliPath?: string | null;
}

/** Create a new, buildable 26.3 Fabric mod project managed by Mod Creator. */
export async function createProject(dir: string, options: CreateOptions): Promise<Project> {
  dir = path.resolve(dir);
  if (existsSync(dir) && (await readdir(dir)).length > 0) {
    throw new Error(`${dir} already exists and is not empty`);
  }
  const project = ProjectSchema.parse({
    $schema: ".modcreator/schema/project.json",
    modId: options.modId,
    name: options.name,
    package: options.package,
    description: options.description ?? "",
    authors: options.authors ?? [],
  });

  let cli: string | null = null;
  if (options.cliPath) {
    const relative = path.relative(dir, options.cliPath);
    // Keep the link relative inside one checkout (like examples/), absolute anywhere else.
    const ups = relative.split(path.sep).filter((p) => p === "..").length;
    cli = (ups <= 3 ? relative : path.resolve(options.cliPath)).split(path.sep).join("/");
  }

  const files: Record<string, string> = {
    [PROJECT_FILE]: JSON.stringify(project, null, 2) + "\n",
    "build.gradle": buildGradle(project),
    "settings.gradle": settingsGradle(project),
    "gradle.properties": gradleProperties(project, cli),
    ".gitignore": MOD_GITIGNORE,
    "src/main/resources/fabric.mod.json": fabricModJson(project),
    [`src/main/java/${entrypointClass(project).replaceAll(".", "/")}.java`]: entrypointJava(project),
    "spec/blocks/.gitkeep": "",
    "spec/items/.gitkeep": "",
    "spec/recipes/.gitkeep": "",
    "spec/worldgen/.gitkeep": "",
    "art/.gitkeep": "",
  };
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  await cp(WRAPPER_DIR, dir, { recursive: true });
  await chmod(path.join(dir, "gradlew"), 0o755);
  await writeSchemas(dir);
  return project;
}
