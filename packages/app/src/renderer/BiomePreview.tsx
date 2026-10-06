import type { Draft } from "./forms";

/** Vanilla's fallbacks when a biome leaves a color unset (grass and leaves really come from temperature and downfall). */
const DEFAULTS = { sky: "#78a7ff", fog: "#c0d8ff", water: "#3f76e4", waterFog: "#050533", grass: "#91bd59", foliage: "#77ab2f" };
const NAMES: Record<keyof typeof DEFAULTS, string> = { sky: "Sky", fog: "Fog", water: "Water", waterFog: "Underwater fog", grass: "Grass", foliage: "Leaves" };
const HEX = /^#[0-9a-fA-F]{6}$/;

/** A painted landscape in the biome's colors, with where it generates and what lives there. */
export function BiomePreview({ draft }: { draft: Draft }) {
  const biome = draft.biome ?? {};
  const set = biome.colors ?? {};
  const color = (k: keyof typeof DEFAULTS) => (HEX.test(set[k] ?? "") ? set[k] : DEFAULTS[k]);
  const trees: Draft[] = biome.trees ?? [];
  const plants: Draft[] = biome.plants ?? [];
  const spawns: Draft[] = biome.spawns ?? [];
  const replaces: Draft[] = biome.replaces ?? [];
  const treeCount = Math.min(9, trees.reduce((n, t) => n + Number(t.perChunk || 0), 0));
  const plantCount = Math.min(24, plants.reduce((n, t) => n + Number(t.patchesPerChunk || 0), 0) * 2);
  const snowy = Number(biome.temperature ?? 0.7) < 0.15;

  return (
    <div className="biome-preview">
      <svg className="biome-scene" viewBox="0 0 320 180" role="img" aria-label={`${draft.name ?? "Biome"} in its colors`}>
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color("sky")} />
            <stop offset="1" stopColor={color("fog")} />
          </linearGradient>
        </defs>
        <rect width="320" height="180" fill="url(#sky)" />
        <path d="M0 120 Q60 100 120 114 T240 108 T320 116 V180 H0Z" fill={snowy ? "#f4f8ff" : color("grass")} />
        <path d="M0 132 Q60 112 120 126 T240 120 T320 128 V180 H0Z" fill="#866043" opacity="0.9" />
        <ellipse cx="250" cy="150" rx="52" ry="12" fill={color("water")} />
        {Array.from({ length: plantCount }, (_, i) => {
          const x = 8 + ((i * 53) % 300);
          return <path key={`p${i}`} d={`M${x} 124 l2 -7 l2 7 l2 -5 l2 5`} stroke={color("grass")} strokeWidth="1.5" fill="none" style={{ filter: "brightness(0.8)" }} />;
        })}
        {Array.from({ length: treeCount }, (_, i) => {
          const x = 20 + ((i * 97) % 220);
          const h = 26 + ((i * 7) % 12);
          return (
            <g key={`t${i}`}>
              <rect x={x - 2} y={118 - h} width="4" height={h} fill="#5b4430" />
              <rect x={x - 12} y={104 - h} width="24" height="20" fill={color("foliage")} />
              <rect x={x - 7} y={98 - h} width="14" height="8" fill={color("foliage")} />
            </g>
          );
        })}
      </svg>
      <div className="swatches">
        {(Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]).map((k) => (
          <span key={k} className="swatch" title={HEX.test(set[k] ?? "") ? set[k] : "Vanilla default"}>
            <i style={{ background: color(k) }} />
            {NAMES[k]}
            {!HEX.test(set[k] ?? "") && " (default)"}
          </span>
        ))}
      </div>
      <p className="muted">
        {replaces.length > 0
          ? `Takes over ${replaces.map((r) => `${Math.round(Number(r.share || 0) * 100)}% of ${String(r.biome).replace("minecraft:", "")}`).join(" and ")}.`
          : "Pick at least one vanilla biome for it to take over."}
        {trees.length > 0 && ` Trees: ${trees.map((t) => t.tree).join(", ")}.`}
        {plants.length > 0 && ` Plants: ${plants.map((t) => t.plant).join(", ")}.`}
        {spawns.length > 0 && ` Creatures: ${spawns.map((s) => String(s.mob).replace("minecraft:", "")).join(", ")}.`}
      </p>
    </div>
  );
}
