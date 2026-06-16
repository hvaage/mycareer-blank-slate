// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(`Tilgangskontroll feilet: ${error.message}`);
  if (!data) throw new Error("Forbidden: admin role required");
}

// ------- Public: get the active survey (version + questions) -------
export const getActiveSurvey = createServerFn({ method: "GET" }).handler(
  async () => {
    const admin = await getAdmin();
    const { data: version } = await admin
      .from("survey_versions")
      .select("*")
      .eq("is_active", true)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!version) return { version: null, questions: [] };

    const { data: questions } = await admin
      .from("survey_questions")
      .select("*")
      .eq("version_id", version.id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    return { version, questions: questions ?? [] };
  },
);

// ------- Public: submit answers -------
type SubmitInput = {
  versionId: string;
  profile: {
    respondent_type: string;
    industries: string[];
    seniority_levels: string[];
    years_experience: string;
    candidate_focus: string;
    sector: string;
  };
  answers: Array<{ question_id: string; answer_value: any; text_answer?: string | null }>;
  submission_hash?: string | null;
  user_agent?: string | null;
};

export const submitSurvey = createServerFn({ method: "POST" })
  .inputValidator((d: SubmitInput) => d)
  .handler(async ({ data }) => {
    const admin = await getAdmin();

    // duplicate protection: same hash within 24h
    if (data.submission_hash) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: existing } = await admin
        .from("survey_responses")
        .select("id")
        .eq("version_id", data.versionId)
        .eq("submission_hash", data.submission_hash)
        .gte("submitted_at", since)
        .limit(1);
      if (existing && existing.length > 0) {
        return { ok: true, duplicate: true as const, responseId: existing[0].id };
      }
    }

    const { data: response, error: rErr } = await admin
      .from("survey_responses")
      .insert({
        version_id: data.versionId,
        submission_hash: data.submission_hash ?? null,
        user_agent: data.user_agent ?? null,
      })
      .select("id")
      .single();
    if (rErr || !response) throw new Error(rErr?.message ?? "Kunne ikke lagre svar");

    const responseId = response.id as string;

    await admin.from("respondent_profile").insert({
      response_id: responseId,
      respondent_type: data.profile.respondent_type,
      industries: data.profile.industries,
      seniority_levels: data.profile.seniority_levels,
      years_experience: data.profile.years_experience || null,
      candidate_focus: data.profile.candidate_focus || null,
      sector: data.profile.sector || null,
    });

    if (data.answers.length > 0) {
      await admin.from("survey_answers").insert(
        data.answers.map((a) => ({
          response_id: responseId,
          question_id: a.question_id,
          answer_value: a.answer_value,
          text_answer: a.text_answer ?? null,
        })),
      );
    }

    return { ok: true, duplicate: false as const, responseId };
  });

// ------- Public: register for result access (separate from answers) -------
export const signupForResults = createServerFn({ method: "POST" })
  .inputValidator((d: { versionId: string | null; name: string; email: string }) => d)
  .handler(async ({ data }) => {
    const email = data.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Ugyldig e-postadresse");
    }
    const admin = await getAdmin();
    await admin.from("result_access_signups").insert({
      version_id: data.versionId,
      name: data.name?.trim() || null,
      email,
    });
    return { ok: true };
  });

