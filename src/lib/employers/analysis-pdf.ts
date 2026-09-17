/**
 * PDF-eksport av arbeidsgiveranalysen.
 *
 * Bygger rapporten direkte fra `EmployerAnalysisViewEnvelope` med jsPDF —
 * ikke et skjermbilde — slik at typografi og sideskift kan styres presist.
 *
 * Personvern: denne modulen leser aldri `weighting.personal`, kandidatmatch
 * eller andre brukerspesifikke felt. Eksporten er alltid den offentlige
 * analysen, uansett om brukeren er innlogget.
 */
import type { jsPDF } from "jspdf";

import type {
  EmployerAnalysisViewEnvelope,
  EmployerAnalysisV2,
  SupplementalInsight,
} from "@/lib/queries/employer-analysis-view";
import {
  DIRECTION_LABEL,
  EVIDENCE_LABEL,
  FINANCIAL_SOURCE_LABEL,
  NO_SCORE_LABEL,
  fmtAmount,
  fmtPct,
  fmtScoreOrMissing,
  fmtTotalScore,
  hasScore,
  markdownToPlainText,
  nbInt,
  nbPercent,
  orderedAiSignals,
  orderedDimensions,
} from "./analysis-labels";
import { fittingLineCount, headingFits, planParagraphSplit } from "./analysis-pdf-layout";

// ---- sidegeometri (mm, A4 portrett) ----

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_X = 18;
const CONTENT_TOP = 30;
const CONTENT_BOTTOM = 276;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

const INK: [number, number, number] = [26, 31, 43];
const MUTED: [number, number, number] = [104, 113, 128];
const BLUE: [number, number, number] = [58, 108, 176];
const RULE: [number, number, number] = [214, 219, 226];
const SOFT: [number, number, number] = [243, 245, 248];

const DISCLAIMER_TEXT =
  "Denne analysen er basert på offentlig tilgjengelig informasjon og webbasert research på " +
  "analysetidspunktet. Scoren gjenspeiler en evidensbasert vurdering, men erstatter ikke direkte " +
  "due diligence, samtaler med nåværende og tidligere ansatte eller profesjonell karriereveiledning. " +
  "KarrierenMin.no gir ingen garantier for nøyaktighet, fullstendighet eller fortsatt gyldighet. " +
  "Bruk analysen som ett av flere underlag i din ansettelsesbeslutning.";

const METHOD_LINES: string[] = [
  "Geografisk og juridisk scope: norsk juridisk enhet identifisert ved organisasjonsnummer. Global kontekst trekkes inn der det er relevant.",
  "Skala 1–5: 1 = vesentlig bekymring med konkret evidens. 2 = under gjennomsnitt, flere svake signaler. 3 = nøytral baselinje eller blandet evidens. 4 = over gjennomsnitt, flere støttende signaler. 5 = sterk og godt dokumentert på tvers av uavhengige kilder.",
  "Kildebelagt: direkte støttet av evidens. Avledet: logisk utledet fra indirekte signaler. Utilstrekkelig grunnlag: færre enn to uavhengige kilder for en scoret dimensjon.",
  "Totalscore renormaliseres over dimensjonene som faktisk har score.",
];

const nbDate = new Intl.DateTimeFormat("nb-NO", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

function fmtDateSafe(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return nbDate.format(d);
}

// ---- logo ----

function drawLogoMark(doc: jsPDF, x: number, y: number, size: number) {
  const s = size / 64;
  doc.setLineCap("round");
  doc.setLineJoin("round");
  doc.setDrawColor(...INK);
  doc.setLineWidth(2.5 * s);
  doc.lines(
    [
      [-36 * s, 0],
      [0, 48 * s],
      [48 * s, 0],
      [0, -34 * s],
    ],
    x + 44 * s,
    y + 8 * s,
  );
  doc.setLineWidth(4 * s);
  doc.line(x + 20 * s, y + 18 * s, x + 20 * s, y + 48 * s);
  doc.line(x + 20 * s, y + 33 * s, x + 40 * s, y + 48 * s);
  doc.setDrawColor(...BLUE);
  doc.line(x + 20 * s, y + 33 * s, x + 58 * s, y + 4 * s);
  doc.setLineWidth(0.2);
}

/** Ordmerket «karrierenmin.no». Returnerer bredden som ble tegnet. */
function drawWordmark(doc: jsPDF, x: number, baseline: number, fontSize: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(fontSize);
  let cursor = x;
  doc.setTextColor(...INK);
  doc.text("karrieren", cursor, baseline);
  cursor += doc.getTextWidth("karrieren");
  doc.setTextColor(...BLUE);
  doc.text("min", cursor, baseline);
  cursor += doc.getTextWidth("min");
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...MUTED);
  doc.text(".no", cursor, baseline);
  cursor += doc.getTextWidth(".no");
  return cursor - x;
}

