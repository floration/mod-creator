import type { Draft } from "./forms";

const WORLD_MIN = -64;
const WORLD_MAX = 320;
const MARKS = [
  { y: 320, label: "Build limit (320)" },
  { y: 63, label: "Sea level (63)" },
  { y: 0, label: "Deepslate starts (0)" },
  { y: -64, label: "Bedrock (-64)" },
];

/** Side view of the world's height showing where an ore vein can generate and how its veins are spread. */
export function OrePreview({ draft }: { draft: Draft }) {
  const ore = draft.ore ?? {};
  const minY = Number(ore.minY ?? -64);
  const maxY = Number(ore.maxY ?? 64);
  const height = 560;
  const top = 24;
  const Y = (y: number) => top + ((WORLD_MAX - y) / (WORLD_MAX - WORLD_MIN)) * height;
  const x0 = 180;
  const width = 120;
  const lo = Y(Math.max(WORLD_MIN, minY));
  const hi = Y(Math.min(WORLD_MAX, maxY));
  const mid = (lo + hi) / 2;
  const triangle = ore.distribution === "triangle";

  return (
    <div className="ore-preview">
      <svg viewBox={`0 0 520 ${height + top * 2}`} role="img" aria-label="Where this ore generates">
        <rect x={x0} y={Y(WORLD_MAX)} width={width} height={Y(63) - Y(WORLD_MAX)} fill="#3a5a7a" opacity="0.35" />
        <rect x={x0} y={Y(63)} width={width} height={Y(0) - Y(63)} fill="#7d7d7d" opacity="0.35" />
        <rect x={x0} y={Y(0)} width={width} height={Y(WORLD_MIN) - Y(0)} fill="#4a4a52" opacity="0.6" />
        {maxY >= minY &&
          (triangle ? (
            <polygon points={`${x0},${lo} ${x0 + width},${mid} ${x0},${hi}`} fill="#d6455d" opacity="0.85" />
          ) : (
            <rect x={x0} y={hi} width={width} height={Math.max(2, lo - hi)} fill="#d6455d" opacity="0.85" />
          ))}
        {MARKS.map((m) => (
          <g key={m.y}>
            <line x1={x0 - 8} x2={x0 + width} y1={Y(m.y)} y2={Y(m.y)} stroke="#9a9ca3" strokeWidth="1" />
            <text x={x0 - 12} y={Y(m.y) + 4} textAnchor="end" fontSize="12" fill="#9a9ca3">{m.label}</text>
          </g>
        ))}
        <text x={x0 + width + 12} y={hi + 4} fontSize="13" fill="#e6e7ea">Y {maxY}</text>
        <text x={x0 + width + 12} y={lo + 4} fontSize="13" fill="#e6e7ea">Y {minY}</text>
      </svg>
      <p className="muted">
        {ore.veinsPerChunk ?? 4} veins per chunk, up to {ore.veinSize ?? 8} blocks each,{" "}
        {triangle ? "most common at the middle height" : "spread evenly between the two heights"}.
      </p>
    </div>
  );
}
