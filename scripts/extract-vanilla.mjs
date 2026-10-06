#!/usr/bin/env node
// Reads every vanilla mob model and AI goal from the Minecraft client jar into the profile's data files, so the
// mob editor offers whatever the game version has. Run it again whenever a profile moves to a new version:
//
//   npm run extract-vanilla              write packages/core/src/profiles/v26_3/vanilla/*.json
//   npm run extract-vanilla -- --check   fail if the files differ from what the jar says (CI runs this)
//
// It needs Java 25+ and the jar plus its libraries, which Loom downloads the first time a mod project builds:
// ~/.gradle/caches/fabric-loom/<version>/minecraft-client.jar and ~/.gradle/caches/modules-2/files-2.1.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const version = option("--version") ?? "26.3";
const outDir = path.join(repo, "packages/core/src/profiles", `v${version.replace(/\./g, "_")}`, "vanilla");

const gradle = process.env.GRADLE_USER_HOME ?? path.join(os.homedir(), ".gradle");
const loom = path.join(gradle, "caches", "fabric-loom", version);
const jar = option("--jar") ?? path.join(loom, "minecraft-client.jar");
const info = path.join(loom, "mojang_minecraft_info.json");
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};
if (!existsSync(jar) || !existsSync(info)) {
  fail(`No Minecraft ${version} jar in ${loom}.\nBuild one of the example mods once (cd examples/ruby && ./gradlew build) so Loom downloads it.`);
}

// The game's libraries, found in Gradle's cache by group/name/version (Loom put them there).
const files = path.join(gradle, "caches", "modules-2", "files-2.1");
const classpath = [jar];
const missing = [];
for (const lib of JSON.parse(readFileSync(info, "utf8")).libraries) {
  const artifact = lib.downloads?.artifact;
  if (!artifact || lib.rules || lib.natives) continue;
  const [group, name, ver] = lib.name.split(":");
  const dir = path.join(files, group, name, ver);
  const file = path.basename(artifact.path);
  const found = existsSync(dir) ? readdirSync(dir).map((hash) => path.join(dir, hash, file)).find(existsSync) : undefined;
  if (found) classpath.push(found);
  else missing.push(lib.name);
}

const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java") : "java";
const tmp = mkdtempSync(path.join(os.tmpdir(), "modcreator-vanilla-"));
const raw = path.join(tmp, "vanilla.json");
try {
  execFileSync(java, ["-cp", classpath.join(path.delimiter), path.join(repo, "scripts", "vanilla", "ExtractVanilla.java"), raw], {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, JAVA_TOOL_OPTIONS: "" },
  });
} catch {
  fail(
    `The extractor failed. It needs Java 25 or newer (set JAVA_HOME; using ${java}).` +
      (missing.length ? `\nThese libraries weren't in the Gradle cache, in case one was needed: ${missing.join(", ")}` : ""),
  );
}
const data = JSON.parse(readFileSync(raw, "utf8"));
rmSync(tmp, { recursive: true, force: true });

// mobs.json is what the generator and editor need; models.json holds the shapes, which only the 3D preview reads.
const shapes = {};
for (const [id, m] of Object.entries(data.models)) {
  shapes[id] = { adult: m.adult, ...(m.baby ? { baby: m.baby } : {}) };
  m.textureSize = m.adult.textureSize;
  if (m.baby) m.babyTextureSize = m.baby.textureSize;
  delete m.adult;
  delete m.baby;
}
const lines = (obj) => `{\n${Object.entries(obj).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n")}\n}\n`;
const outputs = {
  "mobs.json": JSON.stringify(data, null, 2) + "\n",
  "models.json": lines(shapes),
};

let stale = false;
for (const [name, text] of Object.entries(outputs)) {
  const file = path.join(outDir, name);
  if (check) {
    if (!existsSync(file) || readFileSync(file, "utf8") !== text) {
      console.error(`${path.relative(repo, file)} is out of date with the Minecraft ${data.version} jar. Run: npm run extract-vanilla`);
      stale = true;
    }
  } else {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(file, text);
    console.log(`Wrote ${path.relative(repo, file)}`);
  }
}
if (stale) process.exit(1);
if (check) console.log(`Vanilla mob data matches the Minecraft ${data.version} jar.`);