// ------- Aggregation helpers -------
function aggregateAnswers(
  questions: any[],
  answers: any[],
  opts: { includeQuotesOnly: "public" | "full" | "none" },
) {
  const byQ = new Map<string, any[]>();
  for (const a of answers) {
    const list = byQ.get(a.question_id) ?? [];
    list.push(a);
    byQ.set(a.question_id, list);
  }

  return questions.map((q) => {
    const rows = byQ.get(q.id) ?? [];
    const total = rows.length;

    if (q.question_type === "open_text") {
      const quoteField =
        opts.includeQuotesOnly === "public"
          ? "is_public_quote_approved"
          : opts.includeQuotesOnly === "full"
            ? "is_full_quote_approved"
            : null;
      const quotes =
        quoteField !== null
          ? rows
              .filter((r) => r[quoteField] === true && (r.text_answer || ""))
              .map((r) => r.text_answer as string)
          : [];
      return {
        question_id: q.id,
        question_text: q.question_text,
        category: q.category,
        type: q.question_type,
        total,
        quotes,
      };
    }

    if (q.question_type === "scale") {
      const values = rows
        .map((r) => Number(r.answer_value))
        .filter((n) => Number.isFinite(n));
      const avg =
        values.length === 0
          ? null
          : Math.round((values.reduce((s, n) => s + n, 0) / values.length) * 10) / 10;
      const distribution: Record<string, number> = {};
      for (let i = q.scale_min ?? 1; i <= (q.scale_max ?? 10); i++) {
        distribution[String(i)] = 0;
      }
      for (const v of values) distribution[String(v)] = (distribution[String(v)] ?? 0) + 1;
      return {
        question_id: q.id,
        question_text: q.question_text,
        category: q.category,
        type: q.question_type,
        total: values.length,
        average: avg,
        scale_min: q.scale_min,
        scale_max: q.scale_max,
        scale_min_label: q.scale_min_label,
        scale_mid_label: q.scale_mid_label,
        scale_max_label: q.scale_max_label,
        distribution,
      };
    }

    // single_choice / multi_choice
    const counts: Record<string, number> = {};
    for (const opt of (q.options ?? []) as string[]) counts[opt] = 0;
    let optionTotal = 0;
    for (const r of rows) {
      const val = r.answer_value;
      const arr: string[] = Array.isArray(val) ? val : val ? [String(val)] : [];
      for (const v of arr) {
        counts[v] = (counts[v] ?? 0) + 1;
        optionTotal += 1;
      }
    }
    return {
      question_id: q.id,
      question_text: q.question_text,
      category: q.category,
      type: q.question_type,
      total,
      max_choices: q.max_choices,
      counts,
      option_total: optionTotal,
    };
  });
}

function aggregateProfiles(profiles: any[]) {
  const count = profiles.length;
  const by = (key: string) => {
    const out: Record<string, number> = {};
    for (const p of profiles) {
      const v = p[key];
      if (Array.isArray(v)) {
        for (const x of v) out[x] = (out[x] ?? 0) + 1;
      } else if (v) {
        out[v] = (out[v] ?? 0) + 1;
      }
    }
    return out;
  };
  return {
    total: count,
    respondent_type: by("respondent_type"),
    industries: by("industries"),
    seniority_levels: by("seniority_levels"),
    candidate_focus: by("candidate_focus"),
    sector: by("sector"),
  };
}

// ------- Public results (kortversjon) -------
export const getPublicResults = createServerFn({ method: "GET" }).handler(async () => {
  const admin = await getAdmin();
  const { data: version } = await admin
    .from("survey_versions")
    .select("*")
    .eq("is_active", true)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!version) return { version: null, profile: null, results: [] };

  const { data: questions } = await admin
    .from("survey_questions")
    .select("*")
    .eq("version_id", version.id)
    .eq("is_active", true)
    .eq("is_public_result_enabled", true)
    .neq("visibility_level", "hidden")
    .order("sort_order");

  const { data: responses } = await admin
    .from("survey_responses")
    .select("id")
    .eq("version_id", version.id);
  const ids = (responses ?? []).map((r: any) => r.id);
  if (ids.length === 0) {
    return { version, profile: { total: 0 }, results: aggregateAnswers(questions ?? [], [], { includeQuotesOnly: "public" }) };
  }
  const { data: answers } = await admin
    .from("survey_answers")
    .select("question_id, answer_value, text_answer, is_public_quote_approved")
    .in("response_id", ids);
  const { data: profiles } = await admin
    .from("respondent_profile")
    .select("respondent_type, industries, seniority_levels, candidate_focus, sector")
    .in("response_id", ids);

  return {
    version,
    profile: aggregateProfiles(profiles ?? []),
    results: aggregateAnswers(questions ?? [], answers ?? [], { includeQuotesOnly: "public" }),
  };
});

