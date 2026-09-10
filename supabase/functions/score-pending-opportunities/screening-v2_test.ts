import {
  buildCalculatedExperienceEvidence,
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

function roleEvidence(
  id: string,
  title: string,
  employer: string,
  start: string,
  end: string | null,
  extra = "",
): EvidenceItem {
  return {
    ref: `ca:${id}`,
    category: "erfaring",
    label: `${title} hos ${employer}`,
    description: extra,
    atom_type: "role",
    structured_data: {
      title,
      employer,
      start_date: start,
      end_date: end,
      industry: extra,
      employer_description: extra,
      employer_size: "enterprise",
      is_current: end === null,
    },
    confidence: "verified",
    attestation: "selvrapportert",
    user_confirmed: true,
    evidence_kind: "explicit",
  };
}

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

Deno.test("CCO title matches the saved Sales role family", () => {
  const result = initialScreening(
    {
      ...job,
      title: "Chief Commercial Officer (CCO)",
      description: "Som CCO får du ansvaret for kommersiell strategi og salg.",
    },
    { ...profile, target_roles: ["Salg"] },
    evidence,
  );
  if (result.status !== "eligible") throw new Error(JSON.stringify(result));
});

Deno.test("Commercial Manager does not satisfy a narrow CCO target", () => {
  const result = initialScreening(
    { ...job, title: "Commercial Manager" },
    profile,
    evidence,
  );
  if (result.status !== "excluded") throw new Error(JSON.stringify(result));
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

Deno.test("regulated legal title without documented education requires review", () => {
  const result = initialScreening({ ...job, title: "Jurist" }, {
    ...profile,
    target_roles: ["Jurist"],
  }, evidence);
  if (result.status !== "needs_review") throw new Error(JSON.stringify(result));
  if (
    !result.reasons.some((reason) =>
      reason.code === "missing_legal_qualification" &&
      reason.evaluation_status === "UNVERIFIED"
    )
  ) {
    throw new Error("missing legal qualification should be unverified");
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

Deno.test("mandatory degree without matched evidence is unverified, not excluded", () => {
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
  if (result.status !== "needs_review" || result.score !== 0) {
    throw new Error(JSON.stringify(result));
  }
  if (
    !result.requirements.some((req) =>
      req.evaluation_status === "UNVERIFIED" && req.met === null
    )
  ) {
    throw new Error("missing evidence must stay unverified");
  }
});

Deno.test("documented not satisfied mandatory requirement is excluded", () => {
  const fullDescription =
    "Du må ha gyldig førerkort klasse B for å kunne fylle rollen.";
  const negativeEvidence: EvidenceItem[] = [
    ...evidence,
    {
      ref: "ca:no-license",
      category: "kvalifikasjon",
      label: "Har ikke førerkort",
      description: "Brukeren har ikke førerkort klasse B.",
      evidence_kind: "explicit",
    },
  ];
  const result = finalizeEvaluation(
    initialScreening(
      { ...job, description: fullDescription },
      profile,
      negativeEvidence,
    ),
    {
      score: 70,
      requirements: [{
        type: "license",
        level: "mandatory",
        label: "Førerkort klasse B",
        evidence_quote: "må ha gyldig førerkort klasse B",
        met: false,
        evaluation_status: "NOT_SATISFIED",
        matched_evidence_refs: ["ca:no-license"],
      }],
    },
    fullDescription,
    negativeEvidence,
  );
  if (result.status !== "excluded") throw new Error(JSON.stringify(result));
  if (
    !result.reasons.some((reason) =>
      reason.evaluation_status === "NOT_SATISFIED"
    )
  ) {
    throw new Error("documented negative evidence must remain excludable");
  }
});

Deno.test("raw false with unrelated positive evidence is unverified", () => {
  const fullDescription =
    "Du må ha mastergrad i rettsvitenskap for å kunne fylle rollen.";
  const result = finalizeEvaluation(
    initialScreening(
      { ...job, description: fullDescription },
      profile,
      evidence,
    ),
    {
      score: 80,
      requirements: [{
        type: "education",
        level: "mandatory",
        label: "Mastergrad i rettsvitenskap",
        evidence_quote: "må ha mastergrad i rettsvitenskap",
        met: false,
        matched_evidence_refs: ["ue:leadership"],
      }],
    },
    fullDescription,
    evidence,
  );
  if (result.status !== "needs_review") throw new Error(JSON.stringify(result));
  if (
    !result.requirements.some((req) =>
      req.evaluation_status === "UNVERIFIED" && req.met === null
    )
  ) {
    throw new Error("unrelated positive evidence cannot prove NOT_SATISFIED");
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

Deno.test("calculated experience aggregates overlapping periods without double counting", () => {
  const overlappingRoles = [
    roleEvidence(
      "sales-a",
      "Enterprise Sales Director",
      "Cisco",
      "2010-01",
      "2015-12",
      "Technology sales, cloud and enterprise accounts",
    ),
    roleEvidence(
      "sales-b",
      "Regional Sales Manager",
      "NetApp",
      "2014-01",
      "2018-12",
      "Technology sales, SaaS and partner channel",
    ),
  ];
  const calculated = buildCalculatedExperienceEvidence(overlappingRoles, {
    now: new Date("2019-01-01T00:00:00Z"),
  });
  const sales = calculated.find((item) =>
    item.ref === "derived:experience:sales"
  );
  if (!sales?.computed_experience) throw new Error(JSON.stringify(calculated));
  if (sales.computed_experience.months !== 108) {
    throw new Error(
      `expected 108 months, got ${sales.computed_experience.months}`,
    );
  }
});

Deno.test("Nerdio regression: 5 to 7 years sales preferably technology is satisfied by long tech sales history", () => {
  const fullDescription =
    "We are looking for a Principal Regional Sales Manager. Requirements include 5 to 7 years of experience in sales, preferably in the technology industry.";
  const techSalesEvidence = [
    roleEvidence(
      "symantec",
      "Sales Director",
      "Symantec Norge",
      "1998-01",
      "2008-12",
      "Technology industry. Built sales, partner channel and enterprise revenue.",
    ),
    roleEvidence(
      "netapp",
      "Enterprise Account Manager",
      "NetApp",
      "2009-01",
      "2017-12",
      "Technology sales for enterprise customers and cloud infrastructure.",
    ),
    roleEvidence(
      "cisco",
      "Commercial Lead",
      "Cisco",
      "2018-01",
      "2025-12",
      "SaaS, cloud, partner channel and distributed Nordic sales teams.",
    ),
  ];
  const withCalculated = [
    ...buildCalculatedExperienceEvidence(techSalesEvidence, {
      now: new Date("2026-01-01T00:00:00Z"),
    }),
    ...techSalesEvidence,
  ];
  const result = finalizeEvaluation(
    initialScreening(
      {
        ...job,
        title: "Principal Regional Sales Manager - Nordics",
        location: "Norge",
        work_type: "remote",
        description: fullDescription,
      },
      { ...profile, target_roles: ["Salg"], preferred_locations: ["Norge"] },
      withCalculated,
    ),
    {
      score: 88,
      reasoning: "Sterk match.",
      match_highlights: "Lang dokumentert teknologisk salgserfaring.",
      concerns: "",
      requirements: [{
        type: "experience",
        level: "mandatory",
        label:
          "5 to 7 years of experience in sales, preferably in the technology industry",
        evidence_quote:
          "5 to 7 years of experience in sales, preferably in the technology industry",
        met: false,
        matched_evidence_refs: [],
      }],
    },
    fullDescription,
    withCalculated,
  );
  if (result.status !== "eligible") throw new Error(JSON.stringify(result));
  if (result.requirements.length !== 2) {
    throw new Error(JSON.stringify(result.requirements));
  }
  if (
    !result.requirements.some((req) =>
      req.level === "mandatory" &&
      req.evaluation_status === "SATISFIED" &&
      req.matched_evidence_refs.includes("derived:experience:sales")
    )
  ) {
    throw new Error(
      "mandatory sales experience should be satisfied by derived evidence",
    );
  }
  if (
    !result.requirements.some((req) =>
      req.level === "preferred" &&
      req.evaluation_status === "SATISFIED" &&
      req.matched_evidence_refs.includes("derived:experience:technology_sales")
    )
  ) {
    throw new Error(
      "preferred technology sales should be satisfied by derived evidence",
    );
  }
});

// — v6: CxO-/forkortelsestaksonomi og æøå-normalisering —

Deno.test("CFO title matches the Finans role family", () => {
  const result = initialScreening(
    { ...job, title: "Chief Financial Officer (CFO)" },
    { ...profile, target_roles: ["Finans"] },
    evidence,
  );
  if (result.status !== "eligible") throw new Error(JSON.stringify(result));
});

Deno.test("CMO title matches the Markedsføring family after æøå normalization", () => {
  const result = initialScreening(
    { ...job, title: "CMO" },
    { ...profile, target_roles: ["Markedsføring"] },
    evidence,
  );
  if (result.status !== "eligible") throw new Error(JSON.stringify(result));
});

Deno.test("Adm. dir. matches a CEO target role", () => {
  const result = initialScreening(
    { ...job, title: "Adm. dir." },
    { ...profile, target_roles: ["CEO"] },
    evidence,
  );
  if (result.status !== "eligible") throw new Error(JSON.stringify(result));
});

Deno.test("Administrerende direktør title matches a CEO target role", () => {
  const result = initialScreening(
    { ...job, title: "Administrerende direktør" },
    { ...profile, target_roles: ["CEO"] },
    evidence,
  );
  if (result.status !== "eligible") throw new Error(JSON.stringify(result));
});

Deno.test("PM abbreviation matches the Prosjektledelse family", () => {
  const result = initialScreening(
    { ...job, title: "Senior PM" },
    { ...profile, target_roles: ["Prosjektledelse"] },
    evidence,
  );
  if (result.status !== "eligible") throw new Error(JSON.stringify(result));
});

Deno.test("CHRO matches the HR / People family", () => {
  const result = initialScreening(
    { ...job, title: "CHRO" },
    { ...profile, target_roles: ["HR / People"] },
    evidence,
  );
  if (result.status !== "eligible") throw new Error(JSON.stringify(result));
});

Deno.test("CISO matches the Utvikling / tech family", () => {
  const result = initialScreening(
    { ...job, title: "CISO" },
    { ...profile, target_roles: ["Utvikling / tech"] },
    evidence,
  );
  if (result.status !== "eligible") throw new Error(JSON.stringify(result));
});

Deno.test("EVP matches a konserndirektør target role", () => {
  const result = initialScreening(
    { ...job, title: "EVP Commercial" },
    { ...profile, target_roles: ["Konserndirektør"] },
    evidence,
  );
  if (result.status !== "eligible") throw new Error(JSON.stringify(result));
});

Deno.test("word boundary still prevents Produksjonssjef from matching Produkt", () => {
  const result = initialScreening(
    { ...job, title: "Produksjonssjef" },
    { ...profile, target_roles: ["Produkt"] },
    evidence,
  );
  if (result.status !== "excluded") throw new Error(JSON.stringify(result));
  if (
    !result.reasons.some((reason) => reason.code === "target_role_mismatch")
  ) {
    throw new Error("expected target_role_mismatch");
  }
});

type RegressionCase = {
  name: string;
  quote: string;
  type:
    | "education"
    | "license"
    | "certification"
    | "language"
    | "experience"
    | "skill"
    | "other";
  level: "mandatory" | "preferred" | "context";
  met: boolean | null;
  refs: string[];
  expectedRequirementStatus: "SATISFIED" | "UNVERIFIED" | "NOT_SATISFIED";
  expectedStatus: "eligible" | "excluded" | "needs_review";
  equivalent?: boolean;
  upperIsMax?: boolean;
};

const regressionBaseRoles = [
  roleEvidence(
    "reg-sales",
    "Enterprise Sales Director",
    "Cisco",
    "2010-01",
    "2025-12",
    "Technology sales, cloud, SaaS, partner channel, enterprise and Nordic distributed sales teams.",
  ),
  roleEvidence(
    "reg-lead",
    "Commercial Manager",
    "NetApp",
    "2004-01",
    "2009-12",
    "Technology industry leadership and global enterprise sales team.",
  ),
];

const regressionEvidence: EvidenceItem[] = [
  ...buildCalculatedExperienceEvidence(regressionBaseRoles, {
    now: new Date("2026-01-01T00:00:00Z"),
  }),
  ...regressionBaseRoles,
  {
    ref: "ca:degree",
    category: "kvalifikasjon",
    label: "Master i økonomi",
    description: "Dokumentert mastergrad i økonomi.",
    evidence_kind: "explicit",
  },
  {
    ref: "ca:language",
    category: "kompetanse",
    label: "Flytende norsk og engelsk",
    description: "Bruker norsk og engelsk profesjonelt.",
    evidence_kind: "explicit",
  },
  {
    ref: "ca:cert",
    category: "kvalifikasjon",
    label: "AWS Certified Cloud Practitioner",
    description: "Gyldig AWS-sertifisering.",
    evidence_kind: "explicit",
  },
  {
    ref: "ca:no-license",
    category: "kvalifikasjon",
    label: "Har ikke førerkort klasse B",
    description: "Brukeren har ikke førerkort klasse B.",
    evidence_kind: "explicit",
  },
  {
    ref: "ca:no-clearance",
    category: "kvalifikasjon",
    label: "Mangler sikkerhetsklarering",
    description: "Brukeren mangler sikkerhetsklarering.",
    evidence_kind: "explicit",
  },
  {
    ref: "ca:no-german",
    category: "kompetanse",
    label: "Snakker ikke tysk",
    description: "Brukeren har ikke profesjonell tysk.",
    evidence_kind: "explicit",
  },
];

const missingMandatoryQuotes: Array<[string, RegressionCase["type"]]> = [
  ["Minimum 5 years of experience in sales", "experience"],
  ["At least 7 years of enterprise sales experience", "experience"],
  ["Must have 3 years of SaaS experience", "experience"],
  ["Required experience managing distributed teams", "experience"],
  ["Minimum 4 years of partner channel experience", "experience"],
  ["5 to 7 years of leadership experience", "experience"],
  ["Bachelor degree in computer science", "education"],
  ["Mastergrad i rettsvitenskap", "education"],
  ["Relevant higher education or equivalent experience", "education"],
  ["Valid driver license class B", "license"],
  ["Security clearance required", "license"],
  ["AWS certification required", "certification"],
  ["PMP certification is mandatory", "certification"],
  ["Fluent Norwegian is required", "language"],
  ["Professional German language skills required", "language"],
  ["Must know Salesforce CRM", "skill"],
  ["Required knowledge of Microsoft Azure", "skill"],
  ["Minimum 5 years in the technology industry", "experience"],
  ["Experience selling cloud computing solutions required", "experience"],
  ["Must have public sector sales experience", "experience"],
];

const preferredQuotes: Array<[string, RegressionCase["type"]]> = [
  ["Preferably experience in the technology industry", "experience"],
  ["Preferred SaaS sales background", "experience"],
  ["Azure knowledge would be advantageous", "skill"],
  ["Ideally experience managing remote teams", "experience"],
  ["Partner channel experience is a plus", "experience"],
  ["Norwegian language skills preferred", "language"],
  ["MBA would be advantageous", "education"],
  ["PMP certification nice to have", "certification"],
  ["Cloud marketplace experience is a bonus", "experience"],
  ["Experience with enterprise global sales teams preferred", "experience"],
  ["Knowledge of Microsoft Azure preferred", "skill"],
  ["Danish language skills are advantageous", "language"],
  ["Cybersecurity sales exposure ideally", "experience"],
  ["Public sector experience would be a plus", "experience"],
  ["Experience with distributed teams preferably", "experience"],
];

const satisfiedQuotes: Array<[string, RegressionCase["type"], string[]]> = [
  ["Minimum 5 years of experience in sales", "experience", []],
  ["5 to 7 years of experience in sales", "experience", []],
  ["At least 10 years of technology sales experience", "experience", []],
  ["Minimum 4 years of enterprise experience", "experience", []],
  ["Required SaaS or cloud experience", "experience", []],
  ["Partner channel experience required", "experience", []],
  ["Leadership experience is required", "experience", []],
  ["Experience managing distributed sales teams required", "experience", []],
  ["Proven enterprise global sales team experience", "experience", []],
  ["Experience selling cloud computing solutions required", "experience", []],
  ["Relevant higher education or equivalent experience", "education", [
    "ca:degree",
  ]],
  ["Master degree in business required", "education", ["ca:degree"]],
  ["Fluent Norwegian and English required", "language", ["ca:language"]],
  ["AWS certification required", "certification", ["ca:cert"]],
  ["Knowledge of CRM software required", "skill", ["ca:reg-sales"]],
  ["Strong sales processes and techniques required", "skill", ["ca:reg-sales"]],
  ["Enterprise account management required", "experience", []],
  ["Technology industry background required", "experience", []],
  ["Commercial leadership required", "experience", []],
  ["Cloud infrastructure sales experience required", "experience", []],
];

const notSatisfiedCases: RegressionCase[] = [
  {
    name: "documented missing license",
    quote: "Valid driver license class B required",
    type: "license",
    level: "mandatory",
    met: false,
    refs: ["ca:no-license"],
    expectedRequirementStatus: "NOT_SATISFIED",
    expectedStatus: "excluded",
  },
  {
    name: "documented missing security clearance",
    quote: "Security clearance required",
    type: "license",
    level: "mandatory",
    met: false,
    refs: ["ca:no-clearance"],
    expectedRequirementStatus: "NOT_SATISFIED",
    expectedStatus: "excluded",
  },
  {
    name: "documented missing German",
    quote: "Professional German language skills required",
    type: "language",
    level: "mandatory",
    met: false,
    refs: ["ca:no-german"],
    expectedRequirementStatus: "NOT_SATISFIED",
    expectedStatus: "excluded",
  },
  {
    name: "explicit maximum years",
    quote: "Up to 2 years of sales experience required",
    type: "experience",
    level: "mandatory",
    met: null,
    refs: [],
    expectedRequirementStatus: "NOT_SATISFIED",
    expectedStatus: "excluded",
    upperIsMax: true,
  },
  {
    name: "explicit max Norwegian",
    quote: "Maximum 3 years of leadership experience",
    type: "experience",
    level: "mandatory",
    met: null,
    refs: [],
    expectedRequirementStatus: "NOT_SATISFIED",
    expectedStatus: "excluded",
    upperIsMax: true,
  },
];

const requirementRegressionCases: RegressionCase[] = [
  ...missingMandatoryQuotes.map(([quote, type]) => ({
    name: `missing mandatory: ${quote}`,
    quote,
    type,
    level: "mandatory" as const,
    met: false,
    refs: [],
    expectedRequirementStatus: "UNVERIFIED" as const,
    expectedStatus: "needs_review" as const,
    equivalent: quote.toLowerCase().includes("equivalent"),
  })),
  ...preferredQuotes.map(([quote, type]) => ({
    name: `preferred: ${quote}`,
    quote,
    type,
    level: "preferred" as const,
    met: null,
    refs: [],
    expectedRequirementStatus:
      /\b(technology|saas|partner|channel|enterprise|distributed|remote teams?|cloud|cybersecurity)\b/i
          .test(quote) && type === "experience"
        ? "SATISFIED" as const
        : "UNVERIFIED" as const,
    expectedStatus: "eligible" as const,
  })),
  ...satisfiedQuotes.map(([quote, type, refs]) => ({
    name: `satisfied: ${quote}`,
    quote,
    type,
    level: "mandatory" as const,
    met: refs.length > 0 ? true : null,
    refs,
    expectedRequirementStatus: "SATISFIED" as const,
    expectedStatus: "eligible" as const,
    equivalent: quote.toLowerCase().includes("equivalent"),
  })),
  ...notSatisfiedCases,
];

Deno.test("representative requirement regression set covers UNKNOWN, modality and interval handling", () => {
  if (
    requirementRegressionCases.length < 50 ||
    requirementRegressionCases.length > 100
  ) {
    throw new Error(
      `expected 50-100 regression cases, got ${requirementRegressionCases.length}`,
    );
  }

  for (const item of requirementRegressionCases) {
    const description = `Role requirements: ${item.quote}.`;
    const evidenceForCase = item.name.startsWith("missing mandatory")
      ? evidence
      : regressionEvidence;
    const result = finalizeEvaluation(
      initialScreening(
        { ...job, title: "Enterprise Sales Director", description },
        { ...profile, target_roles: ["Salg"] },
        evidenceForCase,
      ),
      {
        score: 75,
        reasoning: "Regresjonstest.",
        match_highlights: "Treff.",
        concerns: "",
        requirements: [{
          type: item.type,
          level: item.level,
          label: item.quote,
          evidence_quote: item.quote,
          met: item.met,
          evaluation_status: item.expectedRequirementStatus,
          matched_evidence_refs: item.refs,
        }],
      },
      description,
      evidenceForCase,
    );
    const req = result.requirements.find((candidate) =>
      candidate.evidence_quote === item.quote
    );
    if (!req) throw new Error(`missing parsed requirement: ${item.name}`);
    if (req.evaluation_status !== item.expectedRequirementStatus) {
      throw new Error(
        `${item.name}: expected ${item.expectedRequirementStatus}, got ${req.evaluation_status}`,
      );
    }
    if (result.status !== item.expectedStatus) {
      throw new Error(
        `${item.name}: expected status ${item.expectedStatus}, got ${result.status}`,
      );
    }
    if (item.equivalent && req.normalized?.allows_equivalent !== true) {
      throw new Error(`${item.name}: expected equivalent normalization`);
    }
    if (item.upperIsMax && req.normalized?.upper_is_max !== true) {
      throw new Error(`${item.name}: expected explicit max interval`);
    }
    if (
      /\b\d+\s*(?:to|-|–|—|til)\s*\d+\s*(?:years|år|ar)\b/i.test(item.quote) &&
      req.normalized?.upper_is_max === true &&
      !item.upperIsMax
    ) {
      throw new Error(`${item.name}: normal range must not become maximum`);
    }
  }
});
