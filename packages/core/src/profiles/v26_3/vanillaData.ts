// Vanilla Minecraft 26.3 worldgen data the biome and tree generators build on, copied from the game's own
// data/minecraft/worldgen files (plains biome). Tree shapes live in trees.ts. Only ids and numbers: no assets.

/** Index of the vegetal decoration step in a biome's feature list. */
export const VEGETATION_STEP = 9;

/**
 * Plains' features for every generation step except vegetation: lakes, geodes, dungeons, ores, springs and
 * freezing. Vegetation keeps only glow lichen, so a modded biome starts bare above ground.
 */
export const STANDARD_FEATURES: readonly (readonly string[])[] = [
  [],
  [
    "minecraft:lake_lava_underground",
    "minecraft:lake_lava_surface"
  ],
  [
    "minecraft:amethyst_geode"
  ],
  [
    "minecraft:monster_room",
    "minecraft:monster_room_deep"
  ],
  [],
  [],
  [
    "minecraft:ore_dirt",
    "minecraft:ore_gravel",
    "minecraft:ore_granite_upper",
    "minecraft:ore_granite_lower",
    "minecraft:ore_diorite_upper",
    "minecraft:ore_diorite_lower",
    "minecraft:ore_andesite_upper",
    "minecraft:ore_andesite_lower",
    "minecraft:ore_tuff",
    "minecraft:ore_coal_upper",
    "minecraft:ore_coal_lower",
    "minecraft:ore_iron_upper",
    "minecraft:ore_iron_middle",
    "minecraft:ore_iron_small",
    "minecraft:ore_gold",
    "minecraft:ore_gold_lower",
    "minecraft:ore_redstone",
    "minecraft:ore_redstone_lower",
    "minecraft:ore_diamond",
    "minecraft:ore_diamond_medium",
    "minecraft:ore_diamond_large",
    "minecraft:ore_diamond_buried",
    "minecraft:ore_lapis",
    "minecraft:ore_lapis_buried",
    "minecraft:ore_copper",
    "minecraft:underwater_magma",
    "minecraft:disk_sand",
    "minecraft:disk_clay",
    "minecraft:disk_gravel"
  ],
  [],
  [
    "minecraft:spring_water",
    "minecraft:spring_lava"
  ],
  [
    "minecraft:glow_lichen"
  ],
  [
    "minecraft:freeze_top_layer"
  ]
];

export const STANDARD_CARVERS = [
  "minecraft:cave",
  "minecraft:cave_extra_underground",
  "minecraft:canyon"
];

/** Plains' monsters, bats and glow squid. Creatures come from the biome spec. */
export const STANDARD_SPAWNS = {
  "ambient": [
    {
      "type": "minecraft:bat",
      "count": 8,
      "weight": 10
    }
  ],
  "monster": [
    {
      "type": "minecraft:spider",
      "count": 4,
      "weight": 100
    },
    {
      "type": "minecraft:zombie",
      "count": 4,
      "weight": 90
    },
    {
      "type": "minecraft:zombie_villager",
      "count": 1,
      "weight": 5
    },
    {
      "type": "minecraft:zombie_horse",
      "count": 1,
      "weight": 5
    },
    {
      "type": "minecraft:skeleton",
      "count": 4,
      "weight": 100
    },
    {
      "type": "minecraft:creeper",
      "count": 4,
      "weight": 100
    },
    {
      "type": "minecraft:slime",
      "count": 4,
      "weight": 100
    },
    {
      "type": "minecraft:enderman",
      "count": {
        "type": "minecraft:uniform",
        "max_inclusive": 4,
        "min_inclusive": 1
      },
      "weight": 10
    },
    {
      "type": "minecraft:witch",
      "count": 1,
      "weight": 5
    }
  ],
  "underground_water_creature": [
    {
      "type": "minecraft:glow_squid",
      "count": {
        "type": "minecraft:uniform",
        "max_inclusive": 6,
        "min_inclusive": 4
      },
      "weight": 10
    }
  ]
};
