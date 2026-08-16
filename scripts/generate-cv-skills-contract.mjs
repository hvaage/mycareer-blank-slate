// Genererer frontendkontrakten fra den kanoniske backendkontrakten.
//
//   node scripts/generate-cv-skills-contract.mjs         -> skriver filen
//   node scripts/generate-cv-skills-contract.mjs --check -> exit 1 ved avvik
//
// Frontend skal aldri importere backendlogikk (eligibility/readiness-vurdering).
// Bare DTO-blokken kopieres.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE = resolve(root, "supabase/functions/_shared/cv-skills/contract.ts");
export const TARGET = resolve(root, "src/lib/cv-skills-contract.ts");

const START = "// #region generated-dto-contract";
const END = "// #endregion generated-dto-contract";

const HEADER = `// GENERERT FIL — IKKE REDIGER.
//
// Kilde: supabase/functions/_shared/cv-skills/contract.ts (kanonisk backendkontrakt)
// Generer på nytt: node scripts/generate-cv-skills-contract.mjs
//
// Bare DTO-kontrakten deles med frontend. Eligibility og readiness-vurdering
// er autoritativ backendlogikk og kjøres aldri i nettleseren.

`;

export function renderContract() {
  const source = readFileSync(SOURCE, "utf8");
  const start = source.indexOf(START);
  const end = source.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Fant ikke DTO-markørene i den kanoniske kontrakten.");
  }
  const body = source.slice(start + START.length, end).trim();
  return `${HEADER}${body}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const expected = renderContract();
  if (process.argv.includes("--check")) {
    const actual = readFileSync(TARGET, "utf8");
    if (actual !== expected) {
      console.error("Avvik: src/lib/cv-skills-contract.ts er ikke i synk med backendkontrakten.");
      process.exit(1);
    }
    console.log("Kontraktene er i synk.");
  } else {
    writeFileSync(TARGET, expected);
    console.log("Skrev", TARGET);
  }
}
