# Tree parity check

The app's tree preview (`packages/core/src/treegen.ts`) is a port of Minecraft's tree generator. This folder
proves the port grows the same trees as the game.

`TreeParity.java` grows each config with the game's own trunk and foliage placers (the same steps as
`TreeFeature`, in open air on flat grass) for seeds 0 to n-1, using `LegacyRandomSource`. It saves a hash of
each tree's blocks to `packages/core/test/fixtures/vanilla-trees.json`, and `packages/core/test/treegen.test.ts`
checks that the preview grows identical trees for the same seeds.

Rerun it when a tree shape in `packages/core/src/trees.ts` changes or after moving to a new Minecraft version:

```sh
npm run build -w @modcreator/core
node scripts/tree-parity/configs.mjs > configs.json
# Classpath: the Minecraft jar (e.g. Loom's minecraft-merged.jar) plus the libraries the server jar bundles
# (META-INF/libraries inside minecraft-server.jar). Needs Java 25.
java -cp "<classpath>" scripts/tree-parity/TreeParity.java configs.json 40 packages/core/test/fixtures/vanilla-trees.json
```