// ---- rapportmodell (offentlig, uten brukerdata) ----

export type PdfReportMeta = {
  companyName: string;
  organisasjonsnummer: string;
  industry: string | null;
  location: string | null;
  ratedAt: string | null;
  generatedAt: Date;
};

/**
 * Valgbare deler av rapporten. Standard er den offentlige rapporten:
 * jobbsøkerperspektivet er med, mens brukervurderinger og personlig match
 * aldri tas med uten at innlogget bruker aktivt har valgt det.
 */
export type PdfExportOptions = {
  /** «Hva dette betyr for en jobbsøker» under hver dimensjon. */
  includeJobseekerMeaning: boolean;
  /** Brukervurderinger: min egen vurdering og brukersnittet. */
  includeUserReviews: boolean;
  /** «Hvordan dette selskapet passer meg som ansatt» (kandidatmatch). */
  includePersonalFit: boolean;
};

export const DEFAULT_PDF_EXPORT_OPTIONS: PdfExportOptions = {
  includeJobseekerMeaning: true,
  includeUserReviews: false,
  includePersonalFit: false,
};

export type PdfUserReviews = {
  mine?: {
    items: Array<{ label: string; value: number | null }>;
    notes?: string | null;
    flags?: string[];
  } | null;
  aggregate?: {
    count: number;
    items: Array<{ label: string; value: number | null }>;
  } | null;
};

export type PdfPersonalFit = {
  state: "rated" | "unavailable" | "partial" | "none";
  score?: number | null;
  reasoning?: string | null;
  scenarioNotes?: string[];
};

export type PdfPersonalData = {
  reviews?: PdfUserReviews | null;
  fit?: PdfPersonalFit | null;
};

export function buildPublicReportMeta(
  envelope: EmployerAnalysisViewEnvelope,
  now: Date = new Date(),
): PdfReportMeta {
  const entity = envelope.register?.entity ?? null;
  const location = [entity?.municipality, entity?.county].filter(Boolean).join(", ") || null;
  return {
    companyName: envelope.company?.name ?? "Ukjent selskap",
    organisasjonsnummer: envelope.organisasjonsnummer,
    industry: entity?.industry_primary ?? envelope.company?.industry ?? null,
    location,
    ratedAt: envelope.company?.analysis_rated_at ?? null,
    generatedAt: now,
  };
}

export function pdfFileName(meta: PdfReportMeta): string {
  const slug = meta.companyName
    .toLowerCase()
    .replace(/[æ]/g, "ae")
    .replace(/[ø]/g, "o")
    .replace(/[å]/g, "a")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `arbeidsgiveranalyse-${slug || "selskap"}-${meta.organisasjonsnummer}.pdf`;
}

// ---- layoutmotor ----

type TextOpts = {
  size?: number;
  style?: "normal" | "bold" | "italic";
  color?: [number, number, number];
  indent?: number;
  width?: number;
  gapAfter?: number;
  lineFactor?: number;
};

class ReportDoc {
  readonly doc: jsPDF;
  y = CONTENT_TOP;
  private readonly meta: PdfReportMeta;

  constructor(doc: jsPDF, meta: PdfReportMeta) {
    this.doc = doc;
    this.meta = meta;
  }

  private lineHeight(size: number, factor = 1.35) {
    return (size * factor) / 2.8346; // pt → mm
  }

  get available() {
    return CONTENT_BOTTOM - this.y;
  }

  newPage() {
    this.doc.addPage();
    this.drawPageHeader();
    this.y = CONTENT_TOP;
  }

  ensure(height: number) {
    if (this.y + height > CONTENT_BOTTOM) this.newPage();
  }

