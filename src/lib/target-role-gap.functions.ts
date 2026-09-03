/**
 * Serverhandlinger for gap-analyse mot målrolle.
 *
 * Klienten sender målrollen og kravene fra ESCO-kilden. Selve sammenligningen
 * skjer her, mot brukerens brukerbekreftede `career_atoms`, slik at det som
 * lagres alltid er beregnet av serveren — ikke av nettleseren.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  computeTargetRoleGap,
  coverageToScore1to6,
  TARGET_ROLE_GAP_VERSION,
  type GapAtom,
  type RoleRequirement,
  type TargetRoleGapResult,
} from "@/lib/target-role-gap";

const schema = z.object({
  role: z.object({
    title: z.string().min(1).max(200),
    uri: z.string().max(400).nullable().optional(),
  }),
  requirements: z
    .array(
      z.object({
        uri: z.string().max(400).nullable().optional(),
        label: z.string().min(1).max(300),
        level: z.enum(["must_have", "nice_to_have"]),
      }),
    )
    .max(120),
});

type AtomRow = {
  id: string;
  content_no: string | null;
  content_en: string | null;
  atom_kind: string | null;
  viktighet: number | null;
  structured_data: Record<string, unknown> | null;
};

function toGapAtom(row: AtomRow): GapAtom | null {
  const sd = (row.structured_data ?? {}) as Record<string, unknown>;
  const label =
    (typeof sd["etikett"] === "string" ? (sd["etikett"] as string) : null) ??
    row.content_no ??
    row.content_en;
  if (!label || !label.trim()) return null;
  const description =
    (typeof sd["beskrivelse"] === "string" ? (sd["beskrivelse"] as string) : null) ??
    (row.content_no && row.content_no !== label ? row.content_no : null);
  return {
    id: row.id,
    label: label.trim(),
    description,
    strength: row.viktighet ?? null,
  };
}

export const analyzeTargetRoleGap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as {
      from: (t: string) => any;
    };

    const { data: rows, error } = await supabase
      .from("career_atoms")
      .select("id, content_no, content_en, atom_kind, viktighet, structured_data")
      .eq("user_id", context.userId)
      .eq("user_confirmed", true)
      .eq("is_active", true)
      .limit(1000);

    if (error) {
      return { ok: false as const, errorCode: "atoms_read_failed", message: error.message };
    }

    const atoms = ((rows ?? []) as AtomRow[])
      .filter((r) => r.atom_kind !== "mangel")
      .map(toGapAtom)
      .filter((a): a is GapAtom => a != null);

    const result = computeTargetRoleGap({
      role: { title: data.role.title, uri: data.role.uri ?? null },
      requirements: data.requirements as RoleRequirement[],
      atoms,
    });

    const saved = await persistGap({ supabase, userId: context.userId, result, atomCount: atoms.length });
    if (!saved.ok) return saved;

    return { ok: true as const, assessmentId: saved.assessmentId, result, atomCount: atoms.length };
  });

async function persistGap(input: {
  supabase: { from: (t: string) => any };
  userId: string;
  result: TargetRoleGapResult;
  atomCount: number;
}): Promise<{ ok: true; assessmentId: string } | { ok: false; errorCode: string; message: string }> {
  const { supabase, userId, result, atomCount } = input;
  const now = new Date().toISOString();

  const header = {
    user_id: userId,
    assessment_type: "target_role",
    overall_match_score: result.coverageScore0to100,
    evidence_strength_score: coverageToScore1to6(result.coverageScore0to100),
    positioning_score: null,
    apply_recommendation_score: result.coverageScore0to100,
    match_band: result.band,
    summary: `Dekningsgrad mot «${result.role.title}»: ${result.coverageScore0to100} % (${result.mustHaveCovered} av ${result.mustHaveTotal} må-ha-krav har belegg).`,
    reasoning: {
      module: "target_role_gap",
      version: TARGET_ROLE_GAP_VERSION,
      role_title: result.role.title,
      role_uri: result.role.uri,
      requirement_source: "esco_career_direction_explorer",
      confirmed_atom_count: atomCount,
      must_have_total: result.mustHaveTotal,
      must_have_covered: result.mustHaveCovered,
      nice_to_have_total: result.niceToHaveTotal,
      nice_to_have_covered: result.niceToHaveCovered,
    },
    recommendation_summary: result.missingMustHave[0]?.label ?? null,
    status: "completed",
    source: "system",
    generated_by: TARGET_ROLE_GAP_VERSION,
    generated_at: now,
    expires_at: null,
  };

  const { data: inserted, error: hErr } = await supabase
    .from("match_assessments")
    .insert(header)
    .select("id")
    .single();
  if (hErr || !inserted?.id) {
    return { ok: false, errorCode: "assessment_insert_failed", message: hErr?.message ?? "ukjent feil" };
  }
  const assessmentId = inserted.id as string;

  const mustRows = result.requirements.filter((r) => r.level === "must_have");
  const niceRows = result.requirements.filter((r) => r.level === "nice_to_have");

  const dimensionRows = [
    { key: "must_have", rows: mustRows },
    { key: "nice_to_have", rows: niceRows },
  ]
    .filter((g) => g.rows.length > 0)
    .map((g) => {
      const covered = g.rows.filter((r) => r.covered);
      const coverage = Math.round((covered.length / g.rows.length) * 100);
      return {
        assessment_id: assessmentId,
        dimension: `target_role:${g.key}`,
        preference_alignment_score: null,
        evidence_strength_score: coverageToScore1to6(coverage),
        market_alignment_score: null,
        overall_dimension_score: coverageToScore1to6(coverage),
        score_band: coverage < 40 ? "weak" : coverage < 70 ? "moderate" : "strong",
        matched_preference_atoms: [],
        matched_evidence_atoms: covered.flatMap((r) =>
          r.matches.map((m) => ({ id: m.id, label: m.label, requirement: r.label })),
        ),
        missing_evidence_atoms: g.rows
          .filter((r) => !r.covered)
          .map((r) => ({ uri: r.uri, requirement: r.label })),
        inferred_requirements: g.rows.map((r) => ({ uri: r.uri, text: r.label, covered: r.covered })),
        reasoning: `Krav hentet fra ESCO-profilen for «${result.role.title}». Treff beregnes mot brukerbekreftede karriereatomer.`,
        recommendation: null,
      };
    });

  if (dimensionRows.length > 0) {
    const { error: dErr } = await supabase.from("match_dimension_assessments").insert(dimensionRows);
    if (dErr) {
      return { ok: false, errorCode: "dimension_insert_failed", message: dErr.message };
    }
  }

  const recRows = result.missingMustHave.slice(0, 8).map((r, i) => ({
    assessment_id: assessmentId,
    user_id: userId,
    category: "experience_gap",
    title: `Mangler belegg: ${r.label}`.slice(0, 200),
    description: `Målrollen «${result.role.title}» krever «${r.label}», men ingen brukerbekreftet påstand i karriereprofilen din dekker dette ennå. Legg inn et resultat eller en erfaring som viser det, eller marker det som et bevisst utviklingsmål.`,
    priority_score: Math.max(1, 8 - i),
    impact_score: 6,
    effort_score: 4,
    status: "open",
    generated_by: TARGET_ROLE_GAP_VERSION,
    source_dimension: "target_role:must_have",
  }));

  if (recRows.length > 0) {
    const { error: pErr } = await supabase.from("positioning_recommendations").insert(recRows);
    if (pErr) {
      return { ok: false, errorCode: "recommendation_insert_failed", message: pErr.message };
    }
  }

  return { ok: true, assessmentId };
}
