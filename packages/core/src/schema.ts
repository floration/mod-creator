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

const Basic = {
  $schema: z.string().optional(),
  id: LocalId,
  name: z.string().min(1),
  /** Tags this element is added to, for example `minecraft:mineable/pickaxe`. */
  tags: z.array(Ref).default([]),
  creativeTab: CreativeTab.optional(),
};

const Envelope = {
  ...Basic,
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

export const Rarity = z.enum(["common", "uncommon", "rare", "epic"]);

/** Makes an item edible. Vanilla bread is 5 nutrition and 0.6 saturation, an apple 4 and 0.3. */
export const FoodSchema = z.object({
  /** Hunger points restored; each drumstick in the hunger bar is 2. */
  nutrition: z.number().int().min(0).max(20),
  /** Saturation modifier: how long the food keeps you full. Vanilla foods use 0.1 to 1.2. */
  saturation: z.number().min(0).max(2).default(0.3),
  /** Can be eaten with a full hunger bar, like golden apples. */
  alwaysEdible: z.boolean().default(false),
});

export const ItemSpecSchema = z.object({
  kind: z.literal("item"),
  ...Envelope,
  item: z.object({
    texture: z.string(),
    maxStackSize: z.number().int().min(1).max(99).default(64),
    rarity: Rarity.default("common"),
    food: FoodSchema.optional(),
  }),
});
export type ItemSpec = z.infer<typeof ItemSpecSchema>;

/** Vanilla tool tier whose "incorrect for" tag decides which blocks the tool can mine. */
export const ToolTier = z.enum(["wood", "stone", "copper", "iron", "gold", "diamond", "netherite"]);

/** A tool or weapon. Damage and speed are on top of the player's base 1 damage and 4 attacks per second. */
export const ToolSpecSchema = z.object({
  kind: z.literal("tool"),
  ...Envelope,
  tool: z.object({
    type: z.enum(["sword", "pickaxe", "axe", "shovel", "hoe"]),
    texture: z.string(),
    /** Mines what this vanilla tier can mine. */
    tier: ToolTier.default("iron"),
    durability: z.number().int().min(1).max(10000).default(250),
    /** Mining speed. Iron 6, diamond 8. */
    miningSpeed: z.number().min(0).default(6),
    /** Attack damage added by the tool. An iron sword is 5 (6 hearts of damage with the base 1). */
    attackDamage: z.number().min(0).default(5),
    /** Attack speed modifier. Swords use -2.4, axes about -3. */
    attackSpeed: z.number().min(-4).max(4).default(-2.4),
    enchantability: z.number().int().min(0).max(50).default(14),
    /** Item that repairs it in an anvil. */
    repairItem: Ref.optional(),
    rarity: Rarity.default("common"),
  }),
});
export type ToolSpec = z.infer<typeof ToolSpecSchema>;

export const ARMOR_PIECES = ["helmet", "chestplate", "leggings", "boots"] as const;
export const ArmorPiece = z.enum(ARMOR_PIECES);
export type ArmorPiece = z.infer<typeof ArmorPiece>;
export const EquipSound = z.enum(["generic", "leather", "chain", "copper", "iron", "gold", "diamond", "netherite", "turtle"]);

/**
 * A set of armor. Each piece listed under `pieces` becomes an item `<id>_<piece>`, named "<name> Helmet" and so on.
 * The worn look comes from two textures in the vanilla armor layout: `layer1` (helmet, chestplate, boots)
 * and `layer2` (leggings).
 */
export const ArmorSpecSchema = z.object({
  kind: z.literal("armor"),
  ...Basic,
  armor: z.object({
    /** Item icon for each piece in the set. Leave a piece out to skip it. */
    pieces: z.partialRecord(ArmorPiece, z.string()),
    layer1: z.string(),
    layer2: z.string(),
    /** Durability multiplier. Iron is 15, diamond 33. */
    durability: z.number().int().min(1).max(200).default(15),
    /** Armor points per piece. Iron is 2, 6, 5, 2. */
    defense: z
      .object({
        helmet: z.number().int().min(0).max(30).default(2),
        chestplate: z.number().int().min(0).max(30).default(6),
        leggings: z.number().int().min(0).max(30).default(5),
        boots: z.number().int().min(0).max(30).default(2),
      })
      .default({ helmet: 2, chestplate: 6, leggings: 5, boots: 2 }),
    toughness: z.number().min(0).max(20).default(0),
    knockbackResistance: z.number().min(0).max(1).default(0),
    enchantability: z.number().int().min(0).max(50).default(9),
    equipSound: EquipSound.default("iron"),
    repairItem: Ref.optional(),
    rarity: Rarity.default("common"),
  }),
});
export type ArmorSpec = z.infer<typeof ArmorSpecSchema>;

/** Vanilla tree shapes the generator can copy. Heights and leaf radius can be tuned on top. */
export const TreeShape = z.enum(["oak", "fancy_oak", "birch", "spruce", "acacia", "cherry"]);

/**
 * A wood type: `<id>_log`, `<id>_planks`, `<id>_leaves` and `<id>_sapling` blocks, their items, tags, a planks
 * recipe, loot tables and the tree the sapling grows (also usable by biomes).
 */
export const TreeSpecSchema = z.object({
  kind: z.literal("tree"),
  $schema: z.string().optional(),
  id: LocalId,
  /** Wood name; blocks are called "<name> Log", "<name> Planks", "<name> Leaves" and "<name> Sapling". */
  name: z.string().min(1),
  creativeTab: CreativeTab.default("natural_blocks"),
  tree: z.object({
    logSide: z.string(),
    logEnd: z.string(),
    planks: z.string(),
    leaves: z.string(),
    sapling: z.string(),
    shape: TreeShape.default("oak"),
    /** Shortest trunk, in blocks. Defaults to the shape's own. */
    trunkHeight: z.number().int().min(1).max(32).optional(),
    /** Extra random trunk height, 0 to this many blocks. Defaults to the shape's own. */
    trunkHeightRandom: z.number().int().min(0).max(24).optional(),
    /** Leaf radius for oak, birch and fancy oak shapes. */
    leafRadius: z.number().int().min(0).max(8).optional(),
    /** Chance (0-1) that breaking leaves drops a sapling. Vanilla oak is 0.05. */
    saplingChance: z.number().min(0).max(1).default(0.05),
    /** An item leaves sometimes drop, like oak's apples. */
    fruit: z.object({ item: Ref, chance: z.number().min(0).max(1).default(0.02) }).optional(),
  }),
});
export type TreeSpec = z.infer<typeof TreeSpecSchema>;

/**
 * A small plant like short grass or a fern: no collision, breaks instantly, can be replaced by placing a
 * block. Bone meal spreads it to nearby grass.
 */
export const PlantSpecSchema = z.object({
  kind: z.literal("plant"),
  ...Envelope,
  plant: z.object({
    texture: z.string(),
    /** What breaking it drops without shears. Shears always drop the plant itself. */
    drops: z.union([z.literal("nothing"), z.literal("self"), z.object({ item: Ref, chance: z.number().min(0).max(1).default(0.125) })]).default("nothing"),
    /** Randomly nudged sideways like grass, so patches look natural. */
    offset: z.boolean().default(true),
  }),
});
export type PlantSpec = z.infer<typeof PlantSpecSchema>;

/** Vanilla body shapes a mob can borrow. Its texture uses the same layout as the vanilla mob's. */
export const MobModel = z.enum(["pig", "cow"]);

export const MobSpecSchema = z.object({
  kind: z.literal("mob"),
  $schema: z.string().optional(),
  id: LocalId,
  name: z.string().min(1),
  mob: z.object({
    model: MobModel.default("pig"),
    /** 64x64 PNG in the vanilla layout of the model (pig or cow). */
    texture: z.string(),
    /** Texture for babies, in the vanilla baby layout. Defaults to `texture`. */
    babyTexture: z.string().optional(),
    health: z.number().min(1).max(1024).default(10),
    /** Walking speed. Pigs and cows use 0.25 and 0.2. */
    speed: z.number().min(0).max(2).default(0.25),
    /** Hitbox size in blocks. */
    width: z.number().min(0.1).max(16).default(0.9),
    height: z.number().min(0.1).max(16).default(0.9),
    /** Item that tempts and breeds it; an id, `minecraft:carrot` or `#minecraft:pig_food`. */
    food: Ref,
    /** Sound events; default to the model animal's own. */
    sounds: z.object({ ambient: Ref.optional(), hurt: Ref.optional(), death: Ref.optional() }).default({}),
    drops: z
      .array(z.object({ item: Ref, min: z.number().int().min(0).default(1), max: z.number().int().min(0).default(1) }))
      .default([]),
    /** 16x16 spawn egg icon. */
    spawnEgg: z.string(),
  }),
});
export type MobSpec = z.infer<typeof MobSpecSchema>;

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a color like #6ab0ff");

/**
 * An Overworld biome, placed by the Biolith library by taking over part of a vanilla biome. It keeps vanilla's
 * caves, ores, lakes and monsters, and adds your trees, plants, mobs and colors.
 */
export const BiomeSpecSchema = z.object({
  kind: z.literal("biome"),
  $schema: z.string().optional(),
  id: LocalId,
  name: z.string().min(1),
  /** Biome tags, for example `minecraft:is_forest`. `minecraft:is_overworld` is always added. */
  tags: z.array(Ref).default([]),
  biome: z.object({
    temperature: z.number().min(-2).max(2).default(0.7),
    downfall: z.number().min(0).max(1).default(0.8),
    precipitation: z.boolean().default(true),
    colors: z.object({
      sky: Hex.default("#78a7ff"),
      fog: Hex.optional(),
      water: Hex.default("#3f76e4"),
      waterFog: Hex.optional(),
      grass: Hex.optional(),
      foliage: Hex.optional(),
    }),
    /** Where it generates: each entry takes over part of a vanilla biome. */
    replaces: z
      .array(z.object({ biome: Ref, share: z.number().min(0.01).max(1).default(0.25) }))
      .min(1),
    trees: z.array(z.object({ tree: Ref, perChunk: z.number().int().min(1).max(64).default(4) })).default([]),
    plants: z.array(z.object({ plant: Ref, patchesPerChunk: z.number().int().min(1).max(32).default(4) })).default([]),
    /** Extra vanilla placed features for the vegetation step, for example `minecraft:patch_grass_plain`. */
    vanillaFeatures: z.array(Ref).default([]),
    /** Creatures that spawn here. Vanilla monsters, bats and glow squid are always included. */
    spawns: z
      .array(z.object({ mob: Ref, weight: z.number().int().min(1).default(10), min: z.number().int().min(1).default(2), max: z.number().int().min(1).default(4) }))
      .default([]),
  }),
});
export type BiomeSpec = z.infer<typeof BiomeSpecSchema>;

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

/** What an ore vein replaces. This also decides the dimension it generates in. */
export const OreHost = z.enum(["stone", "deepslate", "stone_and_deepslate", "netherrack", "end_stone"]);

export const OreSpecSchema = z.object({
  kind: z.literal("ore"),
  $schema: z.string().optional(),
  id: LocalId,
  name: z.string().min(1),
  ore: z.object({
    /** Block placed in stone (or netherrack, end stone). */
    block: Ref,
    /** Block placed in deepslate; defaults to `block`. */
    deepslateBlock: Ref.optional(),
    replaces: OreHost.default("stone_and_deepslate"),
    /** Blocks per vein. Vanilla iron is 9, diamond 4. */
    veinSize: z.number().int().min(1).max(64).default(8),
    veinsPerChunk: z.number().int().min(1).max(128).default(4),
    minY: z.number().int().min(-64).max(320).default(-64),
    maxY: z.number().int().min(-64).max(320).default(64),
    /** `uniform` spreads veins evenly; `triangle` makes them most common halfway between minY and maxY. */
    distribution: z.enum(["uniform", "triangle"]).default("uniform"),
    /** Chance (0-1) that a vein block touching air is skipped. Vanilla diamond uses 0.5. */
    airExposureSkip: z.number().min(0).max(1).default(0),
  }),
});
export type OreSpec = z.infer<typeof OreSpecSchema>;

export const ElementSpecSchema = z.discriminatedUnion("kind", [
  BlockSpecSchema,
  ItemSpecSchema,
  ToolSpecSchema,
  ArmorSpecSchema,
  TreeSpecSchema,
  PlantSpecSchema,
  MobSpecSchema,
  BiomeSpecSchema,
  RecipeSpecSchema,
  OreSpecSchema,
]);
export type ElementSpec = z.infer<typeof ElementSpecSchema>;
export type ElementKind = ElementSpec["kind"];

/** Folder under `spec/` for each kind. */
export const KIND_FOLDERS: Record<ElementKind, string> = {
  block: "blocks",
  item: "items",
  tool: "tools",
  armor: "armor",
  tree: "trees",
  plant: "plants",
  mob: "mobs",
  biome: "biomes",
  recipe: "recipes",
  ore: "worldgen",
};

export const SCHEMAS = {
  project: ProjectSchema,
  block: BlockSpecSchema,
  item: ItemSpecSchema,
  tool: ToolSpecSchema,
  armor: ArmorSpecSchema,
  tree: TreeSpecSchema,
  plant: PlantSpecSchema,
  mob: MobSpecSchema,
  biome: BiomeSpecSchema,
  recipe: RecipeSpecSchema,
  ore: OreSpecSchema,
} as const;

/** JSON Schema for each spec kind, written to `.modcreator/schema/` for editor autocomplete. */
export function jsonSchemas(): Record<keyof typeof SCHEMAS, unknown> {
  const out = {} as Record<keyof typeof SCHEMAS, unknown>;
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    out[name as keyof typeof SCHEMAS] = z.toJSONSchema(schema, { io: "input" });
  }
  return out;
}