// ------- Full results (token or admin) -------
export const getFullResults = createServerFn({ method: "POST" })
  .inputValidator((d: { token?: string | null }) => d)
  .handler(async ({ data }) => {
    const admin = await getAdmin();

    let authorized = false;
    if (data.token) {
      const { data: signup } = await admin
        .from("result_access_signups")
        .select("id")
        .eq("access_token", data.token)
        .not("access_granted_at", "is", null)
        .maybeSingle();
      if (signup) authorized = true;
    }
    if (!authorized) {
      // Try admin via session token from request
      try {
        const { getRequestHeader } = await import("@tanstack/react-start/server");
        const authHeader = getRequestHeader("authorization") ?? getRequestHeader("Authorization");
        if (authHeader?.startsWith("Bearer ")) {
          const token = authHeader.slice("Bearer ".length);
          const { data: userData } = await admin.auth.getUser(token);
          if (userData?.user) {
            const { data: role } = await admin
              .from("user_roles")
              .select("role")
              .eq("user_id", userData.user.id)
              .eq("role", "admin")
              .maybeSingle();
            if (role) authorized = true;
          }
        }
      } catch {
        /* ignore */
      }
    }
    if (!authorized) throw new Error("Forbidden: gyldig tilgangslenke kreves");

    const { data: version } = await admin
      .from("survey_versions")
      .select("*")
      .eq("is_active", true)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!version) return { version: null, profile: null, results: [] };

    const { data: questions } = await admin
      .from("survey_questions")
      .select("*")
      .eq("version_id", version.id)
      .eq("is_active", true)
      .eq("is_full_result_enabled", true)
      .neq("visibility_level", "hidden")
      .order("sort_order");

    const { data: responses } = await admin
      .from("survey_responses")
      .select("id")
      .eq("version_id", version.id);
    const ids = (responses ?? []).map((r: any) => r.id);
    const [answersR, profilesR] = await Promise.all([
      ids.length
        ? admin
            .from("survey_answers")
            .select("question_id, answer_value, text_answer, is_full_quote_approved")
            .in("response_id", ids)
        : Promise.resolve({ data: [] as any[] }),
      ids.length
        ? admin
            .from("respondent_profile")
            .select("respondent_type, industries, seniority_levels, candidate_focus, sector")
            .in("response_id", ids)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    return {
      version,
      profile: aggregateProfiles((profilesR as any).data ?? []),
      results: aggregateAnswers(
        questions ?? [],
        (answersR as any).data ?? [],
        { includeQuotesOnly: "full" },
      ),
    };
  });

// ============= ADMIN =============
export const adminGetOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, supabase } = context as { userId: string; supabase: any };
    await assertAdmin(supabase, userId);
    const [v, sUps] = await Promise.all([
      supabase.from("survey_versions").select("*").order("version_number", { ascending: false }),
      supabase.from("result_access_signups").select("*").order("created_at", { ascending: false }),
    ]);
    if (v.error) throw new Error(`survey_versions: ${v.error.message}`);
    if (sUps.error) throw new Error(`result_access_signups: ${sUps.error.message}`);
    const versions = v.data ?? [];
    const signups = sUps.data ?? [];
    let counts: Record<string, number> = {};
    if (versions.length) {
      const { data, error } = await supabase
        .from("survey_responses")
        .select("version_id")
        .in(
          "version_id",
          versions.map((x: any) => x.id),
        );
      if (error) throw new Error(`survey_responses: ${error.message}`);
      for (const r of data ?? []) counts[r.version_id] = (counts[r.version_id] ?? 0) + 1;
    }
    return { versions, signups, counts };
  });

