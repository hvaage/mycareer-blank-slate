# Atom-typer — detaljert referanse

Skjema-versjon: 1.1

Hver atom har dette grunnleggende skjemaet (felles for alle typer):

```typescript
interface AtomBase {
  id: string;                    // UUID
  user_id: string;               // UUID, references auth.users
  atom_type: AtomType;
  parent_atom_id: string | null;
  content_no: string | null;
  content_en: string | null;
  structured_data: Record<string, unknown> | null;
  source_type: SourceType;
  source_ref: string | null;     // f.eks. import-id, session-id, fil-sti
  source_quote: string | null;   // brukerens egne ord ved interview/manual
  confidence: 'verified' | 'imported' | 'inferred';
  user_confirmed: boolean;
  user_locked: boolean;
  created_at: string;
  updated_at: string;
}
```

`structured_data`-feltet er en JSONB i databasen. Form og krav avhenger av
`atom_type`. Resten av denne filen beskriver formen for hver type.

---

## role

En stilling/jobb hos én arbeidsgiver. Toppnivå-atom. Andre atoms (achievements,
contexts, tools, projects) refererer hit via `parent_atom_id`.

```typescript
interface RoleStructuredData {
  employer: string;                    // påkrevd. Selskapets navn slik brukeren skriver det.
  employer_normalized?: string;        // valgfritt — uppercase + trimmet for matching
  title: string;                       // påkrevd. Stillingstittel.
  start_date: string;                  // påkrevd. YYYY-MM
  end_date: string | null;             // null = pågående. YYYY-MM ellers.
  location: string | null;             // f.eks. "Oslo, Norge"
  employment_type: string | null;      // 'fulltime' | 'parttime' | 'contract' | 'freelance' | 'internship'
  industry: string | null;
  employer_size: string | null;        // 'startup' | 'sme' | 'large' | 'enterprise'
  employer_description: string | null; // 1–2 setninger om selskapet
  is_current: boolean;
}
```

`content_no` og `content_en` skal være en kort beskrivelse av selve rollen
(2–4 setninger), uten å overlappe med achievements. Eksempel:

> Operasjonell direktør for Cisco Norge med ansvar for forretningsdrift,
> prognose og performance management. Ledet overgangen fra produktsalg til
> abonnementsmodell sammen med landsjef.

### Påkrevd

- `employer`
- `title`
- `start_date` (YYYY-MM)

### Validerings-tips

- `end_date >= start_date` når begge er satt
- `is_current=true` impliserer `end_date=null`
- `start_date` må være ≤ dagens dato

---

## achievement

En konkret prestasjon i en rolle. Må ha `parent_atom_id` som peker til en `role`.

```typescript
interface AchievementStructuredData {
  // XYZ-formel — Google's bullet-rammeverk
  what: string;                  // påkrevd. Hva oppnådde du.
  how_measured: string | null;   // hvordan ble det målt
  how_done: string | null;       // hvordan gjorde du det

  // CAR-rammeverk for soft achievements (alternativ til XYZ)
  challenge: string | null;
  action: string | null;
  result: string | null;

  // Metadata
  category: string | null;       // 'leadership' | 'sales' | 'product' | 'operations' | 'technical' | 'team' | 'change' | 'other'
  scope_team_size: number | null;
  scope_budget_text: string | null;  // f.eks. "NOK 50 mill."
  date_period: string | null;    // f.eks. "Q1 2023" eller "2022–2023"
  is_team_achievement: boolean;  // true hvis prestasjonen er kollektiv
  semantic_key?: string;         // konseptnøkkel fra cv-atom-language-no
  semantic_aliases?: string[];   // kildeformuleringer med samme mulige betydning
  ownership_level?: 'observed' | 'participated' | 'contributed' |
    'coordinated' | 'responsible' | 'led' | 'owned' | 'unclear';
}
```

`content_no` og `content_en` er den endelige bullet-formuleringen. AI kan
omformulere `content_no`/`content_en` ved tailoring, men `structured_data.what`
er kanonisk og skal ikke endres uten brukerens samtykke.

