// Avstemming av gjennomgangsgrunnlaget mot v2.1-forslagene.
//
// Kanonisk regel: for en v2.1-import er v2.1s strukturerte utdata autoritet for
// rolleutnevnelser og resultatplassering. `cv_parse_candidates` beholdes som
// kildegrunnlag og provenance, men skal aldri konkurrere med v2.1 om typen.
//
// Funksjonen er ren planlegging + idempotent skriving:
//   - en rolleutnevnelse i v2.1 retypes til `role` i parselaget
//   - resultater omplasseres til den rolleutnevnelsen v2.1 knyttet dem til
//   - kandidater brukeren allerede har behandlet røres ALDRI; de rapporteres
//
// Ingenting skrives til `career_atoms`.

export type ReconcileCandidate = {
  id: string;
  local_ref: string;
  parent_local_ref: string | null;
  suggested_atom_type: string | null;
  resolved_atom_type: string | null;
  status: string;
  promoted_atom_id: string | null;
  structured_data: Record<string, unknown> | null;
};

export type ReconcileProposal = {
  proposal_payload: {
    atom_type?: string;
    structured_data?: Record<string, unknown>;
  };
};

export type CandidateUpdate = {
  id: string;
  local_ref: string;
  patch: {
    suggested_atom_type?: string;
    parent_local_ref?: string | null;
    structured_data: Record<string, unknown>;
  };
};

export type ReconcilePlan = {
  updates: CandidateUpdate[];
  /** Roller v2.1 fant, men som ikke kunne speiles i parselaget. */
  unmappedRoles: { local_id: string; parse_local_ref: string | null; reason: string }[];
  /** Kandidater brukeren allerede har behandlet, og som derfor må avklares. */
  blocked: {
    local_ref: string;
    status: string;
    promoted_atom_id: string | null;
    wanted: "role" | "reparent";
  }[];
};

const RESULT_ATOM_TYPES = new Set(["achievement", "role_evidence"]);

