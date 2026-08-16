// @ts-nocheck
/**
 * Bygger en lesbar, gruppert oversikt over det AI-en fant i CV-en, slik at
 * brukeren ser hvert enkelt element før noe lagres. Bygger også en filtrert
 * kopi av `raw_parsed_data` med kun elementene brukeren har huket av.
 *
 * Ingenting her er evidens: dette er parselaget, og brukeren bekrefter.
 */

export type PreviewGroupId =
  | "experience"
  | "education"
  | "skills"
  | "languages"
  | "certifications"
  | "projects"
  | "volunteer";

export type PreviewItem = {
  /** Stabil nøkkel for avhuking, f.eks. "experience:2" eller "experience:2:bullet:0". */
  key: string;
  group: PreviewGroupId;
  label: string;
  detail?: string;
  /** Signatur brukt til å kjenne igjen elementet fra før. */
  signature: string;
  /** Verdien som avgjør om et kjent element er *endret*. */
  compareValue: string;
  children?: PreviewItem[];
};

export type PreviewGroup = {
  id: PreviewGroupId;
  title: string;
  hint: string;
  items: PreviewItem[];
};

export const GROUP_META: Record<PreviewGroupId, { title: string; hint: string }> = {
  experience: {
    title: "Stillinger",
    hint: "Roller du har hatt. Punktene under hver rolle er resultater og oppgaver — de lagres bare hvis rollen lagres.",
  },
  education: { title: "Utdanning", hint: "Grader og studier." },
  skills: { title: "Ferdigheter", hint: "Ferdigheter, verktøy og fag maskinen leste ut av teksten." },
  languages: { title: "Språk", hint: "Språk med nivå." },
  certifications: { title: "Sertifiseringer", hint: "Sertifikater og kurs med utsteder." },
  projects: { title: "Prosjekter", hint: "Prosjekter og leveranser." },
  volunteer: { title: "Frivillig arbeid", hint: "Verv og frivillige roller." },
};