  spacer(h: number) {
    this.y = Math.min(this.y + h, CONTENT_BOTTOM);
  }

  drawPageHeader() {
    const doc = this.doc;
    drawLogoMark(doc, MARGIN_X, 10, 7);
    drawWordmark(doc, MARGIN_X + 9.5, 15.6, 9);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text("Arbeidsgiveranalyse", PAGE_W - MARGIN_X, 15.6, { align: "right" });
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.3);
    doc.line(MARGIN_X, 19.5, PAGE_W - MARGIN_X, 19.5);
  }

  /** Avsnitt med orfan-/enkekontroll. */
  paragraph(text: string | null | undefined, opts: TextOpts = {}) {
    const raw = (text ?? "").trim();
    if (!raw) return;
    const size = opts.size ?? 10;
    const style = opts.style ?? "normal";
    const color = opts.color ?? INK;
    const indent = opts.indent ?? 0;
    const width = opts.width ?? CONTENT_W - indent;
    const lh = this.lineHeight(size, opts.lineFactor ?? 1.4);

    this.doc.setFont("helvetica", style);
    this.doc.setFontSize(size);
    this.doc.setTextColor(...color);

    // Behold eksplisitte linjeskift fra kilden.
    let lines: string[] = [];
    for (const block of raw.split("\n")) {
      if (block.trim() === "") {
        lines.push("");
        continue;
      }
      lines = lines.concat(this.doc.splitTextToSize(block, width) as string[]);
    }

    let remaining = lines;
    while (remaining.length > 0) {
      const fit = fittingLineCount(this.available, lh);
      const { placeNow } = planParagraphSplit(remaining.length, fit);
      if (placeNow === 0) {
        this.newPage();
        this.doc.setFont("helvetica", style);
        this.doc.setFontSize(size);
        this.doc.setTextColor(...color);
        continue;
      }
      const chunk = remaining.slice(0, placeNow);
      for (const line of chunk) {
        this.y += lh;
        if (line) this.doc.text(line, MARGIN_X + indent, this.y);
      }
      remaining = remaining.slice(placeNow);
    }
    this.spacer(opts.gapAfter ?? 1.6);
  }

  /** Overskrift som aldri blir stående alene nederst på en side. */
  heading(
    text: string,
    level: 1 | 2 | 3,
    followingText?: string | null,
    opts: { reserveLines?: number } = {},
  ) {
    const size = level === 1 ? 14 : level === 2 ? 11.5 : 10.5;
    const gapBefore = level === 1 ? 6 : level === 2 ? 4 : 3;
    const headingHeight = this.lineHeight(size, 1.5) + gapBefore;
    const bodySize = 10;
    const bodyLh = this.lineHeight(bodySize, 1.4);

    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(bodySize);
    const followingLines = followingText
      ? (this.doc.splitTextToSize(followingText, CONTENT_W) as string[]).length
      : 2;

    // Kulepunkt reserverer 2,2 linjer per punkt, og enkelte seksjoner starter
    // med blokker som er høyere enn to tekstlinjer. `reserveLines` lar oss be
    // om nok plass, slik at overskriften aldri blir stående alene nederst.
    const fits =
      opts.reserveLines !== undefined
        ? this.available + 1e-9 >= headingHeight + bodyLh * 1.15 * opts.reserveLines
        : headingFits(this.available, headingHeight, bodyLh * 1.15, followingLines);

    if (!fits) {
      this.newPage();
    } else {
      this.spacer(gapBefore);
    }

    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(size);
    this.doc.setTextColor(...(level === 1 ? INK : INK));
    this.y += this.lineHeight(size, 1.2);
    this.doc.text(text, MARGIN_X, this.y);
    if (level === 1) {
      this.doc.setDrawColor(...BLUE);
      this.doc.setLineWidth(0.6);
      this.doc.line(MARGIN_X, this.y + 2.6, MARGIN_X + 22, this.y + 2.6);
      this.spacer(4.2);
    } else {
      this.spacer(1.6);
    }
  }

  bullets(items: string[], opts: { size?: number } = {}) {
    const size = opts.size ?? 10;
    for (const item of items) {
      const clean = item.trim();
      if (!clean) continue;
      // Kulepunktet og første tekstlinje holdes alltid sammen.
      const lh = this.lineHeight(size, 1.4);
      // To linjer sikrer at avsnittet aldri starter med et sideskift, slik at
      // kulepunktet havner på samme side og linje som første tekstlinje.
      this.ensure(lh * 2.2);
      const startY = this.y;
      this.paragraph(clean, { size, indent: 5, gapAfter: 1 });
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(size);
      this.doc.setTextColor(...BLUE);
      // Punktet tegnes ved første linje i avsnittet (samme side som teksten).
      this.doc.text("•", MARGIN_X + 0.5, startY + lh);
      this.doc.setTextColor(...INK);
    }
  }

  scoreBar(label: string, score: number | null | undefined) {
    const blockH = 8.5;
    this.ensure(blockH);
    const doc = this.doc;
    this.y += 3.6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    doc.text(label, MARGIN_X, this.y);
    doc.setTextColor(...MUTED);
    doc.text(fmtScoreOrMissing(score), PAGE_W - MARGIN_X, this.y, {
      align: "right",
    });
    const barY = this.y + 1.6;
    doc.setFillColor(...SOFT);
    doc.roundedRect(MARGIN_X, barY, CONTENT_W, 1.8, 0.9, 0.9, "F");
    if (hasScore(score)) {
      const w = Math.max(0, Math.min(1, score / 5)) * CONTENT_W;
      if (w > 0) {
        doc.setFillColor(...BLUE);
        doc.roundedRect(MARGIN_X, barY, Math.max(w, 1.8), 1.8, 0.9, 0.9, "F");
      }
    }
    this.y = barY + 1.8 + 1.2;
  }

  /** Nøkkeltall i tre kolonner; radene deles aldri over et sideskift. */
  factGrid(cells: Array<{ label: string; value: string }>) {
    const cols = 3;
    const gap = 4;
    const cellW = (CONTENT_W - gap * (cols - 1)) / cols;
    const cellH = 14;
    for (let i = 0; i < cells.length; i += cols) {
      const row = cells.slice(i, i + cols);
      this.ensure(cellH + 3);
      const top = this.y + 2;
      row.forEach((cell, idx) => {
        const x = MARGIN_X + idx * (cellW + gap);
        this.doc.setFillColor(...SOFT);
        this.doc.setDrawColor(...RULE);
        this.doc.setLineWidth(0.2);
        this.doc.roundedRect(x, top, cellW, cellH, 1.5, 1.5, "FD");
        this.doc.setFont("helvetica", "normal");
        this.doc.setFontSize(7.5);
        this.doc.setTextColor(...MUTED);
        this.doc.text(cell.label.toUpperCase(), x + 3, top + 5);
        this.doc.setFont("helvetica", "bold");
        this.doc.setFontSize(11);
        this.doc.setTextColor(...INK);
        this.doc.text(cell.value, x + 3, top + 11);
      });
      this.y = top + cellH;
    }
    this.spacer(1.5);
  }

  /** Liten etikett («Kildebelagt», score) på egen linje. */
  metaLine(parts: Array<string | null | undefined>) {
    const text = parts.filter(Boolean).join("  ·  ");
    if (!text) return;
    this.paragraph(text, { size: 8.5, color: MUTED, gapAfter: 1 });
  }
}

