/**
 * Radar for arbeidsgiveranalyse V2.
 *
 * Forskjeller fra `src/components/selskapsanalyse/DimensionsRadar.tsx`:
 * - Ingen SAMPLE-fallback. Komponenten viser kun de dimensjonene som sendes inn.
 * - `score === null` tegnes ALDRI som 0 i polygonet. Akser uten score får
 *   etiketten "Ikke nok data" og inngår ikke som vertex i polygonet.
 * - Hvis færre enn 3 akser har score, tegnes ingen polygon i det hele tatt.
 *
 * Polygon-regel (K4-presisering): tegn fylt polygon KUN når alle åtte
 * dimensjoner har gyldig (number, ikke-NaN) score. Ellers vises akser,
 * ringer og tilgjengelige punkter, men ingen polygon — slik at en manglende
 * akse aldri kan tolkes som «koblet over null».
 */

export type RadarDim = { label: string; score: number | null };

/**
 * Eksportert ren hjelper for deterministisk testing.
 * Returnerer true bare når listen har nøyaktig REQUIRED_DIMENSIONS akser
 * og alle har en gyldig numerisk score.
 */
export const REQUIRED_DIMENSIONS = 8;

export function shouldDrawRadarPolygon(
  dimensions: ReadonlyArray<{ score: number | null | undefined }>,
): boolean {
  if (!Array.isArray(dimensions)) return false;
  if (dimensions.length !== REQUIRED_DIMENSIONS) return false;
  return dimensions.every(
    (d) => typeof d.score === "number" && !Number.isNaN(d.score),
  );
}

const MAX = 5;
const SIZE = 500;
const CENTER = SIZE / 2;
const RADIUS = 130;

function pointFor(index: number, value: number, total: number) {
  const angle = (Math.PI * 2 * index) / total - Math.PI / 2;
  const r = (value / MAX) * RADIUS;
  return {
    x: CENTER + r * Math.cos(angle),
    y: CENTER + r * Math.sin(angle),
  };
}

export function EmployerDimensionsRadarV2({
  dimensions,
  ariaLabel,
}: {
  dimensions: RadarDim[];
  ariaLabel?: string;
}) {
  const data = dimensions;
  const total = data.length;
  if (total === 0) return null;

  const rings = [1, 2, 3, 4, 5];
  const scoredVertices = data
    .map((d, i) => ({ d, i }))
    .filter((v) => typeof v.d.score === "number" && !Number.isNaN(v.d.score!));

  const polygonPoints =
    scoredVertices.length >= 3
      ? scoredVertices
          .map((v) => {
            const p = pointFor(v.i, v.d.score as number, total);
            return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
          })
          .join(" ")
      : null;

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={
        ariaLabel ?? "Radardiagram som viser score på arbeidsgiver-dimensjoner"
      }
      className="w-full h-auto"
    >
      {rings.map((ring) => {
        const pts = data
          .map((_, i) => {
            const p = pointFor(i, ring, total);
            return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
          })
          .join(" ");
        return (
          <polygon
            key={ring}
            points={pts}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.15}
            strokeWidth={1}
            className="text-muted-foreground"
          />
        );
      })}

      {data.map((_, i) => {
        const p = pointFor(i, MAX, total);
        return (
          <line
            key={i}
            x1={CENTER}
            y1={CENTER}
            x2={p.x}
            y2={p.y}
            stroke="currentColor"
            strokeOpacity={0.15}
            strokeWidth={1}
            className="text-muted-foreground"
          />
        );
      })}

      {polygonPoints && (
        <polygon
          points={polygonPoints}
          fill="currentColor"
          fillOpacity={0.18}
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          className="text-primary"
        />
      )}

      {data.map((d, i) => {
        if (typeof d.score !== "number" || Number.isNaN(d.score)) return null;
        const p = pointFor(i, d.score, total);
        return (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={3.5}
            fill="currentColor"
            className="text-primary"
          />
        );
      })}

      {data.map((d, i) => {
        const labelPos = pointFor(i, MAX + 0.85, total);
        const dx = labelPos.x - CENTER;
        const anchor = Math.abs(dx) < 1 ? "middle" : dx > 0 ? "start" : "end";
        const missing = typeof d.score !== "number" || Number.isNaN(d.score);
        return (
          <g key={i}>
            <text
              x={labelPos.x}
              y={labelPos.y}
              textAnchor={anchor}
              dominantBaseline="middle"
              className="fill-foreground"
              style={{ fontSize: 11, fontWeight: 500 }}
            >
              {d.label}
            </text>
            {missing && (
              <text
                x={labelPos.x}
                y={labelPos.y + 14}
                textAnchor={anchor}
                dominantBaseline="middle"
                className="fill-muted-foreground"
                style={{ fontSize: 10, fontStyle: "italic" }}
              >
                Ikke nok data
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
