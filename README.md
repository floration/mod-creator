# Mod Creator

A desktop tool for building Minecraft 26.3+ Fabric mods with forms, previews and plain files instead of hand-written registration code.

Every block, item, recipe and ore vein is one small JSON file in the mod's `spec/` folder. The app is an editor for those files. A generator turns them into Java and resource files in `src/generated/`, and the mod stays a normal Gradle project you can open in IntelliJ at any time.

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
    items/<id>.json
    recipes/<id>.json
    worldgen/<id>.json     ore veins
  art/                     textures (16x16 PNG)
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

See [`examples/ruby`](examples/ruby) for every supported field: an ore that drops gems with Fortune, a storage block, a lamp with a custom Java class, a gem item, shaped, shapeless and smelting recipes, and a ruby ore vein that generates between Y -16 and 48.

## Repository layout

| Path | What it is |
| --- | --- |
| `packages/core` | Zod schemas for specs, the project loader and checks, and the generator |
| `packages/core/src/profiles/v26_3` | Templates for Minecraft 26.3: Java registration, resource JSON, Gradle files |
| `packages/core/profiles/26.3/wrapper` | Gradle 9.6.0 wrapper copied into new projects |
| `packages/cli` | `modcreator new`, `generate` and `check` |
| `packages/app` | Electron app: React forms, three.js preview, Gradle runner |
| `examples/ruby` | Example mod, also used by the generator snapshot test |

## Toolchain pinned by the 26.3 profile

Minecraft 26.3, Fabric Loader 0.19.5, Fabric Loom 1.18.2 (`net.fabricmc.fabric-loom`), Fabric API 0.161.0+26.3, Java 25, Gradle 9.6.0. Minecraft 26.x is unobfuscated, so there is no mappings line and dependencies use `implementation`.

## Status

Milestones 2 and 3 of the design doc are in: the project skeleton, blocks, items and recipes. Ore veins from milestone 5 are in too. Next up: mobs from Blockbench models, then biomes.