// ---- forside ----

function drawCover(doc: jsPDF, meta: PdfReportMeta, hasPersonalContent: boolean) {
  drawLogoMark(doc, MARGIN_X, 38, 26);
  drawWordmark(doc, MARGIN_X + 32, 61, 26);

  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, 78, PAGE_W - MARGIN_X, 78);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(...BLUE);
  doc.text("ARBEIDSGIVERANALYSE", MARGIN_X, 96);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  doc.setTextColor(...INK);
  const nameLines = doc.splitTextToSize(meta.companyName, CONTENT_W) as string[];
  let y = 110;
  for (const line of nameLines.slice(0, 3)) {
    doc.text(line, MARGIN_X, y);
    y += 11;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...MUTED);
  y += 2;
  doc.text(`Organisasjonsnummer ${meta.organisasjonsnummer}`, MARGIN_X, y);
  const sub = [meta.industry, meta.location].filter(Boolean).join(" · ");
  if (sub) {
    y += 6.5;
    for (const line of (doc.splitTextToSize(sub, CONTENT_W) as string[]).slice(0, 2)) {
      doc.text(line, MARGIN_X, y);
      y += 6;
    }
  }

  const rated = fmtDateSafe(meta.ratedAt);
  y += 10;
  doc.setFontSize(10);
  if (rated) {
    doc.text(`Analyse oppdatert ${rated}`, MARGIN_X, y);
    y += 6;
  }
  doc.text(`Rapport generert ${nbDate.format(meta.generatedAt)}`, MARGIN_X, y);

  doc.setDrawColor(...RULE);
  doc.line(MARGIN_X, 250, PAGE_W - MARGIN_X, 250);
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  const foot = doc.splitTextToSize(
    hasPersonalContent
      ? "Rapporten er utarbeidet av karrierenmin.no på grunnlag av offentlig tilgjengelig informasjon. " +
          "Denne versjonen inneholder i tillegg dine egne vurderinger og/eller din personlige match, " +
          "og bør derfor ikke deles videre."
      : "Rapporten er utarbeidet av karrierenmin.no på grunnlag av offentlig tilgjengelig informasjon. " +
          "Den inneholder ingen personlige vurderinger eller brukerdata.",
    CONTENT_W,
  ) as string[];
  let fy = 257;
  for (const line of foot) {
    doc.text(line, MARGIN_X, fy);
    fy += 4.6;
  }
}

