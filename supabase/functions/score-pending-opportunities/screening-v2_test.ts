import {
  type EvidenceItem,
  finalizeEvaluation,
  initialScreening,
  type ScreeningJob,
  type ScreeningProfile,
} from "./screening-v2.ts";

const profile: ScreeningProfile = {
  target_roles: ["COO"],
  preferred_locations: ["Oslo"],
  target_city: "Oslo",
  target_region: null,
  willing_to_relocate: false,
  preferred_work_extents: ["full_time"],
  preferred_engagement_types: ["permanent"],
};

const job: ScreeningJob = {
  title: "Chief Operating Officer",
  location: "Oslo",
  work_type: null,
  work_extent: "full_time",
  engagement_type: "permanent",
  description:
    "Vi søker en erfaren leder til rollen som Chief Operating Officer.",
  description_complete: true,
};

const evidence: EvidenceItem[] = [
  {
    ref: "ue:leadership",
    category: "experience",
    label: "Operativ ledererfaring",
    description: "Ledet nasjonale driftsmiljøer.",
  },
];

Deno.test("location is an eligibility gate, not a positive match reason", () => {
  const result = initialScreening(job, profile, evidence);
  if (result.status !== "eligible") throw new Error(JSON.stringify(result));
  if (result.reasons.some((reason) => reason.code.includes("location"))) {
    throw new Error("matching location must not create a positive reason");
  }
});

Deno.test("location outside preference is excluded", () => {
  const result = initialScreening(
    { ...job, location: "Bergen" },
    profile,
    evidence,
  );
  if (result.status !== "excluded") throw new Error(JSON.stringify(result));
  if (
    !result.reasons.some((reason) =>
      reason.code === "location_outside_preference"
    )
  ) {
    throw new Error("missing location exclusion");
  }
});

Deno.test("missing location requires review", () => {
  const result = initialScreening(
    { ...job, location: null },
    profile,
    evidence,
  );
  if (result.status !== "needs_review") throw new Error(JSON.stringify(result));
});

Deno.test("remote job bypasses the location gate", () => {
  const result = initialScreening(
    { ...job, location: "Norge", work_type: "Remote" },
    profile,
    evidence,
  );
  if (result.status !== "eligible") throw new Error(JSON.stringify(result));
});

Deno.test("reporting to COO is not a COO title match", () => {
  const result = initialScreening(
    {
      ...job,
      title: "Delivery and Operation lead",
      description:
        "Rollen rapporterer direkte til COO og samarbeider med ledergruppen.",
    },
    profile,
    evidence,
  );
  if (result.status !== "excluded") throw new Error(JSON.stringify(result));
  if (
    !result.reasons.some((reason) =>
      reason.code === "target_role_only_in_reporting_line"
    )
  ) {
    throw new Error("reporting-line-only match was not detected");
  }
});

Deno.test("regulated legal title without documented education is excluded", () => {
  const result = initialScreening({ ...job, title: "Jurist" }, {
    ...profile,
    target_roles: ["Jurist"],
  }, evidence);
  if (result.status !== "excluded") throw new Error(JSON.stringify(result));
  if (
    !result.reasons.some((reason) =>
      reason.code === "missing_legal_qualification"
    )
  ) {
    throw new Error("missing legal qualification was not detected");
  }
});

Deno.test("regulated legal title accepts documented legal education", () => {
  const legalEvidence = [...evidence, {
    ref: "cv:law",
    category: "education",
    label: "Master i rettsvitenskap",
    description: "Universitetet i Oslo",
  }];
  const result = initialScreening(
    { ...job, title: "Jurist" },
    { ...profile, target_roles: ["Jurist"] },
    legalEvidence,
  );
  if (result.status !== "eligible") throw new Error(JSON.stringify(result));
});

Deno.test("unknown work extent does not hide an otherwise eligible job", () => {
  const result = initialScreening(
    { ...job, work_extent: null, engagement_type: null },
    profile,
    evidence,
  );
  if (result.status !== "eligible") throw new Error(JSON.stringify(result));
});

Deno.test("excerpt-only job text requires review", () => {
  const result = initialScreening(
    { ...job, description_complete: false },
    profile,
    evidence,
  );
  if (result.status !== "needs_review") throw new Error(JSON.stringify(result));
});

Deno.test("mandatory degree without matched evidence is excluded", () => {
  const fullDescription =
    "Du må ha mastergrad i rettsvitenskap for å kunne fylle rollen.";
  const initial = initialScreening(
    { ...job, description: fullDescription },
    profile,
    evidence,
  );
  const result = finalizeEvaluation(
    initial,
    {
      score: 91,
      reasoning: "God ledermatch",
      match_highlights: "Ledererfaring",
      concerns: "",
      requirements: [{
        type: "education",
        level: "mandatory",
        label: "Mastergrad i rettsvitenskap",
        evidence_quote: "må ha mastergrad i rettsvitenskap",
        met: true,
        matched_evidence_refs: [],
      }],
    },
    fullDescription,
    evidence,
  );
  if (result.status !== "excluded" || result.score !== 0) {
    throw new Error(JSON.stringify(result));
  }
});

Deno.test("unsupported requirement quote is ignored and explicit requirement stays review", () => {
  const fullDescription =
    "Du må ha mastergrad i rettsvitenskap for å kunne fylle rollen.";
  const initial = initialScreening(
    { ...job, description: fullDescription },
    profile,
    evidence,
  );
  const result = finalizeEvaluation(
    initial,
    {
      score: 91,
      requirements: [{
        type: "education",
        level: "mandatory",
        label: "Sivilingeniør",
        evidence_quote: "må ha doktorgrad i fysikk",
        met: true,
        matched_evidence_refs: ["ue:leadership"],
      }],
    },
    fullDescription,
    evidence,
  );
  if (result.status !== "needs_review") throw new Error(JSON.stringify(result));
  if (
    !result.reasons.some((reason) =>
      reason.code === "mandatory_qualification_unparsed"
    )
  ) {
    throw new Error("unparsed explicit qualification was not held for review");
  }
});

Deno.test("invalid AI score never becomes eligible", () => {
  const initial = initialScreening(job, profile, evidence);
  const result = finalizeEvaluation(
    initial,
    { score: "90", requirements: [] },
    job.description,
    evidence,
  );
  if (result.status !== "needs_review" || result.score !== 0) {
    throw new Error(JSON.stringify(result));
  }
});
