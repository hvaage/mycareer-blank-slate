// Serveronly: stabil, bruker-scopet avstemmingslinje ("thread") per
// kildeidentitet og domene.
//
// Formål: en reimport skal aldri lage et nytt, uavhengig ventende forslag for
// en sak brukeren allerede har avgjort eller promotert. Linjen holder styr på
// siste forslag og siste kildehash per (bruker, domene, dedupe-nøkkel).
//
// Motoren skriver fortsatt aldri til produktdata.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = import("@supabase/supabase-js").SupabaseClient<any, "public", any>;

/** Statuser som betyr at brukeren har tatt stilling til saken. */
export const DECIDED_STATUSES = [
  "approved_for_promotion",
  "promoted",
  "dismissed",
  "deferred_by_user",
  "needs_resolution",
  "promotion_failed",
] as const;

export type ThreadRow = {
  id: string;
  current_proposal_id: string | null;
  last_source_snapshot_hash: string | null;
  last_status: string | null;
  reopen_count: number;
};

export type ThreadPlan =
  | { action: "insert"; threadId: string | null }
  | { action: "idempotent"; threadId: string }
  | {
      action: "supersede";
      threadId: string;
      previousProposalId: string | null;
      previousStatus: string | null;
      previousSourceHash: string | null;
      decided: boolean;
    };

/** Slå opp eller opprett linjen, og avgjør hva som skal skje med utkastet. */
export async function planForThread(
  admin: Admin,
  args: { userId: string; domain: string; threadKey: string; sourceHash: string },
): Promise<ThreadPlan> {
  const { data: thread } = await admin
    .from("linkedin_reconciliation_threads")
    .select("id, current_proposal_id, last_source_snapshot_hash, last_status, reopen_count")
    .eq("user_id", args.userId)
    .eq("proposal_domain", args.domain)
    .eq("thread_key", args.threadKey)
    .maybeSingle();

  if (!thread) {
    const { data: created } = await admin
      .from("linkedin_reconciliation_threads")
      .insert({
        user_id: args.userId,
        proposal_domain: args.domain,
        thread_key: args.threadKey,
      })
      .select("id")
      .single();
    const threadId = created?.id ?? null;

    // Adopsjon: forslag laget FØR trådmodellen har ingen tråd. Uten dette ville
    // en ny kjøring lage et uavhengig duplikat ved siden av det gamle. Vi
    // knytter det nyeste eksisterende forslaget til linjen og lar den vanlige
    // logikken avgjøre om kilden faktisk er endret.
    if (threadId) {
      const { data: legacy } = await admin
        .from("linkedin_reconciliation_proposals")
        .select("id, status, source_snapshot_hash, created_at")
        .eq("user_id", args.userId)
        .eq("proposal_domain", args.domain)
        .eq("dedupe_key", args.threadKey)
        .is("thread_id", null)
        .order("created_at", { ascending: false })
        .limit(1);
      const prev = (legacy ?? [])[0];
      if (prev) {
        await admin
          .from("linkedin_reconciliation_proposals")
          .update({ thread_id: threadId })
          .eq("id", prev.id)
          .eq("user_id", args.userId);
        await admin
          .from("linkedin_reconciliation_threads")
          .update({
            current_proposal_id: prev.id,
            last_source_snapshot_hash: prev.source_snapshot_hash,
            last_status: prev.status,
            updated_at: new Date().toISOString(),
          })
          .eq("id", threadId);

        if (prev.source_snapshot_hash === args.sourceHash) {
          return { action: "idempotent", threadId };
        }
        const decided =
          prev.status != null && (DECIDED_STATUSES as readonly string[]).includes(prev.status);
        return {
          action: "supersede",
          threadId,
          previousProposalId: prev.id,
          previousStatus: prev.status ?? null,
          previousSourceHash: prev.source_snapshot_hash ?? null,
          decided,
        };
      }
    }

    return { action: "insert", threadId };
  }

  const row = thread as ThreadRow;

  // Live status på forrige forslag er autoritativ (brukeren kan ha bestemt seg
  // etter at linjen sist ble oppdatert).
  let currentStatus = row.last_status;
  if (row.current_proposal_id) {
    const { data: prev } = await admin
      .from("linkedin_reconciliation_proposals")
      .select("status")
      .eq("id", row.current_proposal_id)
      .eq("user_id", args.userId)
      .maybeSingle();
    currentStatus = prev?.status ?? currentStatus;
  }

  if (row.last_source_snapshot_hash === args.sourceHash) {
    return { action: "idempotent", threadId: row.id };
  }

  return {
    action: "supersede",
    threadId: row.id,
    previousProposalId: row.current_proposal_id,
    previousStatus: currentStatus,
    previousSourceHash: row.last_source_snapshot_hash,
    decided: currentStatus != null && (DECIDED_STATUSES as readonly string[]).includes(currentStatus),
  };
}

/** Marker et tidligere ventende forslag som erstattet. Beslutninger røres aldri. */
export async function supersedePendingProposal(
  admin: Admin,
  args: { userId: string; proposalId: string },
) {
  await admin
    .from("linkedin_reconciliation_proposals")
    .update({ status: "superseded", superseded_at: new Date().toISOString() })
    .eq("id", args.proposalId)
    .eq("user_id", args.userId)
    .eq("status", "pending_review");
}

/** Oppdater linjen etter at et nytt forslag er skrevet. */
export async function touchThread(
  admin: Admin,
  args: {
    threadId: string;
    userId: string;
    proposalId: string;
    sourceHash: string;
    status: string;
    reopened: boolean;
  },
) {
  const patch: Record<string, unknown> = {
    current_proposal_id: args.proposalId,
    last_source_snapshot_hash: args.sourceHash,
    last_status: args.status,
    updated_at: new Date().toISOString(),
  };
  if (args.reopened) {
    const { data } = await admin
      .from("linkedin_reconciliation_threads")
      .select("reopen_count")
      .eq("id", args.threadId)
      .maybeSingle();
    patch["reopen_count"] = (data?.reopen_count ?? 0) + 1;
  }
  await admin
    .from("linkedin_reconciliation_threads")
    .update(patch)
    .eq("id", args.threadId)
    .eq("user_id", args.userId);
}