// ---- innhold ----

function supplementalBlock(
  rd: ReportDoc,
  title: string,
  insight: SupplementalInsight | null | undefined,
) {
  if (!insight) return;
  const body = insight.narrative ?? "";
  rd.heading(title, 3, body || null);
  rd.metaLine([
    insight.evidence_status
      ? (EVIDENCE_LABEL[insight.evidence_status] ?? "Utilstrekkelig grunnlag")
      : null,
    insight.direction
      ? `Retning: ${DIRECTION_LABEL[insight.direction] ?? "Utilstrekkelig grunnlag"}`
      : null,
  ]);
  rd.paragraph(body);
  const highlights = (insight.highlights ?? []).filter(
    (h): h is string => typeof h === "string" && h.trim().length > 0,
  );
  if (highlights.length > 0) rd.bullets(highlights);
  if (!body && highlights.length === 0) {
    rd.paragraph("Utilstrekkelig grunnlag.", { color: MUTED });
  }
}

function renderPersonalSections(
  rd: ReportDoc,
  options: PdfExportOptions,
  personal: PdfPersonalData,
) {
  if (options.includeUserReviews) {
    const mine = personal.reviews?.mine ?? null;
    const agg = personal.reviews?.aggregate ?? null;
    rd.heading("Vurderinger av selskapet", 1, null, { reserveLines: 6 });

    rd.heading("Min egen vurdering", 2, null, { reserveLines: 4 });
    if (mine && mine.items.some((i) => typeof i.value === "number")) {
      for (const item of mine.items) rd.scoreBar(item.label, item.value);
      const flags = (mine.flags ?? []).filter((f) => f.trim().length > 0);
      if (flags.length > 0) {
        rd.spacer(2);
        rd.paragraph(`Erfaringsgrunnlag: ${flags.join(", ")}.`, { size: 9, color: MUTED });
      }
      if (mine.notes && mine.notes.trim()) {
        rd.heading("Mine notater", 3, mine.notes);
        rd.paragraph(mine.notes);
      }
    } else {
      rd.paragraph("Du har ikke lagret en egen vurdering av dette selskapet.", { color: MUTED });
    }

    rd.heading("Brukersnitt", 2, null, { reserveLines: 4 });
    if (agg && agg.count > 0) {
      for (const item of agg.items) rd.scoreBar(item.label, item.value);
      rd.spacer(2);
      rd.paragraph(
        `Basert på ${nbInt.format(agg.count)} ${agg.count === 1 ? "vurdering" : "vurderinger"} fra brukere.`,
        { size: 9, color: MUTED },
      );
    } else {
      rd.paragraph("Ingen brukere har lagret vurdering av dette selskapet ennå.", { color: MUTED });
    }
  }

  if (options.includePersonalFit) {
    const fit = personal.fit ?? null;
    rd.heading("Hvordan dette selskapet passer meg som ansatt", 1, null, { reserveLines: 5 });
    if (!fit || fit.state === "none") {
      rd.paragraph("Din personlige match for dette selskapet er ikke beregnet ennå.", {
        color: MUTED,
      });
    } else {
      if (fit.state === "rated") {
        rd.factGrid([{ label: "Kandidatmatch (deg)", value: fmtScoreOrMissing(fit.score) }]);
      } else if (fit.state === "unavailable") {
        rd.paragraph("Kandidatmatch kan ikke vurderes med dagens profilgrunnlag.", {
          size: 9,
          color: MUTED,
        });
      } else {
        rd.paragraph("Kandidatmatch er ikke fullført som tallscore.", { size: 9, color: MUTED });
      }
      const reasoning = markdownToPlainText(fit.reasoning);
      if (reasoning) {
        rd.heading("Begrunnelse", 3, reasoning);
        rd.paragraph(reasoning);
      }
      const notes = (fit.scenarioNotes ?? []).filter((n) => n.trim().length > 0);
      if (notes.length > 0) {
        rd.heading("Scenarienotater for deg", 3, null, { reserveLines: 2 });
        rd.bullets(notes);
      }
    }
    rd.paragraph(
      "Denne delen bygger på din egen profil og dine lagrede vurderinger. Del rapporten med omhu.",
      { size: 8.5, color: MUTED },
    );
  }
}

