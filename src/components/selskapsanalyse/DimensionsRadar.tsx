type Dim = { label: string; score: number | null };

type Props = {
  dimensions?: Dim[];
  ariaLabel?: string;
};

const SAMPLE: Dim[] = [
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

export function DimensionsRadar({ dimensions, ariaLabel }: Props = {}) {
  const data: Dim[] = dimensions && dimensions.length > 0 ? dimensions : SAMPLE;
  const total = data.length;
  const rings = [1, 2, 3, 4, 5];

  // For polygon: behandle null som 0 (men tegn stiplet linje)
  const polygonPoints = data
    .map((d, i) => {
      const v = d.score ?? 0;
      const p = pointFor(i, v, total);
      return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    })
    .join(" ");
  const hasNull = data.some((d) => d.score == null);

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={
        ariaLabel ??
        "Radardiagram som viser score på arbeidsgiver-dimensjoner"
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

      <polygon
        points={polygonPoints}
        fill="currentColor"
        fillOpacity={0.18}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeDasharray={hasNull ? "6 4" : undefined}
        className="text-primary"
      />

      {data.map((d, i) => {
        const v = d.score ?? 0;
        const p = pointFor(i, v, total);
        return (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={3}
            fill="currentColor"
            className={d.score == null ? "text-muted-foreground" : "text-primary"}
          />
        );
      })}

      {data.map((d, i) => {
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
