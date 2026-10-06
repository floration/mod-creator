import { z } from "zod";

/** Lowercase id usable as a registry path: `ruby_ore`. */
export const LocalId = z
  .string()
  .regex(/^[a-z0-9_]+$/, "Use lowercase letters, digits and underscores");

/** A reference to another element (`ruby`) or a vanilla/other-mod id (`minecraft:stick`). */
export const Ref = z
  .string()
  .regex(/^(#?[a-z0-9_.-]+:)?[a-z0-9_/.-]+$/, "Use `id`, `namespace:id` or `#namespace:tag`");

export const ModIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{1,63}$/, "Mod ids are 2-64 lowercase characters, starting with a letter");

export const CreativeTab = z.enum([
  "building_blocks",
  "colored_blocks",
  "natural_blocks",
  "functional_blocks",
  "redstone_blocks",
  "tools_and_utilities",
  "combat",
  "food_and_drinks",
  "ingredients",
  "spawn_eggs",
]);

/** `modcreator.json` at the root of every mod project. */
export const ProjectSchema = z.object({
  $schema: z.string().optional(),
  modId: ModIdSchema,
  name: z.string().min(1),
  version: z.string().default("0.1.0"),
  description: z.string().default(""),
  authors: z.array(z.string()).default([]),
  /** Java package for generated and starter code, for example `com.example.ruby`. */
  package: z.string().regex(/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*$/, "Use a Java package name like com.example.mymod"),
  /** Version profile: which Minecraft release the templates target. */
  profile: z.literal("26.3").default("26.3"),
  /** Extra Modrinth dependencies, added to build.gradle as `maven.modrinth:<slug>:<version>`. */
  dependencies: z
    .array(z.object({ slug: z.string(), version: z.string(), required: z.boolean().default(true) }))
    .default([]),
});
export type Project = z.infer<typeof ProjectSchema>;

const Envelope = {
  $schema: z.string().optional(),
  id: LocalId,
  name: z.string().min(1),
  /** Tags this element is added to, for example `minecraft:mineable/pickaxe`. */
  tags: z.array(Ref).default([]),
  creativeTab: CreativeTab.optional(),
  /** Fully qualified hand-written class to construct instead of the vanilla one. */
  customClass: z.string().nullable().default(null),
};

export const SoundType = z.enum([
  "stone", "wood", "gravel", "grass", "metal", "glass", "wool", "sand",
  "amethyst", "deepslate", "copper", "netherrack", "nether_bricks", "bone_block",
]);

/** How a block looks. `cube_all` uses one texture, `cube_column` a side and an end texture. */
export const BlockModel = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cube_all"), texture: z.string() }),
  z.object({ type: z.literal("cube_column"), side: z.string(), end: z.string() }),
  z.object({ type: z.literal("custom"), model: z.string() }),
]);
export type BlockModel = z.infer<typeof BlockModel>;

export const Drops = z.union([
  z.literal("self"),
  z.literal("none"),
  z.object({
    item: Ref,
    min: z.number().int().min(0).default(1),
    max: z.number().int().min(0).default(1),
    fortune: z.boolean().default(false),
  }),
]);

export const BlockSpecSchema = z.object({
  kind: z.literal("block"),
  ...Envelope,
  block: z
    .object({
      hardness: z.number().min(-1).default(1.5),
      resistance: z.number().min(0).default(6),
      sound: SoundType.default("stone"),
      requiresTool: z.boolean().default(false),
      lightLevel: z.number().int().min(0).max(15).default(0),
      model: BlockModel,
    }),
  drops: Drops.default("self"),
  /** Register a matching block item (almost always wanted). */
  hasItem: z.boolean().default(true),
});
export type BlockSpec = z.infer<typeof BlockSpecSchema>;

export const ItemSpecSchema = z.object({
  kind: z.literal("item"),
  ...Envelope,
  item: z.object({
    texture: z.string(),
    maxStackSize: z.number().int().min(1).max(99).default(64),
    rarity: z.enum(["common", "uncommon", "rare", "epic"]).default("common"),
  }),
});
export type ItemSpec = z.infer<typeof ItemSpecSchema>;

const Result = z.object({ item: Ref, count: z.number().int().min(1).max(99).default(1) });

export const RecipeSpecSchema = z.object({
  kind: z.literal("recipe"),
  $schema: z.string().optional(),
  id: LocalId,
  recipe: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("shaped"),
      /** Up to 3 rows of up to 3 characters; space means empty. */
      pattern: z.array(z.string().max(3)).min(1).max(3),
      key: z.record(z.string().length(1), Ref),
      result: Result,
    }),
    z.object({
      type: z.literal("shapeless"),
      ingredients: z.array(Ref).min(1).max(9),
      result: Result,
    }),
    z.object({
      type: z.enum(["smelting", "blasting", "smoking", "campfire_cooking"]),
      ingredient: Ref,
      result: Result,
      experience: z.number().min(0).default(0.1),
      cookingTime: z.number().int().min(1).default(200),
    }),
  ]),
});
export type RecipeSpec = z.infer<typeof RecipeSpecSchema>;

export const ElementSpecSchema = z.discriminatedUnion("kind", [
  BlockSpecSchema,
  ItemSpecSchema,
  RecipeSpecSchema,
]);
export type ElementSpec = z.infer<typeof ElementSpecSchema>;
export type ElementKind = ElementSpec["kind"];

/** Folder under `spec/` for each kind. */
export const KIND_FOLDERS: Record<ElementKind, string> = {
  block: "blocks",
  item: "items",
  recipe: "recipes",
};

export const SCHEMAS = {
  project: ProjectSchema,
  block: BlockSpecSchema,
  item: ItemSpecSchema,
  recipe: RecipeSpecSchema,
} as const;

/** JSON Schema for each spec kind, written to `.modcreator/schema/` for editor autocomplete. */
export function jsonSchemas(): Record<keyof typeof SCHEMAS, unknown> {
  const out = {} as Record<keyof typeof SCHEMAS, unknown>;
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    out[name as keyof typeof SCHEMAS] = z.toJSONSchema(schema, { io: "input" });
  }
  return out;
}