function renderContent(
  rd: ReportDoc,
  envelope: EmployerAnalysisViewEnvelope,
  options: PdfExportOptions,
  personal: PdfPersonalData,
) {
  const analysis = envelope.analysis as EmployerAnalysisV2;
  const publicWeighting = envelope.weighting?.public ?? null;
  const financials = envelope.financials ?? null;

  // 1. Hovedfunn
  const findings = (analysis.key_findings ?? []).filter(
    (f): f is string => typeof f === "string" && f.trim().length > 0,
  );
  rd.heading("Hovedfunn", 1, analysis.executive_summary ?? null, { reserveLines: 2 });
  if (findings.length > 0) rd.bullets(findings);
  const summary = markdownToPlainText(analysis.executive_summary);
  if (summary) {
    rd.spacer(2);
    rd.paragraph(summary);
  }

  // 2. Dimensjonsscore
  rd.heading("Dimensjonsscore av selskapet", 1, "Felles vektet vurdering");
  const emp = publicWeighting?.employer ?? null;
  rd.factGrid([
    {
      label: "Samlet arbeidsgiverscore",
      value: emp && hasScore(emp.score) ? fmtTotalScore(emp.score) : NO_SCORE_LABEL,
    },
    {
      label: "Scorede dimensjoner",
      value: emp ? `${emp.scored_dimensions} av ${emp.total_dimensions}` : "—",
    },
    {
      label: "Vektdekning",
      value: hasScore(emp?.weight_coverage_percent)
        ? `${nbPercent.format(emp!.weight_coverage_percent as number)} %`
        : "—",
    },
  ]);
  const dims = orderedDimensions(analysis.dimensions);
  for (const d of dims) rd.scoreBar(d.label, d.score);

  // 3. Detaljert gjennomgang
  rd.heading("Detaljert gjennomgang av åtte dimensjoner", 1, dims[0]?.rationale ?? null);
  for (const d of dims) {
    rd.heading(d.label, 2, d.rationale ?? d.what_it_means ?? "Ikke nok data.");
    rd.metaLine([
      fmtScoreOrMissing(d.score),
      d.evidence_status ? (EVIDENCE_LABEL[d.evidence_status] ?? "Utilstrekkelig grunnlag") : null,
    ]);
    if (d.rationale) rd.paragraph(d.rationale);
    if (d.what_it_means && options.includeJobseekerMeaning) {
      rd.paragraph("Hva dette betyr for en jobbsøker", {
        size: 8.5,
        style: "bold",
        color: MUTED,
        gapAfter: 0.8,
      });
      rd.paragraph(d.what_it_means);
    }
    if (!d.rationale && !(d.what_it_means && options.includeJobseekerMeaning)) {
      rd.paragraph("Utilstrekkelig grunnlag for denne dimensjonen.", {
        color: MUTED,
      });
    }
  }

  // 4. Finansiell oversikt
  rd.heading("Finansielle nøkkeltall", 1, "Regnskapstall fra siste tilgjengelige år.");
  if (financials?.fiscal_year) {
    const currency = financials.currency ?? "NOK";
    const employees = envelope.register?.entity?.employee_count ?? null;
    rd.paragraph(`Regnskapsår ${financials.fiscal_year}.`, {
      size: 9,
      color: MUTED,
    });
    rd.factGrid([
      { label: "Driftsinntekter", value: fmtAmount(financials.revenue_latest, currency) },
      {
        label: "Driftsresultat",
        value: fmtAmount(financials.operating_result_latest, currency),
      },
      { label: "Årsresultat", value: fmtAmount(financials.profit_latest, currency) },
      { label: "Egenkapital", value: fmtAmount(financials.equity_latest, currency) },
      { label: "Gjeld", value: fmtAmount(financials.debt_latest, currency) },
      { label: "Eiendeler", value: fmtAmount(financials.assets_latest, currency) },
      { label: "Driftsmargin", value: fmtPct(financials.operating_margin_percent) },
      { label: "Egenkapitalandel", value: fmtPct(financials.equity_ratio_percent) },
      {
        label: "Ansatte",
        value: typeof employees === "number" ? nbInt.format(employees) : "—",
      },
    ]);
    const sourceLabel = financials.source_kind
      ? (FINANCIAL_SOURCE_LABEL[financials.source_kind] ?? financials.source_kind)
      : null;
    if (sourceLabel) rd.paragraph(`Kilde: ${sourceLabel}.`, { size: 8.5, color: MUTED });
  } else {
    rd.paragraph("Ingen regnskapsdata tilgjengelig.", { color: MUTED });
  }

  // 5. ESG, omtaletrend og lønnssignaler
  const supp = analysis.supplemental_insights ?? null;
  rd.heading("ESG, ansattomtaler og lønnssignaler", 1, supp?.esg_and_regulatory?.narrative ?? null);
  supplementalBlock(rd, "ESG og regulatorisk profil", supp?.esg_and_regulatory ?? null);
  supplementalBlock(rd, "Trend i ansattomtaler", supp?.employee_sentiment_trend ?? null);
  supplementalBlock(rd, "Lønnssignaler", supp?.compensation_signals ?? null);
  if (!supp?.esg_and_regulatory && !supp?.employee_sentiment_trend && !supp?.compensation_signals) {
    rd.paragraph("Utilstrekkelig grunnlag.", { color: MUTED });
  }

  // 6. AI-modenhet
  const ai = analysis.ai_maturity;
  rd.heading("AI-kompetanse og modenhet", 1, ai?.narrative ?? "Ingen AI-modenhetsvurdering.");
  if (!ai) {
    rd.paragraph("Ingen AI-modenhetsvurdering.", { color: MUTED });
  } else {
    const aiW = publicWeighting?.ai ?? null;
    rd.factGrid([
      {
        label: "Samlet AI-modenhet",
        value: aiW && hasScore(aiW.score) ? fmtTotalScore(aiW.score) : NO_SCORE_LABEL,
      },
      {
        label: "Scorede områder",
        value: aiW ? `${aiW.scored_dimensions} av ${aiW.total_dimensions}` : "—",
      },
      {
        label: "Vektdekning",
        value: hasScore(aiW?.weight_coverage_percent)
          ? `${nbPercent.format(aiW!.weight_coverage_percent as number)} %`
          : "—",
      },
    ]);
    const narrative = markdownToPlainText(ai.narrative);
    if (narrative) rd.paragraph(narrative);
    const signals = orderedAiSignals(ai.signals);
    for (const { signal } of signals) rd.scoreBar(signal.label, signal.score);
    rd.spacer(2);
    for (const { key, signal } of signals) {
      if (!signal.rationale) continue;
      rd.heading(signal.label, 3, signal.rationale);
      rd.metaLine([fmtScoreOrMissing(signal.score)]);
      rd.paragraph(signal.rationale);
      void key;
    }
    const evidence = Array.isArray(ai.key_evidence) ? ai.key_evidence : [];
    const evidenceItems = evidence
      .map((e) =>
        typeof e === "string"
          ? e
          : e && typeof e === "object"
            ? ((e as { text?: string }).text ?? "")
            : "",
      )
      .filter((t) => t.trim().length > 0);
    if (evidenceItems.length > 0) {
      rd.heading("Sentral evidens", 3, null, { reserveLines: 2 });
      rd.bullets(evidenceItems);
    }
  }

  // 7. Helhetsvurdering
  const overall = markdownToPlainText(analysis.overall_assessment);
  if (overall) {
    rd.heading("Helhetsvurdering", 1, overall);
    rd.paragraph(overall);
  }

  // 7b. Personlige deler (kun når brukeren har valgt dem)
  renderPersonalSections(rd, options, personal);

  // 8. Kilder
  const sources = analysis.sources ?? [];
  if (sources.length > 0) {
    rd.heading("Kilder", 1, sources[0]?.url ?? null);
    for (const s of sources) {
      const label = `[${s.id}] ${s.url}${s.category ? ` — ${s.category}` : ""}`;
      rd.paragraph(label, { size: 8.5, color: MUTED, gapAfter: 0.8 });
    }
  }

  // 9. Ansvarsfraskrivelse og metode
  rd.heading("Ansvarsfraskrivelse", 1, DISCLAIMER_TEXT);
  rd.paragraph(DISCLAIMER_TEXT, { size: 9 });

  rd.heading("Metode og definisjoner", 1, METHOD_LINES[0]);
  for (const line of METHOD_LINES) {
    rd.paragraph(line, { size: 9, gapAfter: 2 });
  }

  rd.heading("Kontakt", 3, "Representerer du selskapet? Ta kontakt for å administrere profilen.");
  rd.paragraph(
    "Representerer du selskapet? Ta kontakt på hei@karrierenmin.no for å administrere profilen.",
    { size: 9 },
  );
}

