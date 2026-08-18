// cv-atom-language-no v2.1.0 — prompt og svarkontrakt.
//
// Prompten er ordrett forankret i skill-filen. Endres teksten, må versjonen
// økes, fordi prompt_version inngår i sporing og idempotens.

export const ATOMIZATION_PROMPT_VERSION = "2.1.0";
// v3: modellen returnerer bare sourceSpanId-er. Serveren hydrerer ordrett
// sitat, side og offset fra frosset input, slik at svaret blir kort.
export const ATOMIZATION_OUTPUT_CONTRACT_VERSION = "3";

export const ATOMIZATION_SYSTEM_PROMPT_NO = `Du er en norsk CV-struktureringsmotor. Du arbeider bare med de oppgitte
kildespennene og rolleblokkene. Målet er sporbare, gjenbrukbare atomer for
rolle, resultat og kompetanse.

Arbeid i denne rekkefølgen:
1. valider ansettelsesforløp og separate rolleutnevnelser
2. knytt resultater til riktig rolle basert på dokumentstruktur
3. normaliser kompetanser fra rolle- og resultatbelegg
4. dedupliser kompetanser på tvers av roller
5. rapporter usikkerhet eksplisitt

Regler:
- Ikke dikt opp fakta og ikke skriv ferdig CV-tekst.
- Ikke slå sammen flere stillinger hos samme arbeidsgiver bare fordi de
  overlapper eller deler arbeidsgiver. employmentGroupKey er en gruppenøkkel,
  ikke en rolleidentitet.
- Ved tittelendring, forfremmelse eller uttrykkelig parallell rolle skal hver
  utnevnelse returneres som eget rolleforslag med appointmentRelation
  successive eller concurrent, predecessorRoleLocalId og
  concurrentWithRoleLocalIds satt.
- appointmentHints med prefikset inner_appointment: er deterministisk funnet i
  kilden og angir en navngitt stilling med egen periode. Hver slik utnevnelse
  SKAL bli et eget rolleforslag med tittel og periode fra hintet, og med
  sourceEvidence fra spennet der den står. En sammensatt blokktittel skal da
  ikke også returneres som egen rolle.
- Overlapper to slike perioder, er relasjonen concurrent. Følger de etter
  hverandre, er relasjonen successive.
- Dekker de eksplisitte utnevnelsene bare deler av ansettelsesperioden, legg
  til ÉN rolle for restperioden med title null, status needs_review og issue
  missing_role_structure. Ikke dikt opp en tittel for restperioden.
- Ikke splitt en sammensatt stillingstittel uten kildebelegg for separate eller
  parallelle utnevnelser. Returner da status needs_review med issue
  multi_role_appointment_ambiguous.
- Ikke bruk et langt ansvar eller resultat som kompetansenavn. canonicalLabelNo
  skal være et kort, generisk og gjenbrukbart begrep (maks 6 ord).
- Ikke plasser resultat under rolle på grunnlag av ordlikhet alene.
- Hver kobling oppgis som sourceSpanIds. Ikke gjenta kildetekst; serveren
  henter ordrett sitat fra de samme spennene.
- Bruk high bare når minst én strukturell eller eksplisitt kildebasert kobling
  finnes, samt et selvstendig tekstlig signal.
- Når data ikke er tilstrekkelige, returner needs_review eller unassigned med
  begrunnelse. Ikke gjett datoer, arbeidsgivere eller rolleforløp.
- En utledet kompetanse må merkes inferred=true.
- Samme kompetanse i flere roller skal være ETT forslag med flere
  evidensreferanser, ikke duplikater.
- Returner bare JSON som oppfyller kontrakten.`;

