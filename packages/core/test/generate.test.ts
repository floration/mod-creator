import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import { gunzipSync, gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createProject, generate, itemIconArt, loadProject, oggChannels, parseStructure, plan, registeredItems, resolveRef, vanillaOrePreset, writeStructure } from "../src/index.js";

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
      new Set(["block", "item", "recipe", "ore", "tool", "armor", "tree", "plant", "mob", "biome", "advancement", "structure", "sound", "effect", "enchantment"]),
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

  it("grows trees with the vanilla shape's real config, or a hand-built layout", async () => {
    const files = plan(await loadProject(AZUREGROVE));
    const res = (p: string) => JSON.parse(files.get(`src/generated/resources/${p}`) as string);
    const java = files.get("src/generated/java/com/example/azuregrove/generated/ModContent.java") as string;
    // Azurewood: fancy oak with a shorter trunk.
    const azurewood = res("data/azuregrove/worldgen/feature/azurewood.json");
    expect(azurewood.trunk_placer).toEqual({ type: "minecraft:fancy_trunk_placer", base_height: 4, height_rand_a: 6, height_rand_b: 0 });
    expect(azurewood.foliage_placer.type).toBe("minecraft:fancy_foliage_placer");
    // Sky Willow: hand-built, placed by the generated feature type.
    const willow = res("data/azuregrove/worldgen/feature/sky_willow.json");
    expect(willow.type).toBe("azuregrove:custom_tree");
    expect(willow.logs_y).toContainEqual([0, 0, 0]);
    expect(willow.logs_x).toContainEqual([2, 5, 0]);
    expect(willow.leaves_by_distance.length).toBeLessThan(7);
    expect(java).toContain('Registry.register(BuiltInRegistries.FEATURE_TYPE, id("custom_tree"), CustomTreeFeature.CODEC);');
    expect(files.has("src/generated/java/com/example/azuregrove/generated/world/CustomTreeFeature.java")).toBe(true);
  });

  it("grows 2x2 shapes only from four saplings, and wants a layout for custom trees", async () => {
    const dir = await copyOf(AZUREGROVE);
    await editSpec(dir, "spec/trees/azurewood.json", (json) => { json.tree.shape = "dark_oak"; });
    const java = plan(await loadProject(dir)).get("src/generated/java/com/example/azuregrove/generated/ModContent.java") as string;
    expect(java).toContain('WeightedList.of(), WeightedList.of(ResourceKey.create(Registries.FEATURE, id("azurewood"))), WeightedList.of(), null);');
    await editSpec(dir, "spec/trees/azurewood.json", (json) => { json.tree.shape = "custom"; });
    const fields = (await loadProject(dir)).issues.filter((i) => i.severity === "error").map((i) => i.field);
    expect(fields).toContain("tree.custom");
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

  it("names the mod's item tags so Fabric doesn't warn about untranslated tags", async () => {
    const files = plan(await loadProject(AZUREGROVE));
    const lang = JSON.parse(files.get("src/generated/resources/assets/azuregrove/lang/en_us.json") as string);
    expect(lang["tag.item.azuregrove.azurewood_logs"]).toBe("Azurewood Logs");
    expect(lang["tag.item.azuregrove.azurite_repair_items"]).toBe("Azurite Repair Items");
    expect(Object.keys(lang).filter((k) => k.startsWith("tag.item.minecraft.") || k.startsWith("tag.item.c."))).toEqual([]);
  });

  it("reports missing parents, parent loops and criteria that can't happen", async () => {
    const dir = await copyOf(AZUREGROVE);
    await editSpec(dir, "spec/advancements/azure_grove.json", (json) => { json.advancement.parent = "tusk_rancher"; });
    await editSpec(dir, "spec/advancements/blue_rocks.json", (json) => { json.advancement.parent = "azure_grov"; });
    await editSpec(dir, "spec/advancements/tusk_rancher.json", (json) => {
      json.advancement.criteria = [{ type: "tame", mob: "bluetusk" }, { type: "breed", mob: "grove_lurker" }, { type: "craft", recipe: "azurite_spear" }, { type: "visit", biome: "azure_meadow" }];
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

describe("structures", () => {
  it("places the .nbt as a one-piece jigsaw structure in its biomes", async () => {
    const files = plan(await loadProject(AZUREGROVE));
    const res = (p: string) => JSON.parse(files.get(`src/generated/resources/${p}`) as string);
    expect(files.get("src/generated/resources/data/azuregrove/structure/azure_shrine.nbt")).toEqual({ copy: "art/azure_shrine.nbt" });
    const structure = res("data/azuregrove/worldgen/structure/azure_shrine.json");
    expect(structure).toMatchObject({ type: "minecraft:jigsaw", biomes: "#azuregrove:has_structure/azure_shrine", start_pool: "azuregrove:azure_shrine/start", step: "surface_structures" });
    expect(res("data/azuregrove/worldgen/template_pool/azure_shrine/start.json").elements[0].element.location).toBe("azuregrove:azure_shrine");
    expect(res("data/azuregrove/tags/worldgen/biome/has_structure/azure_shrine.json").values).toEqual(["azuregrove:azure_grove"]);
    expect(res("data/azuregrove/worldgen/structure_set/azure_shrine.json").placement).toMatchObject({ type: "minecraft:random_spread", spacing: 12, separation: 4 });
  });

  it("reads structure files back", async () => {
    const t = parseStructure(await readFile(path.join(AZUREGROVE, "art/azure_shrine.nbt")));
    expect(t.size).toEqual([5, 4, 6]);
    expect(t.palette.map((p) => p.name)).toContain("azuregrove:azurite_brick_wall");
    expect(t.palette.find((p) => p.name === "azuregrove:azurite_brick_slab")!.properties).toEqual({ type: "bottom", waterlogged: "false" });
    // 26.3 reads palette entries as {id, properties}; the old {Name, Properties} keys load as air.
    expect(t.legacyPalette).toBe(false);
  });

  it("flags 26.3 structure files that use the old palette keys, since every block in them loads as air", async () => {
    const legacy = Buffer.from(gunzipSync(writeStructure({ dataVersion: 5023, size: [1, 1, 1], palette: [{ name: "minecraft:stone", properties: {} }], blocks: [{ pos: [0, 0, 0], state: 0 }] })).toString("latin1").replace("\x08\x00\x02id", "\x08\x00\x04Name"), "latin1");
    const t = parseStructure(legacy);
    expect(t.legacyPalette).toBe(true);
    expect(t.palette[0].name).toBe("minecraft:stone");

    const dir = await copyOf(AZUREGROVE);
    await writeFile(path.join(dir, "art/azure_shrine.nbt"), gzipSync(legacy));
    const issues = (await loadProject(dir)).issues.filter((i) => i.file === "spec/structures/azure_shrine.json");
    expect(issues.map((i) => i.message)).toEqual([expect.stringMatching(/old Name\/Properties keys .* reads every block as air/)]);
  });

  it("reports blocks the mod doesn't have, files that aren't structures and bad spacing", async () => {
    const dir = await copyOf(AZUREGROVE);
    await writeFile(path.join(dir, "art/broken.nbt"), "not nbt");
    await writeFile(
      path.join(dir, "art/stranger.nbt"),
      writeStructure({ dataVersion: 9999, size: [1, 1, 1], palette: [{ name: "azuregrove:sapphire_block", properties: {} }], blocks: [{ pos: [0, 0, 0], state: 0 }] }),
    );
    const spec = JSON.parse(await readFile(path.join(dir, "spec/structures/azure_shrine.json"), "utf8"));
    for (const [id, file] of [["broken", "art/broken.nbt"], ["stranger", "art/stranger.nbt"]]) {
      await writeFile(path.join(dir, `spec/structures/${id}.json`), JSON.stringify({ ...spec, id, structure: { ...spec.structure, file } }));
    }
    await editSpec(dir, "spec/structures/azure_shrine.json", (json) => { json.structure.separation = 20; json.structure.biomes = ["azure_meadow", "#minecraft:is_forest"]; });
    const issues = (await loadProject(dir)).issues;
    const of = (id: string) => issues.filter((i) => i.file === `spec/structures/${id}.json`).map((i) => `${i.severity} ${i.field}: ${i.message}`);
    expect(of("broken")).toEqual([expect.stringMatching(/^error structure.file: art\/broken.nbt can't be read/)]);
    expect(of("stranger")).toEqual(
      expect.arrayContaining([expect.stringMatching(/^warning .*newer Minecraft/), expect.stringMatching(/^error .*azuregrove:sapphire_block/)]),
    );
    expect(of("azure_shrine")).toEqual(
      expect.arrayContaining([expect.stringMatching(/^error structure.separation/), expect.stringMatching(/^error structure.biomes.0/)]),
    );
    expect(of("azure_shrine")).toHaveLength(2);
  });
});

/** The first page of an Ogg Vorbis file, as far as the channel check reads. */
function oggHeader(channels: number): Buffer {
  const page = Buffer.alloc(27 + 1 + 30);
  page.write("OggS", 0, "latin1");
  page[26] = 1; // one segment
  page[27] = 30;
  page[28] = 1;
  page.write("vorbis", 29, "latin1");
  page[28 + 11] = channels;
  return page;
}

describe("sounds", () => {
  it("writes sounds.json, copies the files and registers the event", async () => {
    const files = plan(await loadProject(AZUREGROVE));
    const sounds = JSON.parse(files.get("src/generated/resources/assets/azuregrove/sounds.json") as string);
    expect(sounds.bluetusk_grunt).toEqual({
      subtitle: "subtitles.azuregrove.bluetusk_grunt",
      sounds: ["azuregrove:bluetusk_grunt/1", { name: "azuregrove:bluetusk_grunt/2", pitch: 0.9, weight: 2 }],
    });
    expect(files.get("src/generated/resources/assets/azuregrove/sounds/bluetusk_grunt/2.ogg")).toEqual({ copy: "art/bluetusk_grunt_2.ogg" });
    const java = files.get("src/generated/java/com/example/azuregrove/generated/ModContent.java") as string;
    expect(java).toContain('public static final SoundEvent BLUETUSK_GRUNT_SOUND = registerSound("bluetusk_grunt");');
    const bluetusk = files.get("src/generated/java/com/example/azuregrove/generated/entity/Bluetusk.java") as string;
    expect(bluetusk).toContain('Identifier.parse("azuregrove:bluetusk_grunt")');
    expect(bluetusk).toContain('Identifier.parse("minecraft:entity.pig.hurt")');
  });

  it("reads the channel count of an Ogg Vorbis file", async () => {
    expect(oggChannels(await readFile(path.join(AZUREGROVE, "art/bluetusk_grunt_1.ogg")))).toBe(1);
    expect(oggChannels(oggHeader(2))).toBe(2);
    expect(oggChannels(Buffer.from("RIFF....WAVEfmt "))).toBeNull();
  });

  it("reports files that aren't Ogg Vorbis, stereo files and mob sounds that don't exist", async () => {
    const dir = await copyOf(AZUREGROVE);
    await writeFile(path.join(dir, "art/stereo.ogg"), oggHeader(2));
    await writeFile(path.join(dir, "art/wave.ogg"), "RIFF....WAVEfmt ");
    await editSpec(dir, "spec/sounds/bluetusk_grunt.json", (json) => {
      json.sound.files = [{ file: "art/stereo.ogg" }, { file: "art/wave.ogg" }, { file: "art/grunt.mp3" }];
    });
    await editSpec(dir, "spec/mobs/bluetusk.json", (json) => { json.mob.sounds = { ambient: "bluetusk_growl", hurt: "minecraft:entity.pig.hurt" }; });
    const issues = (await loadProject(dir)).issues.map((i) => `${i.severity} ${i.file} ${i.field}`);
    expect(issues).toEqual(
      expect.arrayContaining([
        "warning spec/sounds/bluetusk_grunt.json sound.files.0.file",
        "error spec/sounds/bluetusk_grunt.json sound.files.1.file",
        "error spec/sounds/bluetusk_grunt.json sound.files.2.file",
        "error spec/mobs/bluetusk.json mob.sounds.ambient",
      ]),
    );
    expect(issues.filter((i) => i.includes("mob.sounds"))).toHaveLength(1);
  });
});

describe("effects", () => {
  const RES = "src/generated/resources";
  it("registers the effect and its potions, and writes brewing recipes like vanilla's", async () => {
    const files = plan(await loadProject(AZUREGROVE));
    const java = files.get("src/generated/java/com/example/azuregrove/generated/ModContent.java") as string;
    expect(java).toContain('public static final Holder<MobEffect> GROVE_STRIDE_EFFECT = registerEffect("grove_stride", new MobEffect(MobEffectCategory.BENEFICIAL, 0x4a8cff) {}');
    expect(java).toContain('.addAttributeModifier(Attributes.MOVEMENT_SPEED, id("effect.grove_stride.movement_speed"), 0.2, AttributeModifier.Operation.ADD_MULTIPLIED_TOTAL)');
    expect(java).toContain('new Potion("azuregrove.grove_stride", new MobEffectInstance(GROVE_STRIDE_EFFECT, 9600))');
    expect(java).toContain('new Potion("azuregrove.grove_stride", new MobEffectInstance(GROVE_STRIDE_EFFECT, 1800, 1))');
    // Effects are declared before the foods that give them.
    expect(java.indexOf("GROVE_STRIDE_EFFECT =")).toBeLessThan(java.indexOf("AZURE_PLUM ="));
    expect(java).toContain("new ApplyStatusEffectsConsumeEffect(new MobEffectInstance(GROVE_STRIDE_EFFECT, 200, 0), 0.5f)");
    expect(files.get(`${RES}/assets/azuregrove/textures/mob_effect/grove_stride.png`)).toEqual({ copy: "art/grove_stride.png" });
    const lang = JSON.parse(files.get(`${RES}/assets/azuregrove/lang/en_us.json`) as string);
    expect(lang["effect.azuregrove.grove_stride"]).toBe("Grove Stride");
    expect(lang["item.minecraft.tipped_arrow.effect.azuregrove.grove_stride"]).toBe("Arrow of Grove Stride");
    const brewing = [...files.keys()].filter((f) => f.includes("/recipe/brewing/"));
    // 3 bottles x (awkward + redstone + glowstone), and gunpowder and dragon's breath for each of the 3 potions.
    expect(brewing).toHaveLength(15);
    expect(JSON.parse(files.get(`${RES}/data/azuregrove/recipe/brewing/splash_potion_awkward_azure_plum.json`) as string)).toEqual({
      type: "minecraft:brewing",
      input: { item: "minecraft:splash_potion", potion_contents: { potions: "minecraft:awkward" } },
      output: { components: { "minecraft:potion_contents": { potion: "azuregrove:grove_stride" } }, id: "minecraft:splash_potion" },
      reagent: { item: "azuregrove:azure_plum" },
    });
  });

  it("looks up vanilla food effects by id", async () => {
    const dir = await copyOf(AZUREGROVE);
    await editSpec(dir, "spec/items/azure_plum.json", (json) => { json.item.food.effects = [{ effect: "minecraft:speed", seconds: 5 }]; });
    const java = plan(await loadProject(dir)).get("src/generated/java/com/example/azuregrove/generated/ModContent.java") as string;
    expect(java).toContain('new MobEffectInstance(BuiltInRegistries.MOB_EFFECT.get(Identifier.parse("minecraft:speed")).orElseThrow(), 100, 0), 1.0f)');
  });

  it("reports unknown effects, brewing ingredients vanilla already uses and odd icon sizes", async () => {
    const dir = await copyOf(AZUREGROVE);
    await editSpec(dir, "spec/items/azure_plum.json", (json) => { json.item.food.effects = [{ effect: "grove_dash" }, { effect: "minecraft:sped" }]; });
    await editSpec(dir, "spec/effects/grove_stride.json", (json) => { json.effect.potion.ingredient = "minecraft:sugar"; json.effect.icon = "art/azure_plum.png"; });
    const issues = (await loadProject(dir)).issues.map((i) => `${i.severity} ${i.file} ${i.field}`);
    expect(issues).toEqual(
      expect.arrayContaining([
        "error spec/items/azure_plum.json item.food.effects.0.effect",
        "error spec/items/azure_plum.json item.food.effects.1.effect",
        "error spec/effects/grove_stride.json effect.potion.ingredient",
        "warning spec/effects/grove_stride.json effect.icon",
      ]),
    );
  });
});

describe("enchantments", () => {
  const RES = "src/generated/resources";
  it("writes the enchantment like vanilla's, with its name and table tag", async () => {
    const files = plan(await loadProject(AZUREGROVE));
    const e = JSON.parse(files.get(`${RES}/data/azuregrove/enchantment/lurkers_bane.json`) as string);
    expect(e.description).toEqual({ translate: "enchantment.azuregrove.lurkers_bane" });
    expect(e.effects["minecraft:damage"][0].requirements.predicate).toEqual({ "minecraft:entity_type": "azuregrove:grove_lurker" });
    expect(e.effects["minecraft:post_attack"][0].effect).toMatchObject({ type: "minecraft:apply_mob_effect", to_apply: "minecraft:slowness", min_amplifier: 1 });
    expect(e).toMatchObject({ max_level: 3, weight: 5, slots: ["mainhand"], supported_items: "#minecraft:enchantable/weapon", exclusive_set: "#minecraft:exclusive_set/damage" });
    expect(JSON.parse(files.get(`${RES}/data/minecraft/tags/enchantment/non_treasure.json`) as string).values).toEqual(["azuregrove:lurkers_bane"]);
    expect(JSON.parse(files.get(`${RES}/assets/azuregrove/lang/en_us.json`) as string)["enchantment.azuregrove.lurkers_bane"]).toBe("Lurker's Bane");
  });

  it("keeps treasure off the enchanting table and makes its own exclusive set for a list", async () => {
    const dir = await copyOf(AZUREGROVE);
    await editSpec(dir, "spec/enchantments/lurkers_bane.json", (json) => {
      json.enchantment.treasure = true;
      json.enchantment.exclusiveWith = ["minecraft:sharpness", "minecraft:smite"];
      json.enchantment.effects.push({ type: "attribute", attribute: "movement_speed", operation: "multiply_total", amount: 0.1, perLevel: 0.05 });
    });
    const files = plan(await loadProject(dir));
    expect(files.has(`${RES}/data/minecraft/tags/enchantment/non_treasure.json`)).toBe(false);
    for (const t of ["treasure", "on_random_loot", "tradeable"]) {
      expect(JSON.parse(files.get(`${RES}/data/minecraft/tags/enchantment/${t}.json`) as string).values).toEqual(["azuregrove:lurkers_bane"]);
    }
    const e = JSON.parse(files.get(`${RES}/data/azuregrove/enchantment/lurkers_bane.json`) as string);
    expect(e.exclusive_set).toBe("#azuregrove:exclusive_set/lurkers_bane");
    expect(JSON.parse(files.get(`${RES}/data/azuregrove/tags/enchantment/exclusive_set/lurkers_bane.json`) as string).values).toEqual(["minecraft:sharpness", "minecraft:smite"]);
    expect(e.effects["minecraft:attributes"][0]).toEqual({
      amount: { type: "minecraft:linear", base: 0.1, per_level_above_first: 0.05 },
      attribute: "minecraft:movement_speed",
      id: "azuregrove:enchantment.lurkers_bane.movement_speed",
      operation: "add_multiplied_total",
    });
  });

  it("reports missing mobs, effects and enchantments it names", async () => {
    const dir = await copyOf(AZUREGROVE);
    await editSpec(dir, "spec/enchantments/lurkers_bane.json", (json) => {
      json.enchantment.exclusiveWith = ["frost_bite"];
      json.enchantment.effects = [{ type: "damage", against: "grove_stalker" }, { type: "effect_on_hit", effect: "rooted" }];
    });
    const issues = (await loadProject(dir)).issues.map((i) => `${i.severity} ${i.field}`);
    expect(issues).toEqual(expect.arrayContaining([
      "error enchantment.exclusiveWith.0",
      "error enchantment.effects.0.against",
      "error enchantment.effects.1.effect",
    ]));
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

describe("ore shapes", () => {
  const editVein = async (ore: Record<string, unknown>) => {
    const dir = await copyOfRuby();
    const file = path.join(dir, "spec/worldgen/ruby_ore_vein.json");
    const json = JSON.parse(await readFile(file, "utf8"));
    Object.assign(json.ore, ore);
    await writeFile(file, JSON.stringify(json));
    return loadProject(dir);
  };
  const out = (files: Map<string, unknown>, kind: string) =>
    JSON.parse(files.get(`src/generated/resources/data/ruby/worldgen/${kind}/ruby_ore_vein.json`) as string);

  it("writes a scattered ore with the same targets as a vein", async () => {
    const files = plan(await editVein({ shape: "scattered", veinSize: 2 }));
    const feature = out(files, "feature");
    expect(feature.type).toBe("minecraft:scattered_ore");
    expect(feature.size).toBe(2);
    expect(feature.targets[0].state).toBe("ruby:ruby_ore");
  });

  it("puts a disk on the floors of water and lets disks overlap", async () => {
    const files = plan(await editVein({ shape: "disk", replaces: "netherrack", disk: { radiusMin: 2, radiusMax: 5, halfHeight: 2, replaces: ["minecraft:sand"] } }));
    const feature = out(files, "feature");
    expect(feature).toMatchObject({ type: "minecraft:disk", half_height: 2, radius: { min_inclusive: 2, max_inclusive: 5 }, state_provider: { id: "ruby:ruby_ore" } });
    expect(feature.target.blocks).toEqual(["minecraft:sand", "ruby:ruby_ore"]);
    const types = out(files, "placed_feature").placement.map((p: any) => p.type);
    expect(types).toEqual(["minecraft:count", "minecraft:in_square", "minecraft:heightmap", "minecraft:block_predicate_filter", "minecraft:biome"]);
    // Disks need water, so they stay in the Overworld whatever the vein replaces.
    expect(files.get("src/generated/java/com/example/ruby/generated/ModContent.java")).toContain("BiomeSelectors.foundInOverworld()");
  });

  it("writes a geode in layers, one in so many chunks, at the local modifications step", async () => {
    const files = plan(
      await editVein({ shape: "geode", chunksPerVein: 24, geode: { outerBlock: "minecraft:tuff", middleBlock: "ruby_block", buddingBlock: "minecraft:budding_amethyst", crystals: ["minecraft:amethyst_cluster"] } }),
    );
    const feature = out(files, "feature");
    expect(feature.type).toBe("minecraft:geode");
    expect(feature.blocks.inner_layer_provider.id).toBe("ruby:ruby_ore");
    expect(feature.blocks.middle_layer_provider.id).toBe("ruby:ruby_block");
    expect(feature.blocks.outer_layer_provider.id).toBe("minecraft:tuff");
    expect(feature.blocks.alternate_inner_layer_provider.id).toBe("minecraft:budding_amethyst");
    expect(feature.blocks.inner_placements).toEqual(["minecraft:amethyst_cluster"]);
    expect(feature.use_alternate_layer0_chance).toBe(0.083);
    expect(out(files, "placed_feature").placement[0]).toEqual({ type: "minecraft:rarity_filter", chance: 24 });
    expect(files.get("src/generated/java/com/example/ruby/generated/ModContent.java")).toContain("GenerationStep.Decoration.LOCAL_MODIFICATIONS");
  });

  it("checks a geode's blocks and a disk's radius", async () => {
    let fields = (await editVein({ shape: "geode", geode: { outerBlock: "sapphire_block", crystals: ["minecraft:amethyst_cluster"] } })).issues.map((i) => i.field);
    expect(fields).toContain("ore.geode.outerBlock");
    expect(fields).toContain("ore.geode.buddingBlock");
    fields = (await editVein({ shape: "disk", disk: { radiusMin: 4, radiusMax: 2 } })).issues.map((i) => i.field);
    expect(fields).toContain("ore.disk.radiusMax");
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

describe("vanilla ore presets", () => {
  it("turns the game's placed and configured features into ore fields", () => {
    const geode = vanillaOrePreset(
      "minecraft:amethyst_geode",
      { placement: [{ type: "minecraft:rarity_filter", chance: 24 }, { type: "minecraft:height_range", height: { type: "minecraft:uniform", min_inclusive: { above_bottom: 6 }, max_inclusive: { absolute: 30 } } }] },
      {
        type: "minecraft:geode",
        blocks: { outer_layer_provider: { id: "minecraft:smooth_basalt" }, middle_layer_provider: { id: "minecraft:calcite" }, alternate_inner_layer_provider: { id: "minecraft:budding_amethyst" }, inner_placements: ["minecraft:amethyst_cluster"] },
        crack: { generate_crack_chance: 0.95 },
        use_alternate_layer0_chance: 0.083,
      },
    );
    expect(geode?.ore).toMatchObject({ shape: "geode", chunksPerVein: 24, minY: -58, maxY: 30, geode: { buddingBlock: "minecraft:budding_amethyst", crystals: ["minecraft:amethyst_cluster"] } });

    // Nether heights count from Y 0, and a feature with no count places one per chunk.
    const debris = vanillaOrePreset(
      "minecraft:ore_debris_small",
      { placement: [{ type: "minecraft:height_range", height: { type: "minecraft:uniform", min_inclusive: { above_bottom: 8 }, max_inclusive: { below_top: 8 } } }] },
      { type: "minecraft:scattered_ore", size: 2, discard_chance_on_air_exposure: 1, targets: [{ target: { predicate_type: "minecraft:tag_match", tag: "minecraft:base_stone_nether" } }] },
    );
    expect(debris?.ore).toMatchObject({ shape: "scattered", replaces: "netherrack", minY: 8, maxY: 247, veinsPerChunk: 1, airExposureSkip: 1 });

    expect(vanillaOrePreset("minecraft:trees_plains", { placement: [] }, { type: "minecraft:tree" })).toBeNull();
  });
});
