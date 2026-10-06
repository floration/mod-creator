# Tree shapes from the jar, and the parity check

`ExtractTrees.java` reads the vanilla tree shapes straight from the Minecraft jar (the game's own
`TreeFeatures`) and writes their trunk placer, foliage placer and minimum size to
`packages/core/src/profiles/v26_3/vanillaTrees.json`. The generator and the preview both use that file, so a new
Minecraft version's numbers come from rerunning it rather than from hand edits.

The app's tree preview (`packages/core/src/treegen.ts`) is a port of Minecraft's tree generator. This folder
proves the port grows the same trees as the game.

`TreeParity.java` grows each config with the game's own trunk and foliage placers (the same steps as
`TreeFeature`, in open air on flat grass) for seeds 0 to n-1, using `LegacyRandomSource`. It saves a hash of
each tree's blocks to `packages/core/test/fixtures/vanilla-trees.json`, and `packages/core/test/treegen.test.ts`
checks that the preview grows identical trees for the same seeds.

After moving to a new Minecraft version, run both. If a placer's code changed, the test fails and names the
shape whose preview needs updating in `treegen.ts`:

```sh
# Classpath: the Minecraft jar (e.g. Loom's minecraft-merged.jar) plus the libraries the server jar bundles
# (META-INF/libraries inside minecraft-server.jar). Needs Java 25.
java -cp "<classpath>" scripts/tree-parity/ExtractTrees.java packages/core/src/profiles/v26_3/vanillaTrees.json
npm run build -w @modcreator/core
node scripts/tree-parity/configs.mjs > configs.json
java -cp "<classpath>" scripts/tree-parity/TreeParity.java configs.json 40 packages/core/test/fixtures/vanilla-trees.json
```
