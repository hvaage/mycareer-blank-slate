import * as React from "react";

/**
 * KarrierenMin logo — inline SVG, colored by default.
 * - variant="lockup" (default): K-merket + ordmerke "karrierenmin.no"
 * - variant="mark": Bare K-symbolet
 * - tone="color" (default): ink + blå "escape"-diagonal og blå «min»
 * - tone="dark": rent ink (mono)
 * - tone="white": for mørke flater
 *
 * Aldri som <img src>. Inline SVG sikrer riktige farger i alle byggere.
 */

export type LogoTone = "color" | "dark" | "white";
export type LogoVariant = "lockup" | "mark";

interface LogoProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: LogoVariant;
  tone?: LogoTone;
  className?: string;
}

function colors(tone: LogoTone) {
  if (tone === "white") {
    return { ink: "#FFFFFF", accent: "#FFFFFF", tld: 0.55 };
  }
  if (tone === "dark") {
    return { ink: "#1A1F2B", accent: "#1A1F2B", tld: 0.4 };
  }
  return { ink: "#1A1F2B", accent: "#3A6CB0", tld: 0.4 };
}

function KMark({ ink, accent }: { ink: string; accent: string }) {
  return (
    <g>
      {/* Frame (open K) */}
      <path
        d="M44 8 H8 V56 H56 V22"
        fill="none"
        stroke={ink}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* K stem */}
      <line x1="20" y1="18" x2="20" y2="48" stroke={ink} strokeWidth="4.2" strokeLinecap="round" />
      {/* K lower diagonal */}
      <line x1="20" y1="33" x2="40" y2="48" stroke={ink} strokeWidth="4.2" strokeLinecap="round" />
      {/* K upper diagonal — escapes the frame in accent */}
      <line x1="20" y1="33" x2="58" y2="4" stroke={accent} strokeWidth="4.2" strokeLinecap="round" />
    </g>
  );
}

export function Logo({
  variant = "lockup",
  tone = "color",
  className,
  ...rest
}: LogoProps) {
  const { ink, accent, tld } = colors(tone);

  if (variant === "mark") {
    return (
      <span className={`inline-block ${className ?? ""}`} aria-label="karrierenmin.no" {...rest}>
        <svg
          viewBox="0 0 64 64"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          className="block h-full w-auto"
        >
          <KMark ink={ink} accent={accent} />
        </svg>
      </span>
    );
  }

  return (
    <span className={className} aria-label="karrierenmin.no" {...rest}>
      <svg
        viewBox="0 0 360 80"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        className="block h-full w-auto"
      >
        <g transform="translate(0,8)">
          <KMark ink={ink} accent={accent} />
        </g>
        <text
          x="86"
          y="52"
          fontFamily="'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', Helvetica, sans-serif"
          fontSize="36"
          fontWeight={600}
          letterSpacing="-0.005em"
        >
          <tspan fill={ink}>karrieren</tspan>
          <tspan fill={accent}>min</tspan>
          <tspan fill={ink} fillOpacity={tld} fontWeight={500}>.no</tspan>
        </text>
      </svg>
    </span>
  );
}
