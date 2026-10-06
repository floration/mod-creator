import type { BlockSpec, ElementSpec, ItemSpec, Project, RecipeSpec } from "../../schema.js";

/** Files to write, keyed by path relative to `src/generated/resources`. Strings are text, `{ copy }` copies a project file. */
export type ResourceFiles = Map<string, string | { copy: string }>;

const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

/** `ruby` -> `mymod:ruby`; `minecraft:stick` and `#minecraft:planks` are kept as they are. */
export function resolveRef(modId: string, ref: string): string {
  const tag = ref.startsWith("#");
  const bare = tag ? ref.slice(1) : ref;
  const full = bare.includes(":") ? bare : `${modId}:${bare}`;
  return tag ? `#${full}` : full;
}

/** `minecraft:mineable/pickaxe` -> `data/minecraft/tags/<type>/mineable/pickaxe.json` */
function tagPath(modId: string, tag: string, type: "block" | "item"): string {
  const [ns, p] = resolveRef(modId, tag.replace(/^#/, "")).split(":");
  return `data/${ns}/tags/${type}/${p}.json`;
}

function blockFiles(modId: string, b: BlockSpec, out: ResourceFiles) {
  const id = `${modId}:${b.id}`;
  out.set(`assets/${modId}/blockstates/${b.id}.json`, json({ variants: { "": { model: `${modId}:block/${b.id}` } } }));

  const m = b.block.model;
  const modelPath = `assets/${modId}/models/block/${b.id}.json`;
  if (m.type === "cube_all") {
    out.set(modelPath, json({ parent: "minecraft:block/cube_all", textures: { all: `${modId}:block/${b.id}` } }));
    copyTexture(out, m.texture, `assets/${modId}/textures/block/${b.id}.png`);
  } else if (m.type === "cube_column") {
    out.set(modelPath, json({
      parent: "minecraft:block/cube_column",
      textures: { side: `${modId}:block/${b.id}_side`, end: `${modId}:block/${b.id}_end` },
    }));
    copyTexture(out, m.side, `assets/${modId}/textures/block/${b.id}_side.png`);
    copyTexture(out, m.end, `assets/${modId}/textures/block/${b.id}_end.png`);
  } else {
    out.set(modelPath, { copy: m.model });
  }

  if (b.hasItem) {
    out.set(`assets/${modId}/items/${b.id}.json`, json({ model: { type: "minecraft:model", model: `${modId}:block/${b.id}` } }));
  }

  if (b.drops !== "none") {
    const entry: Record<string, unknown> = { type: "minecraft:item" };
    const pool: Record<string, unknown> = { rolls: 1, bonus_rolls: 0, entries: [entry] };
    if (b.drops === "self") {
      entry.name = id;
      pool.conditions = [{ condition: "minecraft:survives_explosion" }];
    } else {
      const d = b.drops;
      entry.name = resolveRef(modId, d.item);
      const functions: unknown[] = [];
      if (d.min !== 1 || d.max !== 1) {
        functions.push({
          function: "minecraft:set_count",
          count: d.min === d.max ? d.min : { type: "minecraft:uniform", min: d.min, max: d.max },
          add: false,
        });
      }
      if (d.fortune) {
        functions.push({ function: "minecraft:apply_bonus", enchantment: "minecraft:fortune", formula: "minecraft:ore_drops" });
      }
      functions.push({ function: "minecraft:explosion_decay" });
      entry.functions = functions;
    }
    out.set(`data/${modId}/loot_table/blocks/${b.id}.json`, json({
      type: "minecraft:block",
      pools: [pool],
      random_sequence: `${modId}:blocks/${b.id}`,
    }));
  }
}

function itemFiles(modId: string, i: ItemSpec, out: ResourceFiles) {
  out.set(`assets/${modId}/items/${i.id}.json`, json({ model: { type: "minecraft:model", model: `${modId}:item/${i.id}` } }));
  out.set(`assets/${modId}/models/item/${i.id}.json`, json({ parent: "minecraft:item/generated", textures: { layer0: `${modId}:item/${i.id}` } }));
  copyTexture(out, i.item.texture, `assets/${modId}/textures/item/${i.id}.png`);
}

function copyTexture(out: ResourceFiles, from: string, to: string) {
  out.set(to, { copy: from });
}

const COOKING_TYPES: Record<string, string> = {
  smelting: "minecraft:smelting",
  blasting: "minecraft:blasting",
  smoking: "minecraft:smoking",
  campfire_cooking: "minecraft:campfire_cooking",
};

export function recipeJson(modId: string, spec: RecipeSpec): unknown {
  const r = spec.recipe;
  const result = { id: resolveRef(modId, r.result.item), count: r.result.count };
  if (r.type === "shaped") {
    return {
      type: "minecraft:crafting_shaped",
      category: "misc",
      pattern: r.pattern,
      key: Object.fromEntries(Object.entries(r.key).map(([k, v]) => [k, resolveRef(modId, v)])),
      result,
    };
  }
  if (r.type === "shapeless") {
    return {
      type: "minecraft:crafting_shapeless",
      category: "misc",
      ingredients: r.ingredients.map((v) => resolveRef(modId, v)),
      result,
    };
  }
  return {
    type: COOKING_TYPES[r.type],
    category: "misc",
    ingredient: resolveRef(modId, r.ingredient),
    result,
    experience: r.experience,
    cookingtime: r.cookingTime,
  };
}

/** Every generated resource file for the project. */
export function resourceFiles(project: Project, elements: ElementSpec[]): ResourceFiles {
  const modId = project.modId;
  const out: ResourceFiles = new Map();
  const lang: Record<string, string> = {};
  const tags = new Map<string, string[]>();
  const addTag = (file: string, value: string) => tags.set(file, [...(tags.get(file) ?? []), value]);

  for (const e of elements) {
    if (e.kind === "block") {
      blockFiles(modId, e, out);
      lang[`block.${modId}.${e.id}`] = e.name;
      for (const t of e.tags) addTag(tagPath(modId, t, "block"), `${modId}:${e.id}`);
    } else if (e.kind === "item") {
      itemFiles(modId, e, out);
      lang[`item.${modId}.${e.id}`] = e.name;
      for (const t of e.tags) addTag(tagPath(modId, t, "item"), `${modId}:${e.id}`);
    } else {
      out.set(`data/${modId}/recipe/${e.id}.json`, json(recipeJson(modId, e)));
    }
  }

  if (Object.keys(lang).length) out.set(`assets/${modId}/lang/en_us.json`, json(lang));
  for (const [file, values] of tags) out.set(file, json({ replace: false, values }));
  return out;
}
