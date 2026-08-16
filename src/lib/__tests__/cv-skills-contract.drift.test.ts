// Driftstest: frontendkontrakten må være generert fra den kanoniske
// backendkontrakten, og frontend må ikke inneholde backendlogikk.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error - ren .mjs-generator uten typer
import { renderContract, TARGET } from "../../../scripts/generate-cv-skills-contract.mjs";

const frontend = readFileSync(TARGET, "utf8");

describe("cv-skills-kontrakt", () => {
  it("frontendkontrakten er i synk med backendkontrakten", () => {
    expect(frontend).toBe(renderContract());
  });

  it("frontendkontrakten inneholder ikke autoritativ backendlogikk", () => {
    for (const forbidden of ["isEligibleAtom", "assessReadiness", "eligibleAtoms", "career_atoms"]) {
      expect(frontend).not.toContain(forbidden);
    }
  });

  it("src/ importerer verken vendor-runtime, serveradapter eller Claude-klient", async () => {
    const { execFileSync } = await import("node:child_process");
    const root = resolve(TARGET, "../../..");
    let hits = "";
    try {
      hits = execFileSync(
        "rg",
        ["-n", "cv-skills/(vendor|adapters)|_shared/claude|lib/claude|ANTHROPIC_API_KEY", "src"],
        { cwd: root, encoding: "utf8" },
      );
    } catch {
      hits = "";
    }
    expect(hits.trim()).toBe("");
  });
});
