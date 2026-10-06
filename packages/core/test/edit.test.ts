import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dependentsOf, loadProject, renameEdits, type ElementSpec } from "../src/index.js";

const AZUREGROVE = fileURLToPath(new URL("../../../examples/azuregrove", import.meta.url));

const renamed = (spec: ElementSpec, id: string) => ({ ...structuredClone(spec), id }) as ElementSpec;

describe("dependentsOf", () => {
  it("lists every field that points at an element", async () => {
    const loaded = await loadProject(AZUREGROVE);
    const found = dependentsOf(loaded, "spec/items/azurite.json").map((i) => `${i.file} ${i.field}`);
    expect(found).toEqual(
      expect.arrayContaining([
        "spec/recipes/azurite_sword.json recipe.key.A",
        "spec/tools/azurite_sword.json tool.repairItem",
        "spec/armor/azurite.json armor.repairItem",
      ]),
    );
    expect(found.every((f) => !f.startsWith("spec/items/azurite.json"))).toBe(true);
  });

  it("is empty for an element nothing uses", async () => {
    const loaded = await loadProject(AZUREGROVE);
    expect(dependentsOf(loaded, "spec/recipes/azurite_bricks.json")).toEqual([]);
  });
});

describe("renameEdits", () => {
  it("points other specs at the new id", async () => {
    const loaded = await loadProject(AZUREGROVE);
    const item = loaded.elements.find((e) => e.file === "spec/items/azurite.json")!;
    const edits = renameEdits(loaded, item.file, renamed(item.spec, "sky_gem"));
    const sword = edits.find((e) => e.file === "spec/recipes/azurite_sword.json")!;
    expect((sword.spec as any).recipe.key.A).toBe("sky_gem");
    expect(edits.find((e) => e.file === "spec/tools/azurite_sword.json")!.fields).toEqual(["tool.repairItem"]);
    // Applying the edits leaves nothing broken.
    const after = loaded.elements.map((e) => edits.find((x) => x.file === e.file) ?? (e.file === item.file ? { file: "spec/items/sky_gem.json", spec: renamed(item.spec, "sky_gem") } : e));
    expect(dependentsOf({ ...loaded, elements: after }, "nothing")).toEqual([]);
  });

  it("renames ids derived from the element's id", async () => {
    const loaded = await loadProject(AZUREGROVE);
    const armor = loaded.elements.find((e) => e.file === "spec/armor/azurite.json")!;
    const edits = renameEdits(loaded, armor.file, renamed(armor.spec, "sky"));
    const helmet = edits.find((e) => e.file === "spec/recipes/azurite_helmet.json")!;
    expect((helmet.spec as any).recipe.result.item).toBe("sky_helmet");
    // The gem the armor is made of is a different element and stays.
    expect(Object.values((helmet.spec as any).recipe.key)).toEqual(["azurite"]);
  });

  it("follows a tree into the biome that grows it", async () => {
    const loaded = await loadProject(AZUREGROVE);
    const tree = loaded.elements.find((e) => e.spec.kind === "tree")!;
    const edits = renameEdits(loaded, tree.file, renamed(tree.spec, "skywood"));
    const biome = edits.find((e) => e.file === "spec/biomes/azure_grove.json")!;
    expect((biome.spec as any).biome.trees[0].tree).toBe("skywood");
  });

  it("does nothing when the id is unchanged", async () => {
    const loaded = await loadProject(AZUREGROVE);
    const item = loaded.elements.find((e) => e.file === "spec/items/azurite.json")!;
    expect(renameEdits(loaded, item.file, item.spec)).toEqual([]);
  });

  it("moves advancements to a renamed parent and follows renamed recipes", async () => {
    const loaded = await loadProject(AZUREGROVE);
    const root = loaded.elements.find((e) => e.file === "spec/advancements/azure_grove.json")!;
    const edits = renameEdits(loaded, root.file, renamed(root.spec, "grove"));
    expect(edits.map((e) => e.file).sort()).toEqual(["spec/advancements/blue_rocks.json", "spec/advancements/lurker_hunter.json", "spec/advancements/plum_picker.json"]);
    expect(edits.every((e) => e.spec.kind === "advancement" && e.spec.advancement.parent === "grove")).toBe(true);

    const tree = loaded.elements.find((e) => e.file === "spec/trees/azurewood.json")!;
    const plum = renameEdits(loaded, tree.file, renamed(tree.spec, "bluewood")).find((e) => e.file === "spec/advancements/plum_picker.json")!;
    expect(plum.fields).toEqual(["advancement.rewards.recipes.0"]);
    expect(plum.spec.kind === "advancement" && plum.spec.advancement.rewards.recipes).toEqual(["bluewood_door"]);
  });
});
