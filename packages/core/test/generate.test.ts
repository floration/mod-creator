import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createProject, generate, loadProject, plan, resolveRef } from "../src/index.js";

const RUBY = fileURLToPath(new URL("../../../examples/ruby", import.meta.url));
const temps: string[] = [];

async function copyOfRuby(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "modcreator-"));
  temps.push(dir);
  await cp(RUBY, dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}src${path.sep}generated`) });
  return dir;
}

afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("Ruby example", () => {
  it("loads with no issues", async () => {
    const loaded = await loadProject(RUBY);
    expect(loaded.issues).toEqual([]);
    expect(loaded.elements.map((e) => `${e.spec.kind}:${e.spec.id}`)).toEqual([
      "block:ruby_block",
      "block:ruby_lamp",
      "block:ruby_ore",
      "item:ruby",
      "recipe:ruby_block",
      "recipe:ruby_from_block",
      "recipe:ruby_from_smelting",
      "recipe:ruby_lamp",
    ]);
  });

  it("generates the same output as the snapshot", async () => {
    const files = plan(await loadProject(RUBY));
    const text = Object.fromEntries(
      [...files].map(([p, c]) => [p, typeof c === "string" ? c : `<copy of ${c.copy}>`]),
    );
    expect(text).toMatchSnapshot();
  });
});

describe("generate", () => {
  it("writes nothing when a spec references a missing item", async () => {
    const dir = await copyOfRuby();
    const recipe = path.join(dir, "spec/recipes/ruby_lamp.json");
    const json = JSON.parse(await readFile(recipe, "utf8"));
    json.recipe.key.R = "sapphire";
    await writeFile(recipe, JSON.stringify(json));

    const result = await generate(dir);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      file: "spec/recipes/ruby_lamp.json",
      field: "recipe.key.R",
      severity: "error",
    }));
    expect(existsSync(path.join(dir, "src/generated"))).toBe(false);
  });

  it("reports schema errors with the field path", async () => {
    const dir = await copyOfRuby();
    await writeFile(path.join(dir, "spec/items/ruby.json"), JSON.stringify({ kind: "item", id: "ruby", name: "Ruby", item: { texture: "art/ruby.png", maxStackSize: 500 } }));
    const loaded = await loadProject(dir);
    expect(loaded.issues).toContainEqual(expect.objectContaining({ file: "spec/items/ruby.json", field: "item.maxStackSize" }));
  });

  it("keeps hand-written resources and starter classes", async () => {
    const dir = await copyOfRuby();
    const lang = path.join(dir, "src/main/resources/assets/ruby/lang/en_us.json");
    await mkdir(path.dirname(lang), { recursive: true });
    await writeFile(lang, '{"item.ruby.ruby": "Shiny Ruby"}');
    const starter = path.join(dir, "src/main/java/com/example/ruby/RubyLampBlock.java");
    await writeFile(starter, "// my edits");

    const result = await generate(dir);
    expect(result.ok).toBe(true);
    expect(result.overridden).toEqual(["assets/ruby/lang/en_us.json"]);
    expect(result.created).toEqual([]);
    expect(await readFile(starter, "utf8")).toBe("// my edits");
    expect(existsSync(path.join(dir, "src/generated/resources/assets/ruby/lang/en_us.json"))).toBe(false);
    expect(existsSync(path.join(dir, "src/generated/resources/assets/ruby/textures/block/ruby_ore.png"))).toBe(true);
  });

  it("removes generated files for deleted specs", async () => {
    const dir = await copyOfRuby();
    await generate(dir);
    const lamp = path.join(dir, "src/generated/resources/assets/ruby/blockstates/ruby_lamp.json");
    expect(existsSync(lamp)).toBe(true);
    await rm(path.join(dir, "spec/blocks/ruby_lamp.json"));
    await rm(path.join(dir, "spec/recipes/ruby_lamp.json"));
    expect((await generate(dir)).ok).toBe(true);
    expect(existsSync(lamp)).toBe(false);
  });
});

describe("createProject", () => {
  it("creates a Gradle project with a wrapper and an entrypoint", async () => {
    const dir = path.join(await mkdtemp(path.join(os.tmpdir(), "modcreator-")), "gems");
    temps.push(path.dirname(dir));
    await createProject(dir, { modId: "gems", name: "Gems", package: "dev.q.gems" });
    for (const f of [
      "modcreator.json",
      "build.gradle",
      "settings.gradle",
      "gradle.properties",
      "gradlew",
      "gradlew.bat",
      "gradle/wrapper/gradle-wrapper.jar",
      "src/main/resources/fabric.mod.json",
      "src/main/java/dev/q/gems/GemsMod.java",
      ".modcreator/schema/block.json",
    ]) {
      expect(existsSync(path.join(dir, f)), f).toBe(true);
    }
    const mod = JSON.parse(await readFile(path.join(dir, "src/main/resources/fabric.mod.json"), "utf8"));
    expect(mod.entrypoints.main).toEqual(["dev.q.gems.GemsMod"]);
    expect(await readFile(path.join(dir, "build.gradle"), "utf8")).toContain("net.fabricmc.fabric-loom");
  });

  it("refuses a folder that is not empty", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "modcreator-"));
    temps.push(dir);
    await writeFile(path.join(dir, "keep.txt"), "x");
    await expect(createProject(dir, { modId: "gems", name: "Gems", package: "dev.q.gems" })).rejects.toThrow(/not empty/);
  });
});

describe("resolveRef", () => {
  it.each([
    ["ruby", "ruby:ruby"],
    ["minecraft:stick", "minecraft:stick"],
    ["#minecraft:planks", "#minecraft:planks"],
    ["#gems", "#ruby:gems"],
  ])("%s -> %s", (ref, expected) => {
    expect(resolveRef("ruby", ref)).toBe(expected);
  });
});