### Påkrevd

- `parent_atom_id` (peker til role)
- `structured_data.what`
- Enten XYZ-trippel (what + how_measured + how_done) eller CAR-trippel
  (challenge + action + result) skal være meningsfullt utfylt

### Eksempel

```json
{
  "atom_type": "achievement",
  "parent_atom_id": "...role-id...",
  "structured_data": {
    "what": "Etablerte Symantec Norge fra null til markedsledende posisjon",
    "how_measured": "USD 45 mill. omsetning og 27 ansatte",
    "how_done": "Bygde komplett salgs- og markedsorganisasjon, etablerte partnerkanal og posisjonerte selskapet i B2B og B2C",
    "category": "leadership",
    "scope_team_size": 27,
    "date_period": "1998–2003",
    "is_team_achievement": false
  },
  "content_no": "Etablerte Symantec Norge alene; bygget organisasjonen til 27 ansatte og USD 45 mill. i omsetning."
}
```

---

## metric

En kvantifisert måling knyttet til en achievement. Kan brukes som standalone
hvis prestasjonen er for kompleks til å beskrive i achievement.what.

```typescript
interface MetricStructuredData {
  value: number;                 // tallverdi
  unit: string;                  // 'NOK' | '%' | 'persons' | 'months' | 'USD' | 'MRR' | 'ARR' | annet
  metric_type: string;           // 'revenue' | 'growth' | 'team_size' | 'cost_savings' | 'time_to_market' | 'satisfaction' | 'other'
  period: string | null;         // f.eks. "2023" | "Q4 2022" | "12 months"
  comparison: string | null;     // 'vs prior year' | 'vs plan' | 'vs industry' | null
  is_estimate: boolean;          // true hvis brukeren kun har et estimat
  measurement_method: string | null;  // f.eks. "internal data warehouse" | "customer survey"
}
```

### Påkrevd

- `parent_atom_id` (peker til achievement)
- `value` (number)
- `unit`

---

## context

Bakgrunnskontekst om role som ikke er en achievement. F.eks. "rapporterte til
CEO og styret", "satt i ledergruppen for Norge". Toppnivå er role; context er
child av role.

```typescript
interface ContextStructuredData {
  context_type: string;          // 'reporting_line' | 'team_size' | 'organizational' | 'business_context' | 'other'
  detail: string;                // hovedinnhold
  semantic_key?: string;
}
```

Innhold legges typisk i `content_no` og `content_en` direkte.

---

## tool

En teknologi, plattform eller verktøy brukt i en rolle. Kan være child av role
eller standalone (når brukeren har en generell ferdighet uten å knytte den til
spesifikk rolle).

```typescript
interface ToolStructuredData {
  name: string;                  // f.eks. "Salesforce", "MEDDPICC", "Python"
  category: string;              // 'crm' | 'methodology' | 'language' | 'platform' | 'framework' | 'other'
  proficiency: string | null;    // 'expert' | 'proficient' | 'familiar'
  years_used: number | null;
}
```

---

## education

En utdanningsoppføring. Toppnivå-atom.

```typescript
interface EducationStructuredData {
  institution: string;           // påkrevd
  institution_normalized?: string;
  degree: string;                // påkrevd. F.eks. "Bachelor", "Siviløkonom", "MSc"
  field: string | null;          // studieretning
  start_year: number;            // påkrevd. YYYY.
  end_year: number | null;       // null hvis pågående
  thesis_title: string | null;
  honors: string | null;         // f.eks. "Cum laude"
  grade: string | null;
}
```

`content_no` og `content_en` brukes hvis utdanningsoppføringen trenger
fritekstforklaring (f.eks. spesialiseringsfag).

---

## skill

En ferdighet eller kompetanse. Toppnivå.