function drawFooters(doc: jsPDF, meta: PdfReportMeta) {
  const total = doc.getNumberOfPages();
  for (let page = 2; page <= total; page++) {
    doc.setPage(page);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.3);
    doc.line(MARGIN_X, PAGE_H - 15, PAGE_W - MARGIN_X, PAGE_H - 15);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`${meta.companyName} · ${meta.organisasjonsnummer}`, MARGIN_X, PAGE_H - 10);
    doc.text(`Side ${page} av ${total}`, PAGE_W - MARGIN_X, PAGE_H - 10, {
      align: "right",
    });
  }
  doc.setPage(1);
}

/** Bygger hele PDF-dokumentet. Krever en nettleser- eller Node-kjøring med jsPDF. */
export async function buildEmployerAnalysisPdf(
  envelope: EmployerAnalysisViewEnvelope,
  opts: {
    options?: Partial<PdfExportOptions>;
    personal?: PdfPersonalData;
    now?: Date;
  } = {},
): Promise<{ doc: jsPDF; meta: PdfReportMeta }> {
  const options: PdfExportOptions = { ...DEFAULT_PDF_EXPORT_OPTIONS, ...(opts.options ?? {}) };
  const personal: PdfPersonalData = opts.personal ?? {};
  const now = opts.now ?? new Date();
  if (!envelope.analysis) {
    throw new Error("Ingen analyse å eksportere for dette selskapet.");
  }
  const { jsPDF: JsPdf } = await import("jspdf");
  const doc = new JsPdf({ unit: "mm", format: "a4", compress: true });
  const meta = buildPublicReportMeta(envelope, now);

  doc.setProperties({
    title: `Arbeidsgiveranalyse – ${meta.companyName}`,
    subject: `Arbeidsgiveranalyse for ${meta.companyName} (${meta.organisasjonsnummer})`,
    author: "karrierenmin.no",
    creator: "karrierenmin.no",
  });

  drawCover(doc, meta, options.includeUserReviews || options.includePersonalFit);

  const rd = new ReportDoc(doc, meta);
  rd.newPage();
  renderContent(rd, envelope, options, personal);
  drawFooters(doc, meta);

  return { doc, meta };
}

/** Bygger og laster ned rapporten i nettleseren. */
export async function downloadEmployerAnalysisPdf(
  envelope: EmployerAnalysisViewEnvelope,
  opts: { options?: Partial<PdfExportOptions>; personal?: PdfPersonalData } = {},
): Promise<string> {
  const { doc, meta } = await buildEmployerAnalysisPdf(envelope, opts);
  const filename = pdfFileName(meta);
  doc.save(filename);
  return filename;
}
