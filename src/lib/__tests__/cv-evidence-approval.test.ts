import { describe, expect, it } from "vitest";
import {
  claimReviewActionsFor,
  evidenceStatusFor,
  isApprovalBlocking,
  summarizeEvidence,
  type ClaimEvidence,
} from "@/lib/cv-skills-contract";

function claim(partial: Partial<ClaimEvidence>): ClaimEvidence {
  const evidenceStatus = partial.evidenceStatus ?? "documented";
  return {
    claimId: partial.claimId ?? "c1",
    blockId: "b1",
    type: "soft",
    value: partial.value ?? "tekst",
    verification: partial.verification ?? "supported",
    evidenceStatus,
    approvalBlocking: isApprovalBlocking(evidenceStatus),
    supportingAtomIds: [],
    availableActions: claimReviewActionsFor(evidenceStatus),
    userAttestation: partial.userAttestation ?? null,
  };
}

describe("evidensklassifisering", () => {
  it("dokumentert når vakten fant dekning", () => {
    expect(evidenceStatusFor("supported", false)).toBe("documented");
    expect(evidenceStatusFor("not_applicable", false)).toBe("documented");
  });

  it("delvis dekket uten bekreftelse", () => {
    expect(evidenceStatusFor("partially_supported", false)).toBe("partially_supported");
  });

  it("gyldig brukerbekreftelse gir user_attested", () => {
    expect(evidenceStatusFor("partially_supported", true)).toBe("user_attested");
    expect(evidenceStatusFor("unsupported", true)).toBe("user_attested");
  });

  it("motstrid kan ikke bekreftes bort", () => {
    expect(evidenceStatusFor("contradicted", true)).toBe("contradicted");
  });
});

describe("godkjenningsregler", () => {
  it("bare dokumentert og brukerbekreftet kan godkjennes", () => {
    expect(isApprovalBlocking("documented")).toBe(false);
    expect(isApprovalBlocking("user_attested")).toBe(false);
    expect(isApprovalBlocking("partially_supported")).toBe(true);
    expect(isApprovalBlocking("unsupported")).toBe(true);
    expect(isApprovalBlocking("contradicted")).toBe(true);
  });

  it("delvis dekket påstand blokkerer hele dokumentet", () => {
    const report = summarizeEvidence("doc", [
      claim({ claimId: "c1" }),
      claim({ claimId: "c15", evidenceStatus: "partially_supported", verification: "partially_supported" }),
    ]);
    expect(report.canApprove).toBe(false);
    expect(report.blockingClaimIds).toEqual(["c15"]);
    expect(report.documentedCoverage.total).toBe(2);
  });

  it("bekreftet påstand løser blokkeringen", () => {
    const report = summarizeEvidence("doc", [
      claim({ claimId: "c1" }),
      claim({ claimId: "c15", evidenceStatus: "user_attested", verification: "partially_supported" }),
    ]);
    expect(report.canApprove).toBe(true);
    expect(report.documentedCoverage.user_attested).toBe(1);
  });
});

describe("handlinger i gjennomgangen", () => {
  it("dokumentert krever ingen handling", () => {
    expect(claimReviewActionsFor("documented")).toEqual([]);
  });

  it("uten dekning tilbys alle fire valg", () => {
    expect(claimReviewActionsFor("unsupported")).toEqual([
      "attest",
      "rewrite",
      "add_documentation",
      "remove",
    ]);
  });

  it("allerede bekreftet tilbys ikke ny bekreftelse", () => {
    expect(claimReviewActionsFor("user_attested")).not.toContain("attest");
  });
});