export function norm(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function dateSpan(start: unknown, end: unknown, isCurrent?: boolean): string {
  const s = start ? String(start) : "?";
  const e = isCurrent ? "nå" : end ? String(end) : "nå";
  return `${s}–${e}`;
}

export function buildPreviewGroups(raw: any): PreviewGroup[] {
  const groups: PreviewGroup[] = [];
  const push = (id: PreviewGroupId, items: PreviewItem[]) => {
    if (items.length) groups.push({ id, ...GROUP_META[id], items });
  };

  const experience: any[] = [
    ...(Array.isArray(raw?.experience) ? raw.experience : []),
    ...(Array.isArray(raw?.work_experience) ? raw.work_experience : []),
  ];
  push(
    "experience",
    experience.map((e: any, i: number) => {
      const bullets: string[] = Array.isArray(e?.bullets) ? e.bullets.filter(Boolean) : [];
      return {
        key: `experience:${i}`,
        group: "experience" as const,
        label: `${e?.title ?? "Ukjent rolle"} — ${e?.company ?? "ukjent arbeidsgiver"}`,
        detail: dateSpan(e?.start, e?.end, e?.is_current),
        signature: `role|${norm(e?.title)}|${norm(e?.company)}`,
        compareValue: dateSpan(e?.start, e?.end, e?.is_current),
        children: bullets.map((b, bi) => ({
          key: `experience:${i}:bullet:${bi}`,
          group: "experience" as const,
          label: String(b),
          signature: `achievement|${norm(b)}`,
          compareValue: norm(b),
        })),
      };
    }),
  );

  push(
    "education",
    (Array.isArray(raw?.education) ? raw.education : []).map((e: any, i: number) => ({
      key: `education:${i}`,
      group: "education" as const,
      label: `${e?.degree ?? "Ukjent grad"} — ${e?.institution ?? "ukjent lærested"}`,
      detail: [e?.field, [e?.start_year, e?.end_year].filter(Boolean).join("–")]
        .filter(Boolean)
        .join(" · "),
      signature: `education|${norm(e?.degree)}|${norm(e?.institution)}`,
      compareValue: `${e?.field ?? ""}|${e?.start_year ?? ""}|${e?.end_year ?? ""}`,
    })),
  );

  push(
    "skills",
    (Array.isArray(raw?.skills) ? raw.skills : []).map((s: any, i: number) => {
      const name = typeof s === "string" ? s : (s?.name ?? "");
      return {
        key: `skills:${i}`,
        group: "skills" as const,
        label: String(name),
        signature: `skill|${norm(name)}`,
        compareValue: norm(name),
      };
    }),
  );

  push(
    "languages",
    (Array.isArray(raw?.languages) ? raw.languages : []).map((l: any, i: number) => {
      const name = typeof l === "string" ? l : (l?.name ?? "");
      const level = typeof l === "string" ? "" : (l?.level ?? "");
      return {
        key: `languages:${i}`,
        group: "languages" as const,
        label: String(name),
        detail: level ? String(level) : undefined,
        signature: `language|${norm(name)}`,
        compareValue: norm(level),
      };
    }),
  );

  push(
    "certifications",
    (Array.isArray(raw?.certifications) ? raw.certifications : []).map((c: any, i: number) => ({
      key: `certifications:${i}`,
      group: "certifications" as const,
      label: String(c?.name ?? "Ukjent sertifisering"),
      detail: [c?.issuer, c?.issued].filter(Boolean).join(" · "),
      signature: `certification|${norm(c?.name)}|${norm(c?.issuer)}`,
      compareValue: `${c?.issued ?? ""}|${c?.expires ?? ""}`,
    })),
  );

  push(
    "projects",
    (Array.isArray(raw?.projects) ? raw.projects : []).map((p: any, i: number) => ({
      key: `projects:${i}`,
      group: "projects" as const,
      label: String(p?.name ?? "Ukjent prosjekt"),
      detail: p?.description ? String(p.description).slice(0, 120) : undefined,
      signature: `project|${norm(p?.name)}`,
      compareValue: norm(p?.description),
    })),
  );

  push(
    "volunteer",
    (Array.isArray(raw?.volunteer) ? raw.volunteer : []).map((v: any, i: number) => ({
      key: `volunteer:${i}`,
      group: "volunteer" as const,
      label: `${v?.role ?? "Ukjent verv"} — ${v?.organization ?? "ukjent organisasjon"}`,
      detail: dateSpan(v?.start, v?.end),
      signature: `volunteer|${norm(v?.role)}|${norm(v?.organization)}`,
      compareValue: dateSpan(v?.start, v?.end),
    })),
  );

  return groups;
}

export function flattenItems(groups: PreviewGroup[]): PreviewItem[] {
  const out: PreviewItem[] = [];
  for (const g of groups) {
    for (const it of g.items) {
      out.push(it);
      for (const c of it.children ?? []) out.push(c);
    }
  }
  return out;
}

/**
 * Lager en kopi av `raw_parsed_data` som kun inneholder det brukeren har
 * huket av. Fravalgte punkter under en rolle fjernes fra `bullets`; fravelges
 * rollen, faller punktene med den.
 */
export function filterParsedData(raw: any, selected: Set<string>): any {
  const keep = (key: string) => selected.has(key);
  const out: any = { ...raw };

  const experience: any[] = [
    ...(Array.isArray(raw?.experience) ? raw.experience : []),
    ...(Array.isArray(raw?.work_experience) ? raw.work_experience : []),
  ];
  const filteredExp = experience
    .map((e: any, i: number) => {
      if (!keep(`experience:${i}`)) return null;
      const bullets: string[] = Array.isArray(e?.bullets) ? e.bullets.filter(Boolean) : [];
      return {
        ...e,
        bullets: bullets.filter((_, bi) => keep(`experience:${i}:bullet:${bi}`)),
      };
    })
    .filter(Boolean);
  out.experience = filteredExp;
  delete out.work_experience;

  const simple: Array<[string, PreviewGroupId]> = [
    ["education", "education"],
    ["skills", "skills"],
    ["languages", "languages"],
    ["certifications", "certifications"],
    ["projects", "projects"],
    ["volunteer", "volunteer"],
  ];
  for (const [field, group] of simple) {
    const arr = Array.isArray(raw?.[field]) ? raw[field] : [];
    out[field] = arr.filter((_: any, i: number) => keep(`${group}:${i}`));
  }

  return out;
}
