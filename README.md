# Mod Creator

A desktop tool for building Minecraft 26.3+ Fabric mods with forms, previews and plain files instead of hand-written registration code.

Every block, item, tool, armor set, recipe, ore vein, tree, plant, mob, biome, structure, sound and quest is one small JSON file in the mod's `spec/` folder. The app is an editor for those files. A generator turns them into Java and resource files in `src/generated/`, and the mod stays a normal Gradle project you can open in IntelliJ at any time.

Design doc: [Mod Creator Architecture](https://claude.ai/code/artifact/ab83630b-aecd-4450-b781-0d67d2fd176f)

## What you need

| Tool | Why |
| --- | --- |
| Node.js 22 LTS or newer | Runs the app, the generator and the CLI |
| JDK 25 (Eclipse Temurin) | Compiles mods for Minecraft 26.3 |
| IntelliJ IDEA with the Minecraft Development plugin | Optional, for editing Java by hand |
| Blockbench | Optional, for textures and models |

Gradle doesn't need installing: each mod project ships the Gradle 9.7.0 wrapper.

## Quick start

```sh
npm install
npm run build
npm test

# Open the app on the example mod
npm run app -- --project ../../examples/ruby
```

`npm run app`, or double-clicking `Mod Creator.cmd` on Windows, updates the tool before it opens: it pulls `main` from GitHub, reinstalls packages if they changed, rebuilds, then starts the app. It skips the update when you're offline, on another branch, or have uncommitted changes to the tool's code, and `npm run app -- --no-update` skips it on purpose. Your mod projects are never touched by this.

`--project` is relative to `packages/app`. Without it, the app reopens the last project or shows the welcome screen.

From the app:

- **Save** (Ctrl+S) writes the spec file and regenerates `src/generated/`.
- **Build** runs `gradlew build`. The mod jar lands in `build/libs/`.
- **Run client** runs `gradlew runClient`, Loom's dev client with its own `run/` folder.
- **Edit** (or **Draw**, for a texture that doesn't exist yet) next to any texture opens the pixel editor: pencil, eraser, fill, color picker, mirror, undo. Saving writes the PNG in `art/` and the 3D preview updates. Mob textures can show the model's parts on the sheet.
- **Tint** next to any texture makes it from another one through color masks, the way Factorio mods recolor sprites. Start from any Minecraft texture (read from your 26.3 jar, searchable), a PNG in `art/`, or the texture as it is, then add layers. Each layer has a color, a mode (**Recolor** keeps the shading and moves the average color to yours, **Multiply** is Factorio's tint, **Paint** is flat color), a strength and a mask that picks its pixels: the whole texture, colors you click, pixels that differ from another texture (a vanilla ore starts out masked against its stone, so only the ore changes), or a mask image. Saving bakes an ordinary PNG into `art/`, so the mod ships a real texture, and keeps the recipe next to it as `<name>.tint.json` so **Tint** can reopen and change it. The pixel editor has a **Tint…** button too, which applies the tint to the drawing (undoable).
- Problems (bad fields, broken references, missing textures) appear in the Problems panel and next to the field.
- **Duplicate** copies the open element under a new id. **Delete** removes its spec file, after listing any other specs that still point at it. Changing an element's **Id** and saving renames the file and updates the recipes, biomes, drops and repair items that used the old id, including derived ids like `ruby_helmet`; the Output panel lists what changed.
- The box above the element list filters by name or id.
- **Settings** in the toolbar edits `modcreator.json`: the mod's name, version, description, authors and Modrinth dependencies. Search Modrinth for a Fabric mod made for this Minecraft version and **Add** puts in its newest release; **Pick** next to a dependency lists its other builds. The mod id, Java package and Minecraft version are shown but fixed.

Edits made in other editors show up in the app, which watches `spec/`, `art/` and `modcreator.json`. If the file open in the form changes while you have unsaved edits, the app asks whether to keep your edits or load the file's version.

## Command line

```sh
node packages/cli/dist/index.js new ~/Documents/MinecraftMods/gems --id gems --name "Gems" --package dev.q.gems
node packages/cli/dist/index.js generate ~/Documents/MinecraftMods/gems
node packages/cli/dist/index.js check ~/Documents/MinecraftMods/gems
```

`new` also writes the CLI's path into the mod's `gradle.properties` as `modcreator_cli`. With that line, every `gradlew build`, including builds started from IntelliJ, regenerates `src/generated/` first, so hand edits to specs always reach the jar.

## A mod project

```
gems/
  modcreator.json          mod id, name, Java package, version profile
  spec/
    blocks/<id>.json       one file per block
    items/<id>.json        items, including food
    tools/<id>.json        swords, pickaxes, axes, shovels, hoes
    armor/<id>.json        an armor set (up to four pieces)
    recipes/<id>.json
    worldgen/<id>.json     ore veins, scattered ores, disks and geodes
    trees/<id>.json        a wood type: log, planks, leaves, sapling and the tree it grows
    plants/<id>.json       grass-like plants
    mobs/<id>.json         animals on the vanilla pig or cow body, or a Blockbench model
    biomes/<id>.json       Overworld biomes
    structures/<id>.json   buildings saved with a structure block, and where they spawn
    sounds/<id>.json       sound events made from .ogg files
    advancements/<id>.json quests, as vanilla advancements
  art/                     textures (PNG), Blockbench models (.bbmodel), structures (.nbt) and sounds (.ogg)
  src/main/                yours: never touched by the generator
  src/generated/           the generator's: rewritten on every run, do not edit
  build.gradle, settings.gradle, gradle.properties, gradlew
  .modcreator/schema/      JSON Schemas so IntelliJ and VS Code autocomplete specs
```

Rules the generator follows:

1. `src/generated/` is deleted and rewritten on every run.
2. Nothing in `src/main/` is overwritten. When a spec sets `customClass`, a starter Java class is created there once, and the generated registration uses it.
3. A hand-written file in `src/main/resources/` wins: the generator skips any resource whose path already exists there.
4. If any spec has errors, nothing is written.

`build.gradle` reads `modcreator.json` on every build, so the mod's `version` and its Modrinth `dependencies` take effect without editing Gradle files, and required dependencies are added to `depends` in the built jar's `fabric.mod.json`. Projects created before this keep their own `build.gradle`; `check` warns when one is missing a dependency, and copying `build.gradle` from a new project brings it up to date (also delete `mod_version` from `gradle.properties`).

Two example mods show every supported field:

- [`examples/ruby`](examples/ruby): an ore that drops gems with Fortune, a storage block, a lamp with a custom Java class, a gem item, shaped, shapeless and smelting recipes, a ruby ore vein that generates between Y -16 and 48, the Glowmoth, a tameable flying mob with its own Blockbench model whose wings flap, and a two-step quest tab (find a ruby, then tame a Glowmoth).
- [`examples/azuregrove`](examples/azuregrove): one of each of the other kinds. Azurite ore and bricks (with brick stairs, slab and wall), the Azure Plum food, a full set of Azurite tools (sword, pickaxe, axe, shovel and hoe) and armor, an azurite geode, the Azurewood tree (fancy oak shape, its leaves drop plums) and its full wood set, Azure Grass, the Bluetusk (a blue pig that eats plums, fights back and grunts with its own sound), the Grove Lurker (a hostile one that comes out at night), the Azure Grove biome, which takes over part of Plains and Forest and grows all of them, an Azure Grove quest tab with seven quests that use every kind of criterion and reward, and the Azure Shrine, a small azurite brick structure that spawns in the biome.

### Shapes and wood sets

A block with a `cube_all` or `cube_column` model can tick **Stairs**, **Slab**, **Wall**, **Fence**, **Fence gate**, **Button** and **Pressure plate** under **Shapes**, and a tree has the same list under **Wood set** for its planks. Each shape copies the base block's hardness, sound and tool, and comes with its vanilla recipe, loot, tags and block models (stone-like shapes also get stonecutter recipes). A door needs top and bottom half textures and an icon, and a trapdoor its own texture; transparent pixels make windows. Ids follow vanilla: `azurite_bricks` makes `azurite_brick_stairs` and `ruby_block` makes `ruby_stairs`. Wooden shapes open by hand and sound like oak; the rest act like stone.

### Biomes

An ore has a **Shape**, each one a vanilla feature: **blob** is an ordinary vein like iron, **scattered** spreads the same number of blocks out one by one like ancient debris, **disk** is a flat patch on river, lake and ocean floors like clay or sand, and **geode** is a hollow ball in layers like an amethyst geode, with the ore block as its inner layer, a shell and middle layer you pick, and an optional budding block that grows crystals. A vein whose **Skip chance next to air** is 1 is buried and never shows in caves, like buried diamonds. **Or one in this many chunks** makes rare ones (vanilla geodes are 1 in 24). **Start from vanilla** copies the shape, size, rarity and heights of any of the game's own ores, geodes and disks, read from your Minecraft jar so the list follows the game version; your blocks stay. The giant copper and iron veins are built into the game's terrain noise rather than data, so they can't be added this way.

Biomes are placed with the [Biolith](https://modrinth.com/mod/biolith) library, which turns a share of a vanilla Overworld biome into yours through a data file, so no code touches world generation. A project with a biome needs Biolith in `modcreator.json`'s `dependencies` (see Azure Grove); `check` warns when it is missing. A biome keeps vanilla's caves, ores, lakes and monsters and adds its own colors, trees, plants and creatures.

### Mobs

A mob either borrows the vanilla pig or cow model and animations, with your own 64x64 texture in the same layout as the vanilla one, or uses its own model from [Blockbench](https://www.blockbench.net/). Every mob has a spawn egg, and **Acts like** picks its behavior:

- `animal` wanders, runs when hurt, follows players holding its food and breeds with that food.
- `neutral` acts like an animal but fights back when hurt, and its herd joins in.
- `tameable` is tamed by feeding it (one try in three). Once tamed it follows its owner, fights what hurts them or what they hit, and sits or stands when they click it with an empty hand.
- `hostile` spawns in the dark like a zombie, hunts players and doesn't breed, so it needs no food. A biome lists it with its other spawns and the generator files it under monsters.

**Flies** makes any of them fly around like a parrot and skip fall damage. **Attack damage** sets how hard the fighting ones hit. The Bluetusk in `examples/azuregrove` is neutral, the Grove Lurker there is hostile, and the Glowmoth in `examples/ruby` is a tameable flyer.

For a Blockbench body, set **Body** to `blockbench` and point **Blockbench model** at a `.bbmodel` in `art/`. Make the model with Blockbench's **Modded Entity** format and **Box UV** (Minecraft entity models can't use per-face UV or meshes). Groups become the model's parts, rotated cubes get a part of their own, and the texture size comes from the project's resolution. An animation whose name contains `walk` plays while the mob moves and one containing `idle` loops all the time; keyframes must be plain numbers, not Molang. A part named `head` turns to look around. **Use the texture saved in the model** copies the texture embedded in the `.bbmodel` into `art/`, the pixel editor outlines every box on the sheet, and the 3D preview plays the animations (tick **Walking** to see the walk). The Glowmoth in `examples/ruby` is one. Its renderer is registered by the generated `ModContentClient`, so `fabric.mod.json` lists that class as the `client` entrypoint (new projects already do).

### Structures

Build something in **Run client**, save it with a structure block (Save mode; the structure name becomes the file name), then click **Import .nbt** on a structure and pick the file from the dev world's `generated/minecraft/structure/` folder under `run/saves/`. The file is copied into `art/`, and the 3D preview shows it with the blocks it uses. **Biomes** lists where it may spawn (this mod's biomes, vanilla ones or tags like `#minecraft:is_forest`), **Spacing** and **Separation** set how far apart they are in chunks, **Height** puts it on the ground or at a fixed Y, and **Terrain** picks how the ground meets it. In game, `/place structure <modid>:<id>` places one next to you.

The generator makes a one-piece jigsaw structure, like Minecraft's abandoned camps: the template, a start pool, the structure, a structure set and a `has_structure/<id>` biome tag. Blocks from this mod in the file have to exist in the project, or the check reports them.

### Sounds

A sound is one or more Ogg Vorbis files; each time it plays, one is picked by weight, at its own volume and pitch. **Import .ogg** copies a file into `art/` and ▶ plays it in the app. Make sounds that come from a place (a mob, a block) mono: stereo files play equally loud everywhere, and the check warns about them. The **Subtitle** shows when subtitles are on. A mob's ambient, hurt and death sounds can name a sound from this mod by id (the Bluetusk's `bluetusk_grunt`) or a vanilla one like `minecraft:entity.bee.loop`. In game, `/playsound <modid>:<id> master @s` plays it.

### Effects and potions

An effect has a name, a color for its particles and potions, an 18x18 icon and attribute changes while it lasts, such as 20% more speed (`movement_speed`, `multiply_total`, 0.2) or a higher step. Each level of the effect adds the change again. In game, `/effect give @s <modid>:<id>` gives it.

Tick **Can be brewed** for a potion. It is brewed by adding the ingredient to an awkward potion. Redstone makes a version that lasts 8/3 as long, and glowstone dust makes a level II version for half the time. Gunpowder and dragon's breath turn each one into splash and lingering potions, and lingering potions make tipped arrows. The generator writes the same brewing recipes vanilla has for its own potions. The check rejects ingredients that vanilla already brews from an awkward potion, such as sugar.

A food's **Effects when eaten** can give this mod's effects or vanilla ones like `minecraft:speed`, with a chance. The Azure Plum gives Grove Stride half the time and brews into a Potion of Grove Stride.

### Enchantments

Enchantments are data files, like vanilla's. **Goes on** takes an item tag such as `#minecraft:enchantable/sharp_weapon` or `#minecraft:enchantable/armor`, or one item. **Works while in** sets the slots it acts from. Each effect has a value at level I and an amount added per level, and the editor shows the value at each level. The effects are:
- extra damage, optionally only against one mob or an entity tag
- protection
- knockback
- setting the target on fire
- giving the target a status effect
- an attribute change while the item is in its slot

Enchantments that aren't treasure show up in the enchanting table, in loot and in librarian trades. Treasure ones show up only in loot and trades. Weight, anvil cost and enchanting power work like the vanilla numbers shown in the hints. **Can't be combined with** takes enchantment ids or a vanilla exclusive set like `#minecraft:exclusive_set/damage`. Lurker's Bane in Azure Grove does extra damage to the Grove Lurker and slows what it hits. In game, `/enchant @s <modid>:<id>` adds it.

### Quests

Quests are vanilla advancements, so they show in the game's advancements screen (L) with no extra mod. Each one has a title, a description, an icon, a frame (task, goal or challenge) and what completes it: obtaining items, killing, breeding or taming a mob, visiting a biome, crafting a recipe, eating something or placing a block. With several criteria, **Done when** picks whether all of them or any one is needed. Rewards are experience, items and recipes unlocked in the recipe book.

**Comes after** names the quest it unlocks after. A quest with nothing there starts its own tab, and can have a 16x16 **Tab background** tiled behind it. Next to the form, the quest line shows every tab as a tree; click a quest to open it. A quest can also hang under a vanilla one, like `minecraft:story/mine_stone`, to join Minecraft's own tabs.

### Recipes

The recipe editor is a crafting table: pick an item from the list under it and click slots to place it, or drag it in, and right-click a slot to empty it. Furnace, blast furnace, smoker and campfire recipes show one input slot. Each slot shows the item's icon and name. This mod's items use their art files; Minecraft's items, names and tags are read from your own Minecraft 26.3 jar (Loom's cache after the first Build, or Prism or the official launcher's copy), so nothing from Mojang ships with the tool. If none is found, the item list has a link to choose the jar. The spec file still stores the usual `pattern` and `key`, so hand edits keep working.

### Tags

Every field that takes a tag has a dropdown that filters as you type: an element's **Tags**, a structure's **Biomes**, an enchantment's **Goes on**, **Can't be combined with** and damage target, a mob's **Food**, and quest criteria. It lists Minecraft's tags (from the same jar as the recipe items), Fabric's shared `c:` tags such as `c:ingots/iron` (from the Fabric API jar in the Gradle cache, after the first Build), and the tags this mod already makes, with a look at what is in each. Arrow keys and Enter pick one; a name that isn't listed becomes a new tag of this mod's, and a `minecraft:` or `c:` tag that doesn't exist is marked red. The recipe picker's Tags tab lists the `c:` and mod item tags too.

## Repository layout

| Path | What it is |
| --- | --- |
| `packages/core` | Zod schemas for specs, the project loader and checks, and the generator |
| `packages/core/src/profiles/v26_3` | Templates for Minecraft 26.3: Java registration, resource JSON, Gradle files |
| `packages/core/profiles/26.3/wrapper` | Gradle 9.7.0 wrapper copied into new projects |
| `packages/cli` | `modcreator new`, `generate` and `check` |
| `packages/app` | Electron app: React forms, three.js preview, Gradle runner |
| `examples/ruby`, `examples/azuregrove` | Example mods, also used by the generator snapshot tests |

## Toolchain pinned by the 26.3 profile

Minecraft 26.3, Fabric Loader 0.19.5, Fabric Loom 1.18.2 (`net.fabricmc.fabric-loom`), Fabric API 0.161.0+26.3, Java 25, Gradle 9.7.0. Minecraft 26.x is unobfuscated, so there is no mappings line and dependencies use `implementation`.

## Status

Milestones 2 and 3 of the design doc are in: the project skeleton, blocks, items and recipes. So are ore veins, food, tools, armor, trees, plants, mobs (on vanilla bodies or Blockbench models) and biomes. Mobs can be animals, neutral, tameable or hostile, and fly. Blocks can have stairs, slabs, walls, fences, doors and other shapes, and trees a full wood set. Project settings, Modrinth search and quests (advancements, with a quest line view) structures from structure block files, sounds from .ogg files, and status effects with brewable potions and food effects, and enchantments are in the app. That completes phase 3 of the roadmap.