export const adminGetQuestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { versionId: string }) => d)
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    await assertAdmin(userId);
    const admin = await getAdmin();
    const { data: questions } = await admin
      .from("survey_questions")
      .select("*")
      .eq("version_id", data.versionId)
      .order("sort_order");
    return { questions: questions ?? [] };
  });

export const adminUpdateQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; patch: Record<string, any> }) => d)
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    await assertAdmin(userId);
    const admin = await getAdmin();
    const { error } = await admin
      .from("survey_questions")
      .update(data.patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminGetTextAnswers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { questionId: string }) => d)
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    await assertAdmin(userId);
    const admin = await getAdmin();
    const { data: answers } = await admin
      .from("survey_answers")
      .select("id, text_answer, is_public_quote_approved, is_full_quote_approved, is_flagged, admin_note, created_at")
      .eq("question_id", data.questionId)
      .not("text_answer", "is", null)
      .order("created_at", { ascending: false });
    return { answers: answers ?? [] };
  });

export const adminUpdateAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; patch: Record<string, any> }) => d)
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    await assertAdmin(userId);
    const admin = await getAdmin();
    const { error } = await admin
      .from("survey_answers")
      .update(data.patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminIssueAccessToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { signupId: string }) => d)
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    await assertAdmin(userId);
    const admin = await getAdmin();
    const token =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
    const { error } = await admin
      .from("result_access_signups")
      .update({ access_token: token, access_granted_at: new Date().toISOString() })
      .eq("id", data.signupId);
    if (error) throw new Error(error.message);
    return { token };
  });

export const adminExportCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { versionId: string }) => d)
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    await assertAdmin(userId);
    const admin = await getAdmin();
    const { data: questions } = await admin
      .from("survey_questions")
      .select("id, question_text, sort_order")
      .eq("version_id", data.versionId)
      .order("sort_order");
    const { data: responses } = await admin
      .from("survey_responses")
      .select("id, submitted_at")
      .eq("version_id", data.versionId);
    const ids = (responses ?? []).map((r: any) => r.id);
    const { data: profiles } = ids.length
      ? await admin
          .from("respondent_profile")
          .select("*")
          .in("response_id", ids)
      : { data: [] as any[] };
    const { data: answers } = ids.length
      ? await admin
          .from("survey_answers")
          .select("response_id, question_id, answer_value, text_answer")
          .in("response_id", ids)
      : { data: [] as any[] };
    const profByR = new Map((profiles ?? []).map((p: any) => [p.response_id, p]));
    const ansByR = new Map<string, Record<string, string>>();
    for (const a of answers ?? []) {
      const m = ansByR.get(a.response_id) ?? {};
      const val = a.text_answer
        ? a.text_answer
        : Array.isArray(a.answer_value)
          ? (a.answer_value as any[]).join(" | ")
          : String(a.answer_value ?? "");
      m[a.question_id] = val;
      ansByR.set(a.response_id, m);
    }
    const profCols = [
      "respondent_type",
      "industries",
      "seniority_levels",
      "years_experience",
      "candidate_focus",
      "sector",
    ];
    const header = [
      "response_id",
      "submitted_at",
      ...profCols,
      ...(questions ?? []).map((q: any) => `Q${q.sort_order}`),
    ];
    const esc = (s: any) => {
      const t = s == null ? "" : Array.isArray(s) ? s.join(" | ") : String(s);
      return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const rows = [header.map(esc).join(",")];
    for (const r of responses ?? []) {
      const p = (profByR.get(r.id) as any) ?? {};
      const aMap = ansByR.get(r.id) ?? {};
      rows.push(
        [
          r.id,
          r.submitted_at,
          ...profCols.map((c) => esc(p[c])),
          ...(questions ?? []).map((q: any) => esc(aMap[q.id])),
        ].join(","),
      );
    }
    return { csv: rows.join("\n") };
  });
