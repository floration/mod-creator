import { z } from "zod";
import { VANILLA_GOAL_IDS, VANILLA_MODEL_IDS } from "./vanillaMobs.js";

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
  /** Extra Modrinth dependencies. build.gradle reads them on every build as `maven.modrinth:<slug>:<version>`. */
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

/**
 * Shape variants generated from a block's textures, like vanilla's stone stairs or oak doors. Doors and trapdoors
 * need their own art; the rest reuse the block's textures.
 */
export const BlockShapes = z
  .object({
    stairs: z.boolean().default(false),
    slab: z.boolean().default(false),
    wall: z.boolean().default(false),
    fence: z.boolean().default(false),
    fenceGate: z.boolean().default(false),
    button: z.boolean().default(false),
    pressurePlate: z.boolean().default(false),
    /** Door textures: the 16x16 top and bottom halves and a 16x16 inventory icon. */
    door: z.object({ top: z.string(), bottom: z.string(), icon: z.string() }).optional(),
    /** Trapdoor texture, 16x16. */
    trapdoor: z.string().optional(),
  })
  .default({ stairs: false, slab: false, wall: false, fence: false, fenceGate: false, button: false, pressurePlate: false });
export type BlockShapes = z.infer<typeof BlockShapes>;

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
  /** Stairs, slabs, walls and other shapes of this block. Only for `cube_all` and `cube_column` blocks. */
  shapes: BlockShapes,
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
  /** Effects eating it gives, like a golden apple's regeneration. */
  effects: z
    .array(
      z.object({
        /** An effect from this mod by id, or a vanilla one like `minecraft:speed`. */
        effect: Ref,
        seconds: z.number().min(0.05).max(86400).default(30),
        /** 0 is level I, 1 is level II. */
        amplifier: z.number().int().min(0).max(255).default(0),
        /** Chance from 0 to 1 that eating gives it. */
        chance: z.number().min(0).max(1).default(1),
      }),
    )
    .default([]),
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

/**
 * How the tree grows: a vanilla tree's trunk and leaf shape (heights and leaf radius can be tuned on top), or
 * `custom` for a block layout built by hand. The shapes match trees.ts's TREE_SHAPES.
 */
export const TreeShape = z.enum([
  "oak",
  "fancy_oak",
  "birch",
  "super_birch",
  "jungle",
  "swamp_oak",
  "jungle_bush",
  "spruce",
  "pine",
  "acacia",
  "cherry",
  "azalea",
  "poplar",
  "dark_oak",
  "mega_spruce",
  "mega_pine",
  "mega_jungle",
  "custom",
]);

/**
 * A hand-built tree: layers of characters from the sapling's level up. In each layer, rows run north to south
 * and each row reads west to east. `.` is nothing, `L` an upright log, `X` a log lying east-west, `Z` a log
 * lying north-south, `#` leaves.
 */