/** Blocks a tree spec creates, as `[id suffix, display name suffix]`. */
export const TREE_PARTS = [
  ["log", "Log"],
  ["planks", "Planks"],
  ["leaves", "Leaves"],
  ["sapling", "Sapling"],
] as const;

const titleCase = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * Every item a spec registers, as `[id, display name]`. Most specs register one item with their own id;
 * armor, trees and mobs register several.
 */
export function registeredItems(spec: ElementSpec): [string, string][] {
  switch (spec.kind) {
    case "block":
      return spec.hasItem ? [[spec.id, spec.name]] : [];
    case "item":
    case "tool":
    case "plant":
      return [[spec.id, spec.name]];
    case "armor":
      return ARMOR_PIECES.filter((p) => spec.armor.pieces[p]).map((p) => [`${spec.id}_${p}`, `${spec.name} ${titleCase(p)}`]);
    case "tree":
      return TREE_PARTS.map(([suffix, label]) => [`${spec.id}_${suffix}`, `${spec.name} ${label}`]);
    case "mob":
      return [[`${spec.id}_spawn_egg`, `${spec.name} Spawn Egg`]];
    default:
      return [];
  }
}

/** Every block a spec registers. */
export function registeredBlocks(spec: ElementSpec): string[] {
  if (spec.kind === "block" || spec.kind === "plant") return [spec.id];
  if (spec.kind === "tree") return TREE_PARTS.map(([suffix]) => `${spec.id}_${suffix}`);
  return [];
}
