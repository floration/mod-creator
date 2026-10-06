import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createProject, generate, itemIconArt, loadProject, plan, registeredItems, resolveRef } from "../src/index.js";

const RUBY = fileURLToPath(new URL("../../../examples/ruby", import.meta.url));
const AZUREGROVE = fileURLToPath(new URL("../../../examples/azuregrove", import.meta.url));
const temps: string[] = [];

async function copyOf(example: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "modcreator-"));
  temps.push(dir);
  // Skip generator and Gradle output: a running build or runClient keeps files in .gradle/ locked.
  const skip = ["build", ".gradle", "run", path.join("src", "generated")];
  await cp(example, dir, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(example, src);
      return !skip.some((s) => rel === s || rel.startsWith(s + path.sep));
    },
  });
  return dir;
}

const copyOfRuby = () => copyOf(RUBY);

async function editSpec(dir: string, rel: string, edit: (json: any) => void): Promise<void> {
  const file = path.join(dir, rel);
  const json = JSON.parse(await readFile(file, "utf8"));
  edit(json);
  await writeFile(file, JSON.stringify(json));
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
      "mob:glowmoth",
      "recipe:ruby_block",
      "recipe:ruby_from_block",
      "recipe:ruby_from_smelting",
      "recipe:ruby_lamp",
      "ore:ruby_ore_vein",
      "advancement:moth_friend",
      "advancement:ruby",
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

describe("Azure Grove example", () => {
  it("loads with no issues", async () => {
    const loaded = await loadProject(AZUREGROVE);
    expect(loaded.issues).toEqual([]);
    expect(new Set(loaded.elements.map((e) => e.spec.kind))).toEqual(
      new Set(["block", "item", "recipe", "ore", "tool", "armor", "tree", "plant", "mob", "biome", "advancement"]),
    );
  });

  it("has an inventory icon for every item it registers", async () => {
    const loaded = await loadProject(AZUREGROVE);
    const icons = Object.fromEntries(
      loaded.elements.flatMap(({ spec }) => registeredItems(spec).map(([id]) => [id, itemIconArt(spec, id)])),
    );
    expect(Object.entries(icons).filter(([, icon]) => !icon)).toEqual([]);
    expect(icons.azurite_helmet).toEqual({ kind: "flat", texture: "art/azurite_helmet.png" });
    expect(icons.azurite_leggings).toEqual({ kind: "flat", texture: "art/azurite_leggings.png" });
    expect(icons.azurewood_log).toEqual({ kind: "cube", top: "art/azurewood_log_top.png", side: "art/azurewood_log.png" });
    expect(icons.bluetusk_spawn_egg).toEqual({ kind: "flat", texture: "art/bluetusk_spawn_egg.png" });
  });

  it("generates the same output as the snapshot", async () => {
    const files = plan(await loadProject(AZUREGROVE));
    const text = Object.fromEntries(
      [...files].map(([p, c]) => [p, typeof c === "string" ? c : `<copy of ${c.copy}>`]),
    );
    expect(text).toMatchSnapshot();
  });

  it("registers every armor piece, tree part and spawn egg", async () => {
    const files = plan(await loadProject(AZUREGROVE));
    const java = files.get("src/generated/java/com/example/azuregrove/generated/ModContent.java") as string;
    for (const name of ["AZURITE_HELMET", "AZURITE_BOOTS", "AZUREWOOD_LOG", "AZUREWOOD_SAPLING", "AZURE_GRASS", "BLUETUSK_SPAWN_EGG"]) {
      expect(java).toContain(` ${name} =`);
    }
    expect(files.has("src/generated/java/com/example/azuregrove/generated/entity/Bluetusk.java")).toBe(true);
    expect(files.has("src/generated/java/com/example/azuregrove/generated/client/BluetuskRenderer.java")).toBe(true);
    const placement = JSON.parse(files.get("src/generated/resources/data/azuregrove/biolith/biome_placement/azure_grove.json") as string);
    expect(placement.replacements.map((r: any) => r.target)).toEqual(["minecraft:plains", "minecraft:forest"]);
  });

  it("makes shape blocks with their models, recipes, loot and tags", async () => {
    const files = plan(await loadProject(AZUREGROVE));
    const java = files.get("src/generated/java/com/example/azuregrove/generated/ModContent.java") as string;
    for (const name of ["AZURITE_BRICK_STAIRS", "AZURITE_BRICK_WALL", "AZUREWOOD_FENCE_GATE", "AZUREWOOD_DOOR", "AZUREWOOD_PRESSURE_PLATE"]) {
      expect(java).toContain(` ${name} =`);
    }
    const res = (p: string) => JSON.parse(files.get(`src/generated/resources/${p}`) as string);
    // Every model a blockstate names is generated.
    for (const id of ["azurite_brick_stairs", "azurite_brick_wall", "azurewood_fence", "azurewood_fence_gate", "azurewood_door", "azurewood_trapdoor", "azurewood_button"]) {
      const models = JSON.stringify(res(`assets/azuregrove/blockstates/${id}.json`)).match(/azuregrove:block\/[a-z_]+/g)!;
      for (const m of new Set(models)) expect(files.has(`src/generated/resources/assets/azuregrove/models/block/${m.split("/")[1]}.json`), m).toBe(true);
    }
    expect(res("assets/azuregrove/blockstates/azurite_brick_slab.json").variants["type=double"].model).toBe("azuregrove:block/azurite_bricks");
    expect(res("data/azuregrove/recipe/azurite_brick_stairs.json").result).toEqual({ id: "azuregrove:azurite_brick_stairs", count: 4 });
    expect(files.has("src/generated/resources/data/azuregrove/recipe/azurite_brick_slab_from_azurite_bricks_stonecutting.json")).toBe(true);
    expect(files.has("src/generated/resources/data/azuregrove/recipe/azurewood_slab_from_azurewood_planks_stonecutting.json")).toBe(false);
    expect(JSON.stringify(res("data/azuregrove/loot_table/blocks/azurewood_door.json"))).toContain('"half":"lower"');
    expect(res("data/minecraft/tags/block/mineable/pickaxe.json").values).toContain("azuregrove:azurite_brick_wall");
    expect(res("data/minecraft/tags/item/wooden_doors.json").values).toContain("azuregrove:azurewood_door");
  });

  it("rejects shapes on a block with a custom model", async () => {
    const dir = await copyOf(AZUREGROVE);
    await editSpec(dir, "spec/blocks/azurite_bricks.json", (json) => { json.block.model = { type: "custom", model: "art/azurite_bricks.png" }; });
    const fields = (await loadProject(dir)).issues.filter((i) => i.severity === "error").map((i) => i.field);
    expect(fields).toContain("shapes");
  });

  it("reports content that references things that don't exist", async () => {
    const dir = await copyOf(AZUREGROVE);
    await editSpec(dir, "spec/biomes/azure_grove.json", (json) => {
      json.biome.replaces[0].biome = "azure_grove";
      json.biome.trees[0].tree = "oakwood";
    });
    await editSpec(dir, "spec/mobs/bluetusk.json", (json) => { json.mob.food = "sapphire"; });
    const fields = (await loadProject(dir)).issues.map((i) => i.field);
    expect(fields).toEqual(expect.arrayContaining(["biome.replaces.0.biome", "biome.trees.0.tree", "mob.food"]));
  });

  it("rejects an item whose id clashes with a generated armor piece", async () => {
    const dir = await copyOf(AZUREGROVE);
    const plum = JSON.parse(await readFile(path.join(dir, "spec/items/azure_plum.json"), "utf8"));
    await rm(path.join(dir, "spec/items/azure_plum.json"));
    await writeFile(path.join(dir, "spec/items/azurite_helmet.json"), JSON.stringify({ ...plum, id: "azurite_helmet" }));
    const issues = (await loadProject(dir)).issues.filter((i) => i.severity === "error");
    expect(issues.some((i) => /azurite_helmet/.test(i.message))).toBe(true);
  });

  it("warns when a biome has no Biolith dependency", async () => {
    const dir = await copyOf(AZUREGROVE);
    await editSpec(dir, "modcreator.json", (json) => { json.dependencies = []; });
    const warnings = (await loadProject(dir)).issues.filter((i) => i.severity === "warning");
    expect(warnings.some((i) => /biolith/i.test(i.message))).toBe(true);
  });

  it("warns when an older build.gradle doesn't list a dependency from modcreator.json", async () => {
    const dir = await copyOf(AZUREGROVE);
    expect((await loadProject(dir)).issues.filter((i) => i.file === "build.gradle")).toEqual([]);
    // A build.gradle written before it read modcreator.json, with no Biolith line.
    const old = (await readFile(path.join(dir, "build.gradle"), "utf8"))
      .split("\n")
      .filter((line) => !line.includes("MODCREATOR_PROJECT"))
      .join("\n");
    await writeFile(path.join(dir, "build.gradle"), old);
    const issues = (await loadProject(dir)).issues.filter((i) => i.file === "build.gradle");
    expect(issues.map((i) => i.message)).toEqual([expect.stringContaining('maven.modrinth:biolith:K3CS4Akl')]);
    await writeFile(path.join(dir, "build.gradle"), old.replace("dependencies {", 'dependencies {\n\timplementation "maven.modrinth:biolith:K3CS4Akl"'));
    expect((await loadProject(dir)).issues.filter((i) => i.file === "build.gradle")).toEqual([]);
  });
});

describe("advancements", () => {
  it("writes vanilla advancement JSON, reward loot and lang entries", async () => {
    const files = plan(await loadProject(AZUREGROVE));
    const res = (p: string) => JSON.parse(files.get(`src/generated/resources/${p}`) as string);
    const root = res("data/azuregrove/advancement/azure_grove.json");
    expect(root.parent).toBeUndefined();
    expect(root.display.background).toBe("azuregrove:gui/advancements/backgrounds/azure_grove");
    expect(files.get("src/generated/resources/assets/azuregrove/textures/gui/advancements/backgrounds/azure_grove.png")).toEqual({ copy: "art/azurewood_planks.png" });
    expect(root.criteria.visit_1.conditions.player.predicate["minecraft:location"].biomes).toBe("azuregrove:azure_grove");

    const hunter = res("data/azuregrove/advancement/lurker_hunter.json");
    expect(hunter.parent).toBe("azuregrove:azure_grove");
    expect(hunter.requirements).toEqual([["kill_1"], ["kill_2"]]);
    expect(hunter.rewards).toEqual({ experience: 50, loot: ["azuregrove:advancement_reward/lurker_hunter"] });
    expect(res("data/azuregrove/loot_table/advancement_reward/lurker_hunter.json").type).toBe("minecraft:advancement_reward");

    expect(res("data/azuregrove/advancement/brick_by_brick.json").requirements).toEqual([["place_1", "place_2"]]);
    expect(res("data/azuregrove/advancement/sharp_and_blue.json").criteria.craft_1.conditions.recipes).toBe("azuregrove:azurite_sword");
    expect(res("data/azuregrove/advancement/plum_picker.json").rewards.recipes).toEqual(["azuregrove:azurewood_door"]);
    const lang = res("assets/azuregrove/lang/en_us.json");
    expect(lang["advancements.azuregrove.lurker_hunter.title"]).toBe("Lurker Hunter");
    expect(lang["advancements.azuregrove.lurker_hunter.description"]).toBe("Defeat a Grove Lurker and a Bluetusk");
  });

  it("reports missing parents, parent loops and criteria that can't happen", async () => {
    const dir = await copyOf(AZUREGROVE);
    await editSpec(dir, "spec/advancements/azure_grove.json", (json) => { json.advancement.parent = "tusk_rancher"; });
    await editSpec(dir, "spec/advancements/blue_rocks.json", (json) => { json.advancement.parent = "azure_grov"; });
    await editSpec(dir, "spec/advancements/tusk_rancher.json", (json) => {
      json.advancement.criteria = [{ type: "tame", mob: "bluetusk" }, { type: "breed", mob: "grove_lurker" }, { type: "craft", recipe: "azurite_pickaxe" }, { type: "visit", biome: "azure_meadow" }];
    });
    const issues = (await loadProject(dir)).issues.filter((i) => i.severity === "error");
    const at = (file: string) => issues.filter((i) => i.file === `spec/advancements/${file}.json`).map((i) => i.field);
    expect(at("azure_grove")).toEqual(["advancement.parent"]);
    expect(at("blue_rocks")).toEqual(["advancement.parent"]);
    expect(at("tusk_rancher")).toEqual(
      expect.arrayContaining(["advancement.parent", "advancement.criteria.0.mob", "advancement.criteria.1.mob", "advancement.criteria.2.recipe", "advancement.criteria.3.biome"]),
    );
  });

  it("knows the recipes shapes and planks create", async () => {
    const dir = await copyOf(AZUREGROVE);
    await editSpec(dir, "spec/advancements/plum_picker.json", (json) => {
      json.advancement.rewards.recipes = ["azurewood_planks", "azurite_brick_wall_from_azurite_bricks_stonecutting", "azurewood_slab_from_azurewood_planks_stonecutting"];
    });
    const fields = (await loadProject(dir)).issues.filter((i) => i.severity === "error").map((i) => i.field);
    expect(fields).toEqual(["advancement.rewards.recipes.2"]);
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

describe("ore veins", () => {
  it("rejects a vein of a block that doesn't exist", async () => {
    const dir = await copyOfRuby();
    const file = path.join(dir, "spec/worldgen/ruby_ore_vein.json");
    const json = JSON.parse(await readFile(file, "utf8"));
    json.ore.block = "sapphire_ore";
    json.ore.maxY = -32;
    await writeFile(file, JSON.stringify(json));
    const fields = (await loadProject(dir)).issues.map((i) => i.field);
    expect(fields).toContain("ore.block");
    expect(fields).toContain("ore.maxY");
  });

  it("uses the deepslate block for deepslate and the Nether selector for netherrack", async () => {
    const dir = await copyOfRuby();
    const file = path.join(dir, "spec/worldgen/ruby_ore_vein.json");
    const json = JSON.parse(await readFile(file, "utf8"));
    json.ore.replaces = "stone_and_deepslate";
    json.ore.deepslateBlock = "ruby_block";
    await writeFile(file, JSON.stringify(json));
    let files = plan(await loadProject(dir));
    const feature = JSON.parse(files.get("src/generated/resources/data/ruby/worldgen/feature/ruby_ore_vein.json") as string);
    expect(feature.targets.map((t: any) => t.state)).toEqual(["ruby:ruby_ore", "ruby:ruby_block"]);

    json.ore.replaces = "netherrack";
    await writeFile(file, JSON.stringify(json));
    files = plan(await loadProject(dir));
    expect(files.get("src/generated/java/com/example/ruby/generated/ModContent.java")).toContain("BiomeSelectors.foundInTheNether()");
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
    const gradle = await readFile(path.join(dir, "build.gradle"), "utf8");
    expect(gradle).toContain("net.fabricmc.fabric-loom");
    // Version and dependencies come from modcreator.json at build time, not from a copy.
    expect(gradle).toContain("JsonSlurper().parse(file('modcreator.json'))");
    expect(gradle).toContain('implementation "maven.modrinth:${it.slug}:${it.version}"');
    expect(await readFile(path.join(dir, "gradle.properties"), "utf8")).not.toContain("mod_version");
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