function sd(p: ReconcileProposal): Record<string, unknown> {
  return p.proposal_payload.structured_data ?? {};
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

/**
 * Planlegger avstemmingen. Rent deterministisk — ingen I/O.
 */
export function planReviewBasisReconcile(
  candidates: ReconcileCandidate[],
  proposals: ReconcileProposal[],
): ReconcilePlan {
  const byRef = new Map(candidates.map((c) => [c.local_ref, c]));
  const plan: ReconcilePlan = { updates: [], unmappedRoles: [], blocked: [] };
  const patched = new Map<string, CandidateUpdate>();
  // v2.1-rollens localId → parselagets local_ref
  const roleRefByLocalId = new Map<string, string>();
  const claimedRefs = new Set<string>();

  const roleProposals = proposals.filter((p) => p.proposal_payload.atom_type === "role");
  const resultProposals = proposals.filter((p) =>
    RESULT_ATOM_TYPES.has(p.proposal_payload.atom_type ?? ""),
  );

  for (const p of roleProposals) {
    const data = sd(p);
    const localId = str(data["local_id"]) ?? "";
    const ref = str(data["parse_local_ref"]);
    const cand = ref ? byRef.get(ref) : undefined;
    if (!ref || !cand) {
      plan.unmappedRoles.push({
        local_id: localId,
        parse_local_ref: ref,
        reason: "ingen parsekandidat for kildespennet",
      });
      continue;
    }
    if (claimedRefs.has(ref)) {
      plan.unmappedRoles.push({
        local_id: localId,
        parse_local_ref: ref,
        reason: "flere rolleutnevnelser peker på samme parsekandidat",
      });
      continue;
    }
    claimedRefs.add(ref);
    roleRefByLocalId.set(localId, ref);

    if (cand.promoted_atom_id || cand.status !== "ubehandlet") {
      plan.blocked.push({
        local_ref: ref,
        status: cand.status,
        promoted_atom_id: cand.promoted_atom_id,
        wanted: "role",
      });
      continue;
    }

    const existing = cand.structured_data ?? {};
    const provisional = data["provisional"] === true;
    const merged: Record<string, unknown> = {
      ...existing,
      original_suggested_atom_type:
        existing["original_suggested_atom_type"] ?? cand.suggested_atom_type,
      v2_role_local_id: localId,
      v2_reconciled: true,
      title: provisional ? null : (data["title"] ?? existing["title"] ?? null),
      employer: data["employer"] ?? existing["employer"] ?? null,
      start_date: data["start_date"] ?? existing["start_date"] ?? null,
      end_date: data["end_date"] ?? existing["end_date"] ?? null,
      date_precision: data["date_precision"] ?? existing["date_precision"] ?? null,
      appointment_relation: data["appointment_relation"] ?? null,
      concurrent_with_role_local_ids: data["concurrent_with_role_local_ids"] ?? [],
      provisional,
      needs_role_title: provisional || !str(data["title"]),
      needs_review_reason: data["needs_review_reason"] ?? null,
    };

    patched.set(cand.id, {
      id: cand.id,
      local_ref: ref,
      patch: {
        suggested_atom_type: "role",
        parent_local_ref: null,
        structured_data: merged,
      },
    });
  }

  for (const p of resultProposals) {
    const data = sd(p);
    const ref = str(data["parse_local_ref"]);
    const roleLocalId = str(data["role_local_id"]);
    if (!ref) continue;
    const cand = byRef.get(ref);
    if (!cand) continue;
    // En kandidat som nå er en rolleutnevnelse kan ikke samtidig være resultat.
    if (patched.has(cand.id) && patched.get(cand.id)!.patch.suggested_atom_type === "role") continue;
    const parentRef = roleLocalId ? (roleRefByLocalId.get(roleLocalId) ?? null) : null;
    if (parentRef === null || parentRef === cand.parent_local_ref) continue;
    if (cand.promoted_atom_id || cand.status !== "ubehandlet") {
      plan.blocked.push({
        local_ref: ref,
        status: cand.status,
        promoted_atom_id: cand.promoted_atom_id,
        wanted: "reparent",
      });
      continue;
    }
    const existing = cand.structured_data ?? {};
    patched.set(cand.id, {
      id: cand.id,
      local_ref: ref,
      patch: {
        parent_local_ref: parentRef,
        structured_data: {
          ...existing,
          v2_reconciled: true,
          v2_role_local_id: roleLocalId,
          content_kind: data["content_kind"] ?? existing["content_kind"] ?? "result",
          placement_source: data["placement_source"] ?? null,
        },
      },
    });
  }

  plan.updates = [...patched.values()];
  return plan;
}

type MinimalClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        eq: (col: string, val: string) => Promise<{ data: unknown; error: unknown }>;
      };
    };
    update: (patch: Record<string, unknown>) => {
      eq: (col: string, val: string) => Promise<{ error: unknown }>;
    };
  };
};

/**
 * Kjører avstemmingen for én import. Idempotent: kjøres den to ganger på rad,
 * gir andre kjøring ingen skrivinger.
 */
export async function reconcileReviewBasisFromV2(
  client: MinimalClient,
  args: { userId: string; cvImportId: string; proposals: ReconcileProposal[] },
): Promise<ReconcilePlan> {
  const { data, error } = await client
    .from("cv_parse_candidates")
    .select(
      "id, local_ref, parent_local_ref, suggested_atom_type, resolved_atom_type, status, promoted_atom_id, structured_data",
    )
    .eq("user_id", args.userId)
    .eq("import_id", args.cvImportId);
  if (error) throw error;

  const plan = planReviewBasisReconcile(
    (data as ReconcileCandidate[] | null) ?? [],
    args.proposals,
  );

  for (const u of plan.updates) {
    const { error: updErr } = await client
      .from("cv_parse_candidates")
      .update({ ...u.patch, updated_at: new Date().toISOString() })
      .eq("id", u.id);
    if (updErr) throw updErr;
  }
  return plan;
}