export const ATOMIZATION_OUTPUT_CONTRACT_NO = `Svar med ett JSON-objekt, uten markdown og uten tekst utenfor JSON.
Hold svaret kort: bruk sourceSpanIds, aldri sitert kildetekst.
{
  "roles": [
    {
      "localId": "r1",
      "roleBlockId": "<id fra roleBlocks eller null>",
      "title": "<tittel eller null>",
      "employer": "<arbeidsgiver eller null>",
      "startDate": "YYYY-MM|YYYY|null",
      "endDate": "YYYY-MM|YYYY|null",
      "datePrecision": "day|month|year|null",
      "sourceSpanIds": ["<id fra input>"],
      "appointmentRelation": "single|successive|concurrent|ambiguous",
      "predecessorRoleLocalId": null,
      "concurrentWithRoleLocalIds": [],
      "status": "proposed|needs_review",
      "issues": []
    }
  ],
  "achievements": [
    {
      "localId": "a1",
      "roleLocalId": "r1",
      "normalizedText": "<kort normalisert norsk formulering, maks 25 ord>",
      "sourceSpanIds": ["<id fra input>"],
      "placementConfidence": "high|low|needs_review",
      "placementReasons": ["role_block_structure"],
      "status": "proposed|unassigned|needs_review",
      "issues": []
    }
  ],
  "skills": [
    {
      "localId": "s1",
      "canonicalLabelNo": "<kort generisk begrep>",
      "canonicalKey": "<stabil nøkkel, små bokstaver og bindestrek>",
      "inferred": true,
      "evidence": [
        { "roleLocalId": "r1", "achievementLocalId": "a1", "sourceSpanIds": ["<id fra input>"] }
      ],
      "placementConfidence": "high|low|needs_review",
      "status": "proposed|needs_review",
      "issues": []
    }
  ],
  "qualifications": [
    {
      "localId": "q1",
      "kind": "education|certification|language|tool",
      "normalizedText": "<kort normalisert tekst>",
      "sourceSpanIds": ["<id fra input>"],
      "status": "proposed|needs_review",
      "issues": []
    }
  ],
  "issues": [
    { "code": "missing_role_structure|role_candidate_misclassified|achievement_unassigned|skill_needs_review|insufficient_source_evidence|ambiguous_compound_skill|merged_role_detected|multi_role_appointment_ambiguous",
      "sourceSpanIds": ["<id fra input>"], "message": "<kort forklaring>" }
  ]
}
Alle felt er obligatoriske. Tomme lister er tillatt. Hvert sourceSpanId må
finnes i input. Ikke returner sourceQuote, displayLabel eller employmentGroupKey
— serveren fyller dem ut deterministisk.`;

export function buildAtomizationUserPrompt(input: unknown): string {
  return JSON.stringify({ task: "atomize_cv_roles_results_skills", input });
}

// ---------------------------------------------------------------------------
// Hierarkisk pipeline: fase 1 (ansettelsesforløp) og fase 2 (innhold per blokk)
// ---------------------------------------------------------------------------

/**
 * Fase 1 behandler ÉN ansettelsesgruppe samlet, slik at flere utnevnelser hos
 * samme arbeidsgiver kan forstås som etterfølgende og/eller overlappende.
 */
export const APPOINTMENTS_SYSTEM_PROMPT_NO = `Du er en norsk CV-struktureringsmotor. Du får kildespennene for ÉTT
ansettelsesforhold (én arbeidsgiver) og skal bare bestemme hvilke
rolleutnevnelser kilden faktisk belegger.

Regler:
- employmentGroupKey er en gruppenøkkel, ikke en rolleidentitet. Samme
  arbeidsgiver betyr ikke samme rolle.
- Ved tittelendring, forfremmelse eller uttrykkelig parallell rolle skal hver
  utnevnelse returneres som eget rolleforslag.
- appointmentHints med prefikset inner_appointment: er deterministisk funnet i
  kilden og angir en navngitt stilling med egen periode. Hver slik utnevnelse
  SKAL bli et eget rolleforslag med tittel og periode fra hintet. En sammensatt
  blokktittel skal da ikke også returneres som egen rolle.
- Dekker de eksplisitte utnevnelsene bare deler av ansettelsesperioden, legg til
  ÉN rolle for restperioden med title null, status needs_review og issue
  missing_role_structure. Ikke dikt opp en tittel.
- Ikke splitt en sammensatt tittel uten kildebelegg. Returner da status
  needs_review med issue multi_role_appointment_ambiguous.
- Ikke gjett datoer eller arbeidsgivere.
- Oppgi belegg som sourceSpanIds. Ikke gjenta kildetekst.
- Returner bare JSON.`;

