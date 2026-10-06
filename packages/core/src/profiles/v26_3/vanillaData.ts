// Vanilla Minecraft 26.3 worldgen data the biome and tree generators build on, copied from the game's own
// data/minecraft/worldgen files (plains biome, tree features). Only ids and numbers: no assets.

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

/** Vanilla tree shapes, without their log and leaf blocks. */
export const TREE_SHAPES = {
  "oak": {
    "below_trunk_provider": "minecraft:soil_beneath_tree",
    "decorators": [],
    "foliage_placer": {
      "type": "minecraft:blob_foliage_placer",
      "height": 3,
      "offset": 0,
      "radius": 2
    },
    "ignore_vines": true,
    "minimum_size": {
      "type": "minecraft:two_layers_feature_size"
    },
    "trunk_placer": {
      "type": "minecraft:straight_trunk_placer",
      "base_height": 4,
      "height_rand_a": 2,
      "height_rand_b": 0
    }
  },
  "fancy_oak": {
    "below_trunk_provider": "minecraft:soil_beneath_tree",
    "decorators": [],
    "foliage_placer": {
      "type": "minecraft:fancy_foliage_placer",
      "height": 4,
      "offset": 4,
      "radius": 2
    },
    "ignore_vines": true,
    "minimum_size": {
      "type": "minecraft:two_layers_feature_size",
      "limit": 0,
      "min_clipped_height": 4,
      "upper_size": 0
    },
    "trunk_placer": {
      "type": "minecraft:fancy_trunk_placer",
      "base_height": 3,
      "height_rand_a": 11,
      "height_rand_b": 0
    }
  },
  "birch": {
    "below_trunk_provider": "minecraft:soil_beneath_tree",
    "decorators": [],
    "foliage_placer": {
      "type": "minecraft:blob_foliage_placer",
      "height": 3,
      "offset": 0,
      "radius": 2
    },
    "ignore_vines": true,
    "minimum_size": {
      "type": "minecraft:two_layers_feature_size"
    },
    "trunk_placer": {
      "type": "minecraft:straight_trunk_placer",
      "base_height": 5,
      "height_rand_a": 2,
      "height_rand_b": 0
    }
  },
  "spruce": {
    "below_trunk_provider": "minecraft:soil_beneath_tree",
    "decorators": [],
    "foliage_placer": {
      "type": "minecraft:spruce_foliage_placer",
      "offset": {
        "type": "minecraft:uniform",
        "max_inclusive": 2,
        "min_inclusive": 0
      },
      "radius": {
        "type": "minecraft:uniform",
        "max_inclusive": 3,
        "min_inclusive": 2
      },
      "trunk_height": {
        "type": "minecraft:uniform",
        "max_inclusive": 2,
        "min_inclusive": 1
      }
    },
    "ignore_vines": true,
    "minimum_size": {
      "type": "minecraft:two_layers_feature_size",
      "limit": 2,
      "upper_size": 2
    },
    "trunk_placer": {
      "type": "minecraft:straight_trunk_placer",
      "base_height": 5,
      "height_rand_a": 2,
      "height_rand_b": 1
    }
  },
  "acacia": {
    "below_trunk_provider": "minecraft:soil_beneath_tree",
    "decorators": [],
    "foliage_placer": {
      "type": "minecraft:acacia_foliage_placer",
      "offset": 0,
      "radius": 2
    },
    "ignore_vines": true,
    "minimum_size": {
      "type": "minecraft:two_layers_feature_size",
      "upper_size": 2
    },
    "trunk_placer": {
      "type": "minecraft:forking_trunk_placer",
      "base_height": 5,
      "height_rand_a": 2,
      "height_rand_b": 2
    }
  },
  "cherry": {
    "below_trunk_provider": "minecraft:soil_beneath_tree",
    "decorators": [],
    "foliage_placer": {
      "type": "minecraft:cherry_foliage_placer",
      "corner_hole_chance": 0.25,
      "hanging_leaves_chance": 0.16666667,
      "hanging_leaves_extension_chance": 0.33333334,
      "height": 5,
      "offset": 0,
      "radius": 4,
      "wide_bottom_layer_hole_chance": 0.25
    },
    "ignore_vines": true,
    "minimum_size": {
      "type": "minecraft:two_layers_feature_size",
      "upper_size": 2
    },
    "trunk_placer": {
      "type": "minecraft:cherry_trunk_placer",
      "base_height": 7,
      "branch_count": {
        "type": "minecraft:weighted_list",
        "distribution": [
          {
            "data": 1,
            "weight": 1
          },
          {
            "data": 2,
            "weight": 1
          },
          {
            "data": 3,
            "weight": 1
          }
        ]
      },
      "branch_end_offset_from_top": {
        "type": "minecraft:uniform",
        "max_inclusive": 0,
        "min_inclusive": -1
      },
      "branch_horizontal_length": {
        "type": "minecraft:uniform",
        "max_inclusive": 4,
        "min_inclusive": 2
      },
      "branch_start_offset_from_top": {
        "max_inclusive": -3,
        "min_inclusive": -4
      },
      "height_rand_a": 1,
      "height_rand_b": 0
    }
  }
} as const;
