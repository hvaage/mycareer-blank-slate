const DIMENSJONER: { label: string; score: number }[] = [
  { label: "Kultur og verdier", score: 3.5 },
  { label: "Lederskap", score: 4.0 },
  { label: "Arbeidsmiljø", score: 4.0 },
  { label: "Karriere", score: 4.0 },
  { label: "Finansiell stab.", score: 5.0 },
  { label: "Misjon og formål", score: 3.5 },
  { label: "Talent", score: 4.5 },
  { label: "Mangfold", score: 3.5 },
];

const MAX = 5;
const SIZE = 500;
const CENTER = SIZE / 2;
const RADIUS = 110;

function pointFor(index: number, value: number, total: number) {
  const angle = (Math.PI * 2 * index) / total - Math.PI / 2;
  const r = (value / MAX) * RADIUS;
  return {
    x: CENTER + r * Math.cos(angle),
    y: CENTER + r * Math.sin(angle),
  };
}

export function DimensionsRadar() {
  const total = DIMENSJONER.length;
  const rings = [1, 2, 3, 4, 5];

  const polygonPoints = DIMENSJONER.map((d, i) => {
    const p = pointFor(i, d.score, total);
    return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  }).join(" ");

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label="Radardiagram fra en eksempelrapport som viser score på åtte arbeidsgiver-dimensjoner"
      className="w-full h-auto"
    >
      {rings.map((ring) => {
        const pts = DIMENSJONER.map((_, i) => {
          const p = pointFor(i, ring, total);
          return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
        }).join(" ");
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

      {DIMENSJONER.map((_, i) => {
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

      <polygon
        points={polygonPoints}
        fill="currentColor"
        fillOpacity={0.18}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        className="text-primary"
      />

      {DIMENSJONER.map((d, i) => {
        const p = pointFor(i, d.score, total);
        return (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={3}
            fill="currentColor"
            className="text-primary"
          />
        );
      })}

      {DIMENSJONER.map((d, i) => {
        const labelPos = pointFor(i, MAX + 0.9, total);
        const dx = labelPos.x - CENTER;
        const anchor =
          Math.abs(dx) < 1 ? "middle" : dx > 0 ? "start" : "end";
        return (
          <text
            key={i}
            x={labelPos.x}
            y={labelPos.y}
            textAnchor={anchor}
            dominantBaseline="middle"
            className="fill-foreground"
            style={{ fontSize: 11, fontWeight: 500 }}
          >
            {d.label}
          </text>
        );
      })}
    </svg>
  );
}