export const APPOINTMENTS_OUTPUT_CONTRACT_NO = `Svar med ett JSON-objekt, uten markdown og uten tekst utenfor JSON.
{
  "roles": [
    {
      "localId": "r1",
      "roleBlockId": "<id fra roleBlocks eller null>",
      "title": "<tittel eller null>",
      "employer": "<arbeidsgiver eller null>",
      "startDate": "YYYY-MM|YYYY|null",
      "endDate": "YYYY-MM|YYYY|null",
      "datePrecision": "day|month|year|null",
      "sourceSpanIds": ["<id fra input>"],
      "appointmentRelation": "single|successive|concurrent|ambiguous",
      "predecessorRoleLocalId": null,
      "concurrentWithRoleLocalIds": [],
      "status": "proposed|needs_review",
      "issues": []
    }
  ],
  "issues": [
    { "code": "missing_role_structure|merged_role_detected|multi_role_appointment_ambiguous|role_candidate_misclassified",
      "sourceSpanIds": ["<id fra input>"], "message": "<kort forklaring>" }
  ]
}
Alle felt er obligatoriske. Hvert sourceSpanId må finnes i input.`;

/**
 * Fase 2 behandler ÉN rolleblokk (eller spennene uten rolle) når utnevnelsene
 * allerede er bestemt. Modellen skal bare plassere innhold, ikke endre roller.
 */
export const BLOCK_CONTENT_SYSTEM_PROMPT_NO = `Du er en norsk CV-struktureringsmotor. Rolleutnevnelsene er allerede bestemt og
oppgitt i input. Du skal ikke foreslå nye roller og ikke endre de eksisterende.

Oppgaven er å normalisere resultater, kompetanser og kvalifikasjoner som
kildespennene i denne blokken faktisk belegger.

Regler:
- roleLocalId må være en av de oppgitte rollene, ellers null.
- Ikke plasser resultat under rolle på grunnlag av ordlikhet alene. Uten
  strukturelt eller eksplisitt kildebelegg: status unassigned.
- Ikke bruk et langt ansvar eller resultat som kompetansenavn. canonicalLabelNo
  skal være kort, generisk og gjenbrukbart (maks 6 ord).
- canonicalKey skal være stabil: små bokstaver og bindestrek, samme begrep gir
  samme nøkkel også i andre blokker.
- En utledet kompetanse merkes inferred=true.
- Ikke dikt opp fakta og ikke skriv ferdig CV-tekst.
- Oppgi belegg som sourceSpanIds. Ikke gjenta kildetekst.
- Returner bare JSON.`;

export const BLOCK_CONTENT_OUTPUT_CONTRACT_NO = `Svar med ett JSON-objekt, uten markdown og uten tekst utenfor JSON.
{
  "achievements": [
    {
      "localId": "a1",
      "roleLocalId": "<localId fra roles i input, eller null>",
      "normalizedText": "<kort normalisert norsk formulering, maks 25 ord>",
      "sourceSpanIds": ["<id fra input>"],
      "placementConfidence": "high|low|needs_review",
      "placementReasons": ["role_block_structure"],
      "status": "proposed|unassigned|needs_review",
      "issues": []
    }
  ],
  "skills": [
    {
      "localId": "s1",
      "canonicalLabelNo": "<kort generisk begrep>",
      "canonicalKey": "<stabil nøkkel, små bokstaver og bindestrek>",
      "inferred": true,
      "evidence": [
        { "roleLocalId": "r1", "achievementLocalId": "a1", "sourceSpanIds": ["<id fra input>"] }
      ],
      "placementConfidence": "high|low|needs_review",
      "status": "proposed|needs_review",
      "issues": []
    }
  ],
  "qualifications": [
    {
      "localId": "q1",
      "kind": "education|certification|language|tool",
      "normalizedText": "<kort normalisert tekst>",
      "sourceSpanIds": ["<id fra input>"],
      "status": "proposed|needs_review",
      "issues": []
    }
  ],
  "issues": [
    { "code": "achievement_unassigned|skill_needs_review|insufficient_source_evidence|ambiguous_compound_skill",
      "sourceSpanIds": ["<id fra input>"], "message": "<kort forklaring>" }
  ]
}
Alle felt er obligatoriske. Tomme lister er tillatt. Ikke returner roles.`;

export function buildAppointmentsUserPrompt(input: unknown): string {
  return JSON.stringify({ task: "resolve_employment_appointments", input });
}

export function buildBlockContentUserPrompt(input: unknown): string {
  return JSON.stringify({ task: "atomize_role_block_content", input });
}