export const CustomTreeLayout = z.object({
  layers: z.array(z.array(z.string().regex(/^[.LXZ# ]*$/, "use . L X Z # only"))).min(1),
  /** `[column, row]` of the sapling in the bottom layer. Defaults to the middle of the layout. */
  origin: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional(),
  /** Turn the tree a random quarter turn each time one grows, so a forest doesn't look copy-pasted. */
  randomRotation: z.boolean().default(true),
});
export type CustomTreeLayout = z.infer<typeof CustomTreeLayout>;

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
    /** Leaf radius for shapes with a fixed one (oak, birch, fancy oak, acacia, cherry, ...). */
    leafRadius: z.number().int().min(0).max(8).optional(),
    /** The layout for the `custom` shape. */
    custom: CustomTreeLayout.optional(),
    /** Chance (0-1) that breaking leaves drops a sapling. Vanilla oak is 0.05. */
    saplingChance: z.number().min(0).max(1).default(0.05),
    /** An item leaves sometimes drop, like oak's apples. */
    fruit: z.object({ item: Ref, chance: z.number().min(0).max(1).default(0.02) }).optional(),
  }).refine((t) => t.shape !== "custom" || t.custom, { message: "a custom tree needs a layout", path: ["custom"] }),
  /** The wood set: stairs, slabs, fences, doors and so on, made from the planks. */
  shapes: BlockShapes,
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

/**
 * The mob's body: any vanilla mob's model to borrow (its texture uses the same layout as the vanilla mob's), or
 * `blockbench` for your own model from a `.bbmodel` file. The list is read from the Minecraft jar.
 */
export const MobModel = z.enum(["blockbench", ...VANILLA_MODEL_IDS] as [string, ...string[]]);

export const MobBehavior = z.enum(["animal", "neutral", "tameable", "hostile"]);

/** A goal argument: a number, true/false, an id (`minecraft:player`, `#minecraft:water`), or a list of ids. */
export const GoalArg = z.union([z.number(), z.boolean(), z.string(), z.array(z.string())]);

/**
 * One AI goal: any vanilla goal, by name (`panic`, `avoid_entity`, `nearest_attackable_target`...). Arguments are
 * the goal constructor's parameters by name; Floration picks the constructor they fit. Lower priorities win.
 */
export const MobGoal = z.object({
  goal: z.enum(VANILLA_GOAL_IDS as [string, ...string[]]),
  priority: z.number().int().min(0).max(100).default(5),
  args: z.record(z.string(), GoalArg).optional(),
  /** Builder methods to call on it, like `setAlertOthers` on `hurt_by_target`, with their arguments. */
  calls: z.record(z.string(), z.record(z.string(), GoalArg)).optional(),
});
export type MobGoal = z.infer<typeof MobGoal>;

export const MobSpecSchema = z.object({
  kind: z.literal("mob"),
  $schema: z.string().optional(),
  id: LocalId,
  name: z.string().min(1),
  mob: z.object({
    model: MobModel.default("pig"),
    /** Draws the body this much bigger or smaller; the hitbox is set separately. */
    scale: z.number().min(0.05).max(16).default(1),
    /**
     * With model `blockbench`: the `.bbmodel` file, in Blockbench's Modded Entity format with Box UV. Animations
     * whose names contain "walk" and "idle" play while it moves and all the time.
     */
    blockbench: z.string().optional(),
    /** PNG in the vanilla layout of the model (64x64 for a pig or zombie), or the Blockbench model's own layout. */
    texture: z.string(),
    /** Texture for babies, in the vanilla baby layout. Defaults to `texture`. */
    babyTexture: z.string().optional(),
    health: z.number().min(1).max(1024).default(10),
    /** Walking speed. Pigs and cows use 0.25 and 0.2. */
    speed: z.number().min(0).max(2).default(0.25),
    /** Hitbox size in blocks. */
    width: z.number().min(0.1).max(16).default(0.9),
    height: z.number().min(0.1).max(16).default(0.9),
    /**
     * How it acts. `animal` wanders, flees when hurt and breeds; `neutral` also fights back; `tameable` is tamed
     * by feeding it, then sits and follows its owner; `hostile` hunts players in the dark and doesn't breed.
     */
    behavior: MobBehavior.default("animal"),
    /**
     * Its AI goals, replacing the ones `behavior` gives it. Behavior still picks the Java class it extends, so it
     * decides which goals fit (a tameable mob can follow its owner) and whether it breeds and tames.
     */
    goals: z.array(MobGoal).optional(),
    /** Flies around like a parrot or bee instead of walking, and takes no fall damage. */
    flies: z.boolean().default(false),
    /** Damage per hit, for mobs that fight. A zombie does 3, a wolf 4. */
    attackDamage: z.number().min(0).max(100).default(3),
    /**
     * Item that tempts, breeds and tames it; an id, `minecraft:carrot` or `#minecraft:pig_food`. Hostile mobs
     * don't need one.
     */
    food: Ref.optional(),
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

/**
 * The shape of an ore feature, each one a vanilla feature type:
 * - `blob`: an ordinary ore vein, a lump of blocks like iron or diamond.
 * - `scattered`: the same number of blocks spread out one by one, like ancient debris.
 * - `disk`: a flat round patch on river, lake and ocean floors, like clay and sand.
 * - `geode`: a hollow ball in layers like an amethyst geode; `block` is its inner layer.
 */
export const OreShape = z.enum(["blob", "scattered", "disk", "geode"]);

export const OreSpecSchema = z.object({
  kind: z.literal("ore"),
  $schema: z.string().optional(),
  id: LocalId,
  name: z.string().min(1),
  ore: z.object({
    shape: OreShape.default("blob"),
    /** Block placed in stone (or netherrack, end stone). A disk is made of it, and a geode's inner layer. */
    block: Ref,
    /** Block placed in deepslate; defaults to `block`. */
    deepslateBlock: Ref.optional(),
    replaces: OreHost.default("stone_and_deepslate"),
    /** Blocks per vein. Vanilla iron is 9, diamond 4. */
    veinSize: z.number().int().min(1).max(64).default(8),
    veinsPerChunk: z.number().int().min(1).max(128).default(4),
    /** For veins rarer than one per chunk: one in this many chunks, instead of `veinsPerChunk`. Vanilla geodes are 1 in 24. */
    chunksPerVein: z.number().int().min(1).max(1000).optional(),
    minY: z.number().int().min(-64).max(320).default(-64),
    maxY: z.number().int().min(-64).max(320).default(64),
    /** `uniform` spreads veins evenly; `triangle` makes them most common halfway between minY and maxY. */
    distribution: z.enum(["uniform", "triangle"]).default("uniform"),
    /** Chance (0-1) that a vein block touching air is skipped. Vanilla diamond uses 0.5. */
    airExposureSkip: z.number().min(0).max(1).default(0),
    /** Disk shape only. Vanilla clay is radius 2-3, half height 1; sand 2-6, half height 2. */
    disk: z
      .object({
        radiusMin: z.number().int().min(1).max(8).default(2),
        radiusMax: z.number().int().min(1).max(8).default(3),
        /** Blocks above and below the floor it replaces. */
        halfHeight: z.number().int().min(0).max(4).default(1),
        /** Floor blocks it turns into `block`. Its own block is always added so disks can overlap. */
        replaces: z.array(Ref).default(["minecraft:dirt", "minecraft:sand", "minecraft:gravel", "minecraft:clay"]),
      })
      .default({ radiusMin: 2, radiusMax: 3, halfHeight: 1, replaces: ["minecraft:dirt", "minecraft:sand", "minecraft:gravel", "minecraft:clay"] }),
    /** Geode shape only. Defaults are the amethyst geode's. */
    geode: z
      .object({
        /** Outside shell. */
        outerBlock: Ref.default("minecraft:smooth_basalt"),
        /** Layer between the shell and the inner layer. */
        middleBlock: Ref.default("minecraft:calcite"),
        /** Swapped in for some inner layer blocks, like budding amethyst. Crystals grow only on it. */
        buddingBlock: Ref.optional(),
        /** Share (0-1) of the inner layer that is the budding block. Amethyst uses 0.083. */
        buddingChance: z.number().min(0).max(1).default(0.083),
        /** Blocks placed on the budding blocks when the geode generates, like amethyst buds and clusters. */
        crystals: z.array(Ref).default([]),
        /** Chance (0-1) the geode has a crack in its side. */
        crackChance: z.number().min(0).max(1).default(0.95),
      })
      .default({ outerBlock: "minecraft:smooth_basalt", middleBlock: "minecraft:calcite", buddingChance: 0.083, crystals: [], crackChance: 0.95 }),
  }),
});
export type OreSpec = z.infer<typeof OreSpecSchema>;

/** What the player has to do for one criterion of an advancement. */
export const Criterion = z.discriminatedUnion("type", [
  /** Have the item (or `count` of it) in the inventory. Takes a tag too, like `#minecraft:logs`. */
  z.object({ type: z.literal("obtain"), item: Ref, count: z.number().int().min(1).max(6400).default(1) }),
  /** Kill a mob of this type. */
  z.object({ type: z.literal("kill"), mob: Ref }),
  /** Stand in a biome. */
  z.object({ type: z.literal("visit"), biome: Ref }),
  /** Craft with a recipe; recipes are named by their id, like `ruby_block` or `minecraft:bread`. */
  z.object({ type: z.literal("craft"), recipe: Ref }),
  /** Eat or drink an item. */
  z.object({ type: z.literal("eat"), item: Ref }),
  /** Place a block. */
  z.object({ type: z.literal("place"), block: Ref }),
  /** Breed two of this mob. */
  z.object({ type: z.literal("breed"), mob: Ref }),
  /** Tame a mob of this type. */
  z.object({ type: z.literal("tame"), mob: Ref }),
]);
export type Criterion = z.infer<typeof Criterion>;
export const CRITERION_TYPES = ["obtain", "kill", "visit", "craft", "eat", "place", "breed", "tame"] as const;

export const AdvancementFrame = z.enum(["task", "goal", "challenge"]);

/**
 * A vanilla advancement. One without a parent starts its own tab in the advancements screen;
 * the rest hang under their parent, so a chain of them makes a tree.
 */
export const AdvancementSpecSchema = z.object({
  kind: z.literal("advancement"),
  $schema: z.string().optional(),
  id: LocalId,
  /** The title shown on the advancement. */
  name: z.string().min(1),
  advancement: z.object({
    /** The advancement it unlocks after: an id from this mod, or a vanilla one like `minecraft:story/mine_stone`. Empty starts a new tab. */
    parent: Ref.optional(),
    description: z.string().default(""),
    /** Item shown on the advancement. */
    icon: Ref,
    /** `task` is a plain square, `goal` rounded and `challenge` spiky with a purple title. */
    frame: AdvancementFrame.default("task"),
    /** For a tab's first advancement: a 16x16 texture tiled behind the tab. Defaults to vanilla stone. */
    background: z.string().optional(),
    criteria: z.array(Criterion).min(1, "Add at least one criterion"),
    /** Done when every criterion is met, or when any one is. */
    requires: z.enum(["all", "any"]).default("all"),
    /** Pop up a toast and post in chat when it is earned. */
    announce: z.boolean().default(true),
    /** Not shown until it is earned. */
    hidden: z.boolean().default(false),
    rewards: z
      .object({
        experience: z.number().int().min(0).max(100000).default(0),
        items: z.array(z.object({ item: Ref, count: z.number().int().min(1).max(99).default(1) })).default([]),
        /** Recipes unlocked in the recipe book. */
        recipes: z.array(Ref).default([]),
      })
      .default({ experience: 0, items: [], recipes: [] }),
  }),
});
export type AdvancementSpec = z.infer<typeof AdvancementSpecSchema>;

/** How a structure meets the ground around it, as vanilla names it. */
export const TerrainAdaptation = z.enum(["none", "beard_thin", "beard_box", "bury", "encapsulate"]);

/**
 * A building or ruin saved with a structure block, placed in the world as it generates. One `.nbt` file makes one
 * structure; it spawns in the listed biomes about every `spacing` chunks.
 */
export const StructureSpecSchema = z.object({
  kind: z.literal("structure"),
  $schema: z.string().optional(),
  id: LocalId,
  name: z.string().min(1),
  structure: z.object({
    /** The `.nbt` file a structure block saved, copied into the project. */
    file: z.string(),
    /** Biomes it can start in: ids from this mod, vanilla ids or biome tags like `#minecraft:is_forest`. */
    biomes: z.array(Ref).min(1, "List at least one biome"),
    /** Average distance between two of them, in chunks. Villages use 34, igloos 32. */
    spacing: z.number().int().min(2).max(4096).default(32),
    /** Smallest distance between two of them, in chunks. Must be less than spacing. */
    separation: z.number().int().min(0).max(4095).default(8),
    /** `surface` sits on the ground, `fixed` at an exact height (for something buried or in the sky). */
    placement: z.enum(["surface", "fixed"]).default("surface"),
    /** Blocks up or down from the ground for `surface`, or the Y level for `fixed`. */
    y: z.number().int().min(-64).max(320).default(0),
    /** `beard_thin` fills in under it and clears above like a village house; `bury` sinks it into terrain. */
    terrain: TerrainAdaptation.default("beard_thin"),
  }),
});
export type StructureSpec = z.infer<typeof StructureSpecSchema>;

/**
 * A sound event made from `.ogg` files: each time it plays, one of the files is picked by weight. Mobs and other
 * specs name it by id, and `/playsound <modid>:<id>` plays it.
 */
export const SoundSpecSchema = z.object({
  kind: z.literal("sound"),
  $schema: z.string().optional(),
  id: LocalId,
  /** The subtitle shown when subtitles are on, like "Bluetusk grunts". */
  name: z.string().min(1),
  sound: z.object({
    files: z
      .array(
        z.object({
          /** An Ogg Vorbis file. Mono files fade with distance; stereo ones play at the same volume everywhere. */
          file: z.string(),
          volume: z.number().min(0).max(1).default(1),
          pitch: z.number().min(0.5).max(2).default(1),
          /** How often this file is picked compared with the others. */
          weight: z.number().int().min(1).max(100).default(1),
        }),
      )
      .min(1, "Add at least one .ogg file"),
    /** Stream it from disk instead of loading it whole, for music and other long sounds. */
    stream: z.boolean().default(false),
  }),
});
export type SoundSpec = z.infer<typeof SoundSpecSchema>;

/** Attributes an effect can change while it lasts, by their vanilla names. */
export const EFFECT_ATTRIBUTES = [
  "movement_speed", "attack_damage", "attack_speed", "armor", "armor_toughness", "max_health", "knockback_resistance",
  "jump_strength", "safe_fall_distance", "gravity", "scale", "step_height", "luck", "block_break_speed", "mining_efficiency",
  "oxygen_bonus", "water_movement_efficiency", "block_interaction_range", "entity_interaction_range", "burning_time",
  "fall_damage_multiplier", "max_absorption", "sneaking_speed",
] as const;

/** Vanilla 26.3 status effects, for food effects and suggestions. */
export const VANILLA_EFFECTS = [
  "absorption", "bad_omen", "blindness", "breath_of_the_nautilus", "conduit_power", "darkness", "dolphins_grace",
  "fire_resistance", "glowing", "haste", "health_boost", "hero_of_the_village", "hunger", "infested", "instant_damage",
  "instant_health", "invisibility", "jump_boost", "levitation", "luck", "mining_fatigue", "nausea", "night_vision", "oozing",
  "poison", "raid_omen", "regeneration", "resistance", "saturation", "slow_falling", "slowness", "speed", "strength",
  "trial_omen", "unluck", "water_breathing", "weakness", "weaving", "wind_charged", "wither",
] as const;

/** Brewing stand ingredients vanilla already brews into an awkward potion. */
export const VANILLA_AWKWARD_INGREDIENTS = [
  "blaze_powder", "breeze_rod", "cobweb", "ghast_tear", "glistering_melon_slice", "golden_carrot", "magma_cream",
  "phantom_membrane", "pufferfish", "rabbit_foot", "slime_block", "spider_eye", "stone", "sugar", "turtle_helmet",
] as const;

/** Brewing stand ingredients that change any potion (longer, stronger, splash, lingering, corrupted). */
export const POTION_MODIFIERS = ["nether_wart", "redstone", "glowstone_dust", "gunpowder", "dragon_breath", "fermented_spider_eye"] as const;

/**
 * A status effect: an icon in the inventory and HUD, particles in its color and attribute changes while it lasts.
 * With a potion, it can be brewed from an awkward potion, then made longer, stronger, splash and lingering.
 */
export const EffectSpecSchema = z.object({
  kind: z.literal("effect"),
  $schema: z.string().optional(),
  id: LocalId,
  /** Shown in the inventory and on potions, like "Grove Sight". */
  name: z.string().min(1),
  effect: z.object({
    /** Beneficial effects show blue in tooltips, harmful ones red; milk clears both. */
    category: z.enum(["beneficial", "harmful", "neutral"]).default("beneficial"),
    /** Particle and potion color. */
    color: Hex.default("#6ab0ff"),
    /** An 18x18 picture shown in the inventory and in the corner of the screen. */
    icon: z.string(),
    /** Attribute changes. Each level of the effect adds the amount again. */
    modifiers: z
      .array(
        z.object({
          attribute: z.enum(EFFECT_ATTRIBUTES),
          amount: z.number(),
          /** add: plus the amount. multiply_base: plus amount x the base value. multiply_total: times (1 + amount). */
          operation: z.enum(["add", "multiply_base", "multiply_total"]).default("add"),
        }),
      )
      .default([]),
    potion: z
      .object({
        /** Brewed into an awkward potion to make it. */
        ingredient: Ref,
        /** How long the plain potion lasts. Vanilla potions use 180 seconds. */
        seconds: z.number().int().min(1).max(86400).default(180),
        /** Add redstone for a version that lasts 8/3 as long. */
        longer: z.boolean().default(true),
        /** Add glowstone dust for level II at half the time. */
        stronger: z.boolean().default(false),
      })
      .optional(),
  }),
});
export type EffectSpec = z.infer<typeof EffectSpecSchema>;

/** A number that grows with the enchantment level: `amount` at level I, plus `perLevel` for each level above. */
const Scaling = { amount: z.number().default(1), perLevel: z.number().default(1) };

/** What an enchantment does, picked from vanilla's building blocks. */
export const EnchantmentEffect = z.discriminatedUnion("type", [
  /** Extra melee damage, like Sharpness (1 + 0.5 a level). Optionally only against one mob or an entity tag. */
  z.object({ type: z.literal("damage"), ...Scaling, against: Ref.optional() }),
  /** Less damage taken, like Protection: each point is about 4%. */
  z.object({ type: z.literal("protection"), ...Scaling }),
  /** Extra knockback on hit, like Knockback. */
  z.object({ type: z.literal("knockback"), ...Scaling }),
  /** Sets the target on fire for some seconds, like Fire Aspect (4 + 4 a level). */
  z.object({ type: z.literal("ignite"), ...Scaling }),
  /** Gives the target a status effect for some seconds, like Bane of Arthropods' slowness. */
  z.object({ type: z.literal("effect_on_hit"), ...Scaling, effect: Ref, amplifier: z.number().int().min(0).max(255).default(0) }),
  /** Changes an attribute while the item is in its slot, like Swift Sneak. */
  z.object({
    type: z.literal("attribute"),
    ...Scaling,
    attribute: z.enum(EFFECT_ATTRIBUTES),
    operation: z.enum(["add", "multiply_base", "multiply_total"]).default("add"),
  }),
]);
export type EnchantmentEffect = z.infer<typeof EnchantmentEffect>;

export const EnchantmentSlot = z.enum(["mainhand", "offhand", "hand", "head", "chest", "legs", "feet", "armor", "body", "any"]);

/**
 * An enchantment, written as a data file like vanilla's: which items take it, its levels, how rare it is and what it
 * does. Ones that aren't treasure show up in the enchanting table, in loot and in librarian trades.
 */
export const EnchantmentSpecSchema = z.object({
  kind: z.literal("enchantment"),
  $schema: z.string().optional(),
  id: LocalId,
  /** Shown on the item, like "Lurker's Bane". */
  name: z.string().min(1),
  enchantment: z.object({
    /** Items it can go on in an anvil: an item tag like `#minecraft:enchantable/sharp_weapon`, or one item. */
    items: Ref.default("#minecraft:enchantable/sharp_weapon"),
    /** Items the enchanting table offers it on. Defaults to the same as items. */
    tableItems: Ref.optional(),
    /** Where the item has to be for it to work. */
    slots: z.array(EnchantmentSlot).min(1, "Pick at least one slot").default(["mainhand"]),
    maxLevel: z.number().int().min(1).max(255).default(1),
    /** How often it comes up compared with others: Sharpness 10, Fire Aspect 2, Mending 2, Silk Touch 1. */
    weight: z.number().int().min(1).max(1024).default(5),
    /** Levels an anvil charges per enchantment level. Sharpness 1, Fire Aspect 4. */
    anvilCost: z.number().int().min(0).max(255).default(2),
    /** Enchanting cost range at level I and how much it grows each level. Sharpness: 1-21, +11 a level. */
    minCost: z.object({ base: z.number().int().default(1), perLevel: z.number().int().default(11) }).default({ base: 1, perLevel: 11 }),
    maxCost: z.object({ base: z.number().int().default(21), perLevel: z.number().int().default(11) }).default({ base: 21, perLevel: 11 }),
    /** Only from loot and trades, never the enchanting table, like Mending. */
    treasure: z.boolean().default(false),
    /** Shown in red and can't be removed with a grindstone, like Curse of Binding. */
    curse: z.boolean().default(false),
    /** Enchantments it can't be combined with: ids from this mod, vanilla ids or a tag like `#minecraft:exclusive_set/damage`. */
    exclusiveWith: z.array(Ref).default([]),
    effects: z.array(EnchantmentEffect).default([]),
  }),
});
export type EnchantmentSpec = z.infer<typeof EnchantmentSpecSchema>;

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
  AdvancementSpecSchema,
  StructureSpecSchema,
  SoundSpecSchema,
  EffectSpecSchema,
  EnchantmentSpecSchema,
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
  advancement: "advancements",
  structure: "structures",
  sound: "sounds",
  effect: "effects",
  enchantment: "enchantments",
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
  advancement: AdvancementSpecSchema,
  structure: StructureSpecSchema,
  sound: SoundSpecSchema,
  effect: EffectSpecSchema,
  enchantment: EnchantmentSpecSchema,
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

/** Each shape a spec can have: its key in `shapes`, its id suffix and its name suffix. */
export const SHAPES = [
  ["stairs", "stairs", "Stairs"],
  ["slab", "slab", "Slab"],
  ["wall", "wall", "Wall"],
  ["fence", "fence", "Fence"],
  ["fenceGate", "fence_gate", "Fence Gate"],
  ["door", "door", "Door"],
  ["trapdoor", "trapdoor", "Trapdoor"],
  ["button", "button", "Button"],
  ["pressurePlate", "pressure_plate", "Pressure Plate"],
] as const;
export type ShapeKind = (typeof SHAPES)[number][0];

export interface ShapeBlock {
  shape: ShapeKind;
  id: string;
  name: string;
}

/** The id and name shapes start from: `azurite_bricks` makes `azurite_brick_stairs`, `ruby_block` makes `ruby_stairs`. */
function shapeBase(spec: BlockSpec | TreeSpec): { id: string; name: string } {
  if (spec.kind === "tree") return { id: spec.id, name: spec.name };
  return {
    id: spec.id.replace(/_block$/, "").replace(/(brick|tile)s$/, "$1"),
    name: spec.name.replace(/ Block$/, "").replace(/(Brick|Tile)s$/, "$1"),
  };
}

/** The shape blocks a block or tree spec adds, in a fixed order. */
export function shapeBlocks(spec: ElementSpec): ShapeBlock[] {
  if (spec.kind !== "block" && spec.kind !== "tree") return [];
  const base = shapeBase(spec);
  return SHAPES.filter(([key]) => !!spec.shapes[key]).map(([shape, suffix, label]) => ({
    shape,
    id: `${base.id}_${suffix}`,
    name: `${base.name} ${label}`,
  }));
}

const titleCase = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * Every item a spec registers, as `[id, display name]`. Most specs register one item with their own id;
 * armor, trees and mobs register several.
 */
export function registeredItems(spec: ElementSpec): [string, string][] {
  switch (spec.kind) {
    case "block":
      return [...(spec.hasItem ? [[spec.id, spec.name] as [string, string]] : []), ...shapeBlocks(spec).map((b): [string, string] => [b.id, b.name])];
    case "item":
    case "tool":
    case "plant":
      return [[spec.id, spec.name]];
    case "armor":
      return ARMOR_PIECES.filter((p) => spec.armor.pieces[p]).map((p) => [`${spec.id}_${p}`, `${spec.name} ${titleCase(p)}`]);
    case "tree":
      return [
        ...TREE_PARTS.map(([suffix, label]): [string, string] => [`${spec.id}_${suffix}`, `${spec.name} ${label}`]),
        ...shapeBlocks(spec).map((b): [string, string] => [b.id, b.name]),
      ];
    case "mob":
      return [[`${spec.id}_spawn_egg`, `${spec.name} Spawn Egg`]];
    default:
      return [];
  }
}

/** Where an item's inventory icon comes from: one flat texture, or a cube's top and side textures (project-relative paths). */
export type ItemIconArt = { kind: "flat"; texture: string } | { kind: "cube"; top: string; side: string };

/** The inventory icon art for an item `id` registered by `spec`, or null when it has none the tool can draw. */
export function itemIconArt(spec: ElementSpec, id: string): ItemIconArt | null {
  const flat = (texture: string): ItemIconArt => ({ kind: "flat", texture });
  const shape = shapeBlocks(spec).find((b) => b.id === id);
  if (shape && (spec.kind === "block" || spec.kind === "tree")) {
    if (shape.shape === "door") return flat(spec.shapes.door!.icon);
    if (shape.shape === "trapdoor") return flat(spec.shapes.trapdoor!);
    if (spec.kind === "tree") return { kind: "cube", top: spec.tree.planks, side: spec.tree.planks };
  }
  switch (spec.kind) {
    case "item":
      return flat(spec.item.texture);
    case "tool":
      return flat(spec.tool.texture);
    case "plant":
      return flat(spec.plant.texture);
    case "block": {
      const m = spec.block.model;
      if (m.type === "cube_all") return { kind: "cube", top: m.texture, side: m.texture };
      if (m.type === "cube_column") return { kind: "cube", top: m.end, side: m.side };
      return null;
    }
    case "armor": {
      const piece = ARMOR_PIECES.find((p) => id === `${spec.id}_${p}`);
      const texture = piece && spec.armor.pieces[piece];
      return texture ? flat(texture) : null;
    }
    case "tree": {
      const t = spec.tree;
      if (id === `${spec.id}_log`) return { kind: "cube", top: t.logEnd, side: t.logSide };
      if (id === `${spec.id}_planks`) return { kind: "cube", top: t.planks, side: t.planks };
      if (id === `${spec.id}_leaves`) return { kind: "cube", top: t.leaves, side: t.leaves };
      if (id === `${spec.id}_sapling`) return flat(t.sapling);
      return null;
    }
    case "mob":
      return id === `${spec.id}_spawn_egg` ? flat(spec.mob.spawnEgg) : null;
    default:
      return null;
  }
}

/** Every block a spec registers. */
export function registeredBlocks(spec: ElementSpec): string[] {
  if (spec.kind === "block") return [spec.id, ...shapeBlocks(spec).map((b) => b.id)];
  if (spec.kind === "plant") return [spec.id];
  if (spec.kind === "tree") return [...TREE_PARTS.map(([suffix]) => `${spec.id}_${suffix}`), ...shapeBlocks(spec).map((b) => b.id)];
  return [];
}
