import { describe, expect, it } from "vitest";
import {
  attestationSurvivesRewrite,
  classifyUnsupportedElements,
  claimReviewActionsFor,
  evidenceStatusFor,
  isApprovalBlocking,
  summarizeEvidence,
  USER_ATTESTED_INTERNAL_NOTE,
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
    unsupportedElements: partial.unsupportedElements ?? [],
    contradiction: partial.contradiction ?? null,
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

describe("bekreftelse og omskriving", () => {
  const text = "Bygget opp virksomheten fra oppstart og ledet den til markedsledende posisjon i 2003.";

  it("ren formatering bevarer bekreftelsen", () => {
    expect(attestationSurvivesRewrite(text, `  ${text.toUpperCase()} `)).toBe(true);
  });

  it("endret årstall krever ny bekreftelse", () => {
    expect(attestationSurvivesRewrite(text, text.replace("2003", "2004"))).toBe(false);
  });

  it("endret markedsomfang krever ny bekreftelse", () => {
    expect(
      attestationSurvivesRewrite(text, text.replace("markedsledende", "nest største")),
    ).toBe(false);
  });

  it("tilbaketrukket bekreftelse gjeninnfører blokkering", () => {
    const withdrawn = claim({
      claimId: "c15",
      evidenceStatus: evidenceStatusFor("partially_supported", false),
      verification: "partially_supported",
    });
    expect(withdrawn.approvalBlocking).toBe(true);
    expect(summarizeEvidence("doc", [withdrawn]).canApprove).toBe(false);
  });

  it("intern merknad er ikke en del av påstandsteksten", () => {
    const attested = claim({
      claimId: "c15",
      value: text,
      evidenceStatus: "user_attested",
      verification: "partially_supported",
      userAttestation: {
        claimId: "c15",
        attestedAt: new Date().toISOString(),
        attestedClaimText: text,
        note: null,
        externalSourceName: "Storebrand Kapitalforvaltning",
        externalSourceYear: 2003,
        externalDocumentAvailable: false,
        valid: true,
        withdrawnAt: null,
        invalidatedAt: null,
        invalidatedReason: null,
        provenance: {
          channel: "user_review_ui",
          actor: "user",
          verificationAtAttestation: "partially_supported",
          claimVersion: 1,
          documentOutputHash: null,
        },
        internalNote: USER_ATTESTED_INTERNAL_NOTE,
      },
    });
    expect(attested.value).not.toContain(USER_ATTESTED_INTERNAL_NOTE);
    expect(attested.userAttestation?.externalDocumentAvailable).toBe(false);
    expect(summarizeEvidence("doc", [attested]).canApprove).toBe(true);
  });
});

describe("udekkede elementer", () => {
  it("dokumentert påstand har ingen udekkede elementer", () => {
    expect(classifyUnsupportedElements("Ledet teamet", "supported")).toEqual([]);
  });

  it("deler opp tall, årstall, marked og sammenligning", () => {
    const kinds = classifyUnsupportedElements(
      "I 2003 størst i Norge innen B2C og B2B",
      "partially_supported",
    ).map((e) => e.kind);
    expect(kinds).toContain("date");
    expect(kinds).toContain("comparison");
    expect(kinds).toContain("market");
    expect(kinds).toContain("geography");
  });
});
