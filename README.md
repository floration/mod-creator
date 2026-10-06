# Mod Creator

A desktop tool for building Minecraft 26.3+ Fabric mods with forms, previews and plain files instead of hand-written registration code.

Every block, item, tool, armor set, recipe, ore vein, tree, plant, mob and biome is one small JSON file in the mod's `spec/` folder. The app is an editor for those files. A generator turns them into Java and resource files in `src/generated/`, and the mod stays a normal Gradle project you can open in IntelliJ at any time.

Design doc: [Mod Creator Architecture](https://claude.ai/code/artifact/ab83630b-aecd-4450-b781-0d67d2fd176f)

## What you need

| Tool | Why |
| --- | --- |
| Node.js 22 LTS or newer | Runs the app, the generator and the CLI |
| JDK 25 (Eclipse Temurin) | Compiles mods for Minecraft 26.3 |
| IntelliJ IDEA with the Minecraft Development plugin | Optional, for editing Java by hand |
| Blockbench | Optional, for textures and models |

Gradle doesn't need installing: each mod project ships the Gradle 9.6.0 wrapper.

## Quick start

```sh
npm install
npm run build
npm test

# Open the app on the example mod
npm run app -- --project ../../examples/ruby
```

`--project` is relative to `packages/app`. Without it, the app reopens the last project or shows the welcome screen.

From the app:

- **Save** (Ctrl+S) writes the spec file and regenerates `src/generated/`.
- **Build** runs `gradlew build`. The mod jar lands in `build/libs/`.
- **Run client** runs `gradlew runClient`, Loom's dev client with its own `run/` folder.
- Problems (bad fields, broken references, missing textures) appear in the Problems panel and next to the field.

Edits made in other editors show up in the app, which watches `spec/`, `art/` and `modcreator.json`.

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
    worldgen/<id>.json     ore veins
    trees/<id>.json        a wood type: log, planks, leaves, sapling and the tree it grows
    plants/<id>.json       grass-like plants
    mobs/<id>.json         animals on the vanilla pig or cow body
    biomes/<id>.json       Overworld biomes
  art/                     textures (PNG)
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

Two example mods show every supported field:

- [`examples/ruby`](examples/ruby): an ore that drops gems with Fortune, a storage block, a lamp with a custom Java class, a gem item, shaped, shapeless and smelting recipes, and a ruby ore vein that generates between Y -16 and 48.
- [`examples/azuregrove`](examples/azuregrove): one of each of the other kinds. Azurite ore and bricks, the Azure Plum food, an Azurite Sword and armor set, the Azurewood tree (fancy oak shape, its leaves drop plums), Azure Grass, the Bluetusk (a blue pig that eats plums), and the Azure Grove biome, which takes over part of Plains and Forest and grows all of them.

### Biomes

Biomes are placed with the [Biolith](https://modrinth.com/mod/biolith) library, which turns a share of a vanilla Overworld biome into yours through a data file, so no code touches world generation. A project with a biome needs Biolith in `modcreator.json`'s `dependencies` (see Azure Grove); `check` warns when it is missing. A biome keeps vanilla's caves, ores, lakes and monsters and adds its own colors, trees, plants and creatures.

### Mobs

A mob borrows the vanilla pig or cow model and animations, with your own 64x64 texture in the same layout as the vanilla one. It wanders, panics when hurt, follows players holding its food, breeds with that food and has a spawn egg. Its renderer is registered by the generated `ModContentClient`, so `fabric.mod.json` lists that class as the `client` entrypoint (new projects already do).

### Recipes

The recipe editor is a crafting table: pick an item from the list under it and click slots to place it, or drag it in, and right-click a slot to empty it. Furnace, blast furnace, smoker and campfire recipes show one input slot. Each slot shows the item's icon and name. This mod's items use their art files; Minecraft's items, names and tags are read from your own Minecraft 26.3 jar (Loom's cache after the first Build, or Prism or the official launcher's copy), so nothing from Mojang ships with the tool. If none is found, the item list has a link to choose the jar. The spec file still stores the usual `pattern` and `key`, so hand edits keep working.

## Repository layout

| Path | What it is |
| --- | --- |
| `packages/core` | Zod schemas for specs, the project loader and checks, and the generator |
| `packages/core/src/profiles/v26_3` | Templates for Minecraft 26.3: Java registration, resource JSON, Gradle files |
| `packages/core/profiles/26.3/wrapper` | Gradle 9.6.0 wrapper copied into new projects |
| `packages/cli` | `modcreator new`, `generate` and `check` |
| `packages/app` | Electron app: React forms, three.js preview, Gradle runner |
| `examples/ruby`, `examples/azuregrove` | Example mods, also used by the generator snapshot tests |

## Toolchain pinned by the 26.3 profile

Minecraft 26.3, Fabric Loader 0.19.5, Fabric Loom 1.18.2 (`net.fabricmc.fabric-loom`), Fabric API 0.161.0+26.3, Java 25, Gradle 9.6.0. Minecraft 26.x is unobfuscated, so there is no mappings line and dependencies use `implementation`.

## Status

Milestones 2 and 3 of the design doc are in: the project skeleton, blocks, items and recipes. So are ore veins, food, tools, armor, trees, plants, mobs on vanilla bodies and biomes. Next up: mobs with their own Blockbench models.