```typescript
interface SkillStructuredData {
  name: string;                  // påkrevd
  name_normalized?: string;      // for matching/dedup
  category: string;              // 'technical' | 'leadership' | 'language' | 'tool' | 'methodology' | 'domain' | 'soft' | 'other'
  proficiency: string | null;    // 'expert' | 'proficient' | 'familiar'
  years_used: number | null;
  evidence_atom_ids: string[];   // valgfritt — referanse til achievements/roles som beviser ferdigheten
  semantic_key?: string;
  semantic_aliases?: string[];
}
```

`content_no` og `content_en` er typisk like som `name` for tekniske skills,
men kan utvides med kontekst for kompetanseområder ("Strategisk salgsledelse —
ARR-vekst og lifecycle selling").

---

## language

Språkkompetanse. Toppnivå.

```typescript
interface LanguageStructuredData {
  language: string;              // påkrevd. F.eks. "Norsk", "English", "Tysk"
  level: string;                 // 'native' | 'fluent' | 'professional' | 'conversational' | 'basic'
  cefr: string | null;           // A1 | A2 | B1 | B2 | C1 | C2
}
```

---

## certification

Et sertifikat eller kurs. Toppnivå.

```typescript
interface CertificationStructuredData {
  name: string;                  // påkrevd. F.eks. "MEDDPICC Certified"
  issuer: string;                // påkrevd
  issued_date: string | null;    // YYYY-MM
  expires_date: string | null;
  credential_id: string | null;
  credential_url: string | null;
}
```

---

## project

Et navngitt prosjekt. Kan være child av role (knyttet til en jobb) eller
toppnivå (sideprosjekt, open source, frivillig).

```typescript
interface ProjectStructuredData {
  name: string;                  // påkrevd
  description: string;           // påkrevd. 1–3 setninger.
  role_in_project: string | null;
  start_date: string | null;     // YYYY-MM
  end_date: string | null;
  url: string | null;
  technologies: string[];
  outcomes: string[];            // korte resultatpunkter
}
```

---

## volunteer

Frivillig rolle. Toppnivå. Strukturen ligner på `role` men markert tydelig
som ulønnet/frivillig.

```typescript
interface VolunteerStructuredData {
  organization: string;          // påkrevd
  role: string;                  // påkrevd
  start_date: string;            // YYYY-MM
  end_date: string | null;
  cause: string | null;          // f.eks. "Barn og ungdom", "Miljø"
}
```

---

## summary_fragment

Byggekloss til profilsammendrag. En kort setning eller fragment som AI kan
sette sammen til en summary i master-CV. Toppnivå.

```typescript
interface SummaryFragmentStructuredData {
  fragment_type: string;         // 'value_proposition' | 'experience_summary' | 'specialization' | 'motivation' | 'differentiator'
  weight: number;                // 1–10. Hvor sentralt fragmentet er for brukerens identitet.
  semantic_key?: string;
}
```

`content_no` og `content_en` er den faktiske teksten. Eksempel:

> Senior teknologi- og kommersialiseringsleder med 25+ års erfaring fra
> enterprise IT, SaaS og PropTech.

Fragments brukes til å bygge en kontrollert profilsammendrag som ikke
fabrikkerer påstander. Hvert fragment må selv kunne forsvares av andre atoms
i grafen (typisk role + achievement-kombinasjoner).

---

## Hierarki — sammendrag

```
role (toppnivå)
├── achievement
│   └── metric
├── context
├── tool
└── project (når knyttet til rolle)

education (toppnivå)
skill (toppnivå, refererer kanskje til achievement-id-er)
language (toppnivå)
certification (toppnivå)
project (toppnivå hvis standalone)
volunteer (toppnivå)
summary_fragment (toppnivå)
```

---

## Datoformat

Alle datoer i `structured_data`:

- Måned-presisjon: `YYYY-MM` (f.eks. `2024-06`)
- Bare år: `YYYY` (kun i `education.start_year` og `end_year` som number)

Bruk ikke `YYYY-MM-DD` med mindre den eksakte dagen er meningsfull
(sjelden tilfelle for CV-data).

---

*Skjema-versjon 1.1 - additiv utvidelse 16. august 2026*
