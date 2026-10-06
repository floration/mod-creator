// Writes the tree configs the preview must match (packages/core trees.ts) as JSON for TreeParity.java: every
// vanilla shape, plus a few with a spec's tweaks applied. Run after `npm run build -w @modcreator/core`.
import { TREE_SHAPES, vanillaTreeConfig } from "../../packages/core/dist/trees.js";

export const TWEAKED = {
  // examples/azuregrove's Azurewood
  "fancy_oak+trunk4+rand6": { shape: "fancy_oak", trunkHeight: 4, trunkHeightRandom: 6 },
  "oak+radius3": { shape: "oak", leafRadius: 3 },
  "cherry+trunk10": { shape: "cherry", trunkHeight: 10 },
  "acacia+radius3+rand4": { shape: "acacia", leafRadius: 3, trunkHeightRandom: 4 },
};

const configs = {
  ...Object.fromEntries(Object.keys(TREE_SHAPES).map((shape) => [shape, vanillaTreeConfig({ shape })])),
  ...Object.fromEntries(Object.entries(TWEAKED).map(([name, tweaks]) => [name, vanillaTreeConfig(tweaks)])),
};
if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(JSON.stringify(configs, null, 2) + "\n");
