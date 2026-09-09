import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

/**
 * Kanonisk provenance for manuelt opprettede roller og resultater:
 * source_type = 'user_input'. "bruker_manuelt" er kun metadata/visningstekst.
 *
 * Manuell rolle skrives direkte fra klienten; manuelt resultat går gjennom
 * RPC-en career_atom_add_manual_result, som utfører atomflyten i én transaksjon.
 */
const src = readFileSync("src/lib/queries/cv-review-progress.ts", "utf8");

const migrationSql = readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(`supabase/migrations/${f}`, "utf8"))
  .join("\n");

const manualResultFn = (() => {
  const start = migrationSql.lastIndexOf(
    "CREATE OR REPLACE FUNCTION public.career_atom_add_manual_result",
  );
  expect(start).toBeGreaterThan(-1);
  return migrationSql.slice(start, start + 4000);
})();

describe("manuell provenance i CV-gjennomgangen", () => {
  it("bruker kanonisk source_type='user_input' for manuell rolle", () => {
    expect((src.match(/source_type: "user_input"/g) ?? []).length).toBe(1);
    expect(manualResultFn).toMatch(/'user_input'/);
  });

  it("skriver ikke andre kildetyper for manuelle atomer", () => {
    expect(src).not.toMatch(/source_type: "bruker"/);
    expect(src).not.toMatch(/source_type: "bruker_manuelt"/);
    expect(manualResultFn).not.toMatch(/source_type[^\n]*'bruker'/);
  });

  it("setter aldri claim-evidensstatusen user_attested fra atomflyten", () => {
    const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
    expect(code).not.toMatch(/user_attested/);
    expect(src).not.toMatch(/cv_claim_attestations/);
    expect(manualResultFn).not.toMatch(/user_attested/);
    expect(manualResultFn).not.toMatch(/cv_claim_attestations/);
  });

  it("bruker atom-tillit (confidence/user_confirmed) for begge manuelle flyter", () => {
    expect((src.match(/confidence: "verified"/g) ?? []).length).toBe(1);
    expect((src.match(/user_confirmed: true/g) ?? []).length).toBe(1);
    expect(manualResultFn).toMatch(/'verified'/);
    expect(manualResultFn).toMatch(/user_confirmed/);
  });
});

describe("manuelt resultat går gjennom den kanoniske lenkeflyten", () => {
  it("klienten skriver aldri parent_atom_id direkte", () => {
    expect(src).not.toMatch(/parent_atom_id:/);
    expect(src).toMatch(/rpc\("career_atom_add_manual_result"/);
  });

  it("RPC-en oppretter aktiv oppnadd_i-lenke i samme transaksjon", () => {
    expect(manualResultFn).toMatch(/INSERT INTO public\.career_atom_links/);
    expect(manualResultFn).toMatch(/'oppnadd_i'/);
    expect(manualResultFn).toMatch(/'aktiv'/);
    expect(manualResultFn).toMatch(/'user_confirmed'/);
  });

  it("RPC-en projiserer parent_atom_id via career_atom_project_parent", () => {
    expect(manualResultFn).toMatch(
      /PERFORM public\.career_atom_project_parent\(v_atom_id\)/,
    );
    expect(manualResultFn).not.toMatch(/INSERT INTO public\.career_atoms[\s\S]{0,600}parent_atom_id/);
  });

  it("endret eller arkivert rolle utløser trenger_ny_vurdering og ny projeksjon", () => {
    const trg = migrationSql.slice(
      migrationSql.lastIndexOf(
        "CREATE OR REPLACE FUNCTION public.career_atoms_recheck_links_trigger",
      ),
    );
    expect(trg).toMatch(/OLD\.is_active AND NOT NEW\.is_active/);
    expect(trg).toMatch(/content_no IS DISTINCT FROM OLD\.content_no/);
    expect(trg).toMatch(/start_date/);
    expect(trg).toMatch(/end_date/);
    expect(trg).toMatch(/SET status = 'trenger_ny_vurdering'/);
    expect(trg).toMatch(/career_atom_project_parent\(v_id\)/);
    expect(trg).toMatch(/AFTER UPDATE ON public\.career_atoms/);
  });

  it("lenkehistorikk bevares (ingen sletting av lenker i flyten)", () => {
    expect(manualResultFn).not.toMatch(/DELETE FROM public\.career_atom_links/);
    expect(src).not.toMatch(/from\("career_atom_links"\)[\s\S]{0,80}\.delete\(/);
  });
});
