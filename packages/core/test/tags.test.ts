import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { loadProject, modTags, parseTagPath } from "../src/index.js";

const AZUREGROVE = fileURLToPath(new URL("../../../examples/azuregrove", import.meta.url));

describe("parseTagPath", () => {
  it("splits the registry from the tag id", () => {
    expect(parseTagPath("data/minecraft/tags/block/mineable/pickaxe.json")).toEqual(["block", "minecraft:mineable/pickaxe"]);
    expect(parseTagPath("data/c/tags/worldgen/biome/is_forest.json")).toEqual(["worldgen/biome", "c:is_forest"]);
    expect(parseTagPath("data/minecraft/recipe/stick.json")).toBeNull();
    expect(parseTagPath("data/minecraft/tags/block.json")).toBeNull();
  });
});

describe("modTags", () => {
  it("lists the tags the generator fills, with the mod's entries", async () => {
    const loaded = await loadProject(AZUREGROVE);
    const tags = await modTags(loaded.root, loaded.project, loaded.elements.map((e) => e.spec));
    const ids = (type: string) => (tags[type] ?? []).map((t) => t.id);
    expect(ids("block")).toContain("minecraft:mineable/pickaxe");
    expect(ids("item")).toContain("azuregrove:azurite_repair_items");
    expect(ids("worldgen/biome")).toContain("minecraft:is_overworld");
    expect(tags.block.find((t) => t.id === "minecraft:mineable/pickaxe")!.values).toContain("azuregrove:azurite_ore");
  });
});
