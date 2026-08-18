/**
 * Karriereontologi v4 — fase 2.3: gjennomgangsflyten.
 * Brukeren ser og bekrefter enkeltatomer, ett om gangen. Ingenting fra
 * parselaget er evidens før det er bekreftet her.
 */
import { Link, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, HelpCircle, Loader2, Undo2, XCircle } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { CvAnalysisPanel } from "@/components/cv/CvAnalysisPanel";
import { CvReviewTimelineStep } from "@/components/cv/CvReviewTimelineStep";
import { CvReviewResultsStep, isResultCandidate } from "@/components/cv/CvReviewResultsStep";
import { candidateSetSignature, roleFromAtom } from "@/lib/cv-review-timeline";
import {
  advanceReviewProgress,
  cvReviewProgressQuery,
  invalidateReviewProgress,
  readRoleChoices,
  syncReviewProgress,
} from "@/lib/queries/cv-review-progress";
import { CvReviewSkillsStep } from "@/components/cv/CvReviewSkillsStep";
import {
  CvReviewQualificationsStep,
  isQualificationCandidate,
} from "@/components/cv/CvReviewQualificationsStep";
import { CvReviewProgressBar } from "@/components/cv/CvReviewProgressBar";
import { CvReviewSummary, CvReviewStaleNotice } from "@/components/cv/CvReviewSummary";
import { isSkillCandidate } from "@/lib/cv-review-skill-suggestions";
import { buildSkillBasis } from "@/lib/cv-review-skill-basis";
import { importProposalsQuery } from "@/lib/queries/cv-skill-proposals";



import {
  ATOM_TYPE_CLASS,
  ATOM_TYPE_LABEL,
  CANDIDATE_ATOM_TYPES,
  buildCandidateTree,
  candidateSuggestedFromLexicon,
  candidateTitle,
  cvImportsQuery,
  cvParseCandidatesQuery,
  evidencePointerAtomsQuery,
  invalidateCandidateQueries,
  markCandidateAsQuestion,
  promoteCandidate,
  rejectCandidate,
  reopenCandidate,
  requiresEvidencePointer,
  requiresRoleParent,
  type CvParseCandidateRow,
} from "@/lib/queries/cv-parse-candidates";
import type { CareerAtomType } from "@/lib/career-atom-v4-mapping";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fmtDateTime } from "@/lib/format";


function countStep(list: CvParseCandidateRow[]): { total: number; remaining: number } {
  return {
    total: list.length,
    // Fremdrift = faktiske beslutninger. Ubehandlede elementer teller som
    // gjenstående, ellers ser en uberørt liste ut som ferdig gjennomgått.
    remaining: list.filter(
      (c) => c.status !== "bekreftet" && c.status !== "avvist" && c.status !== "ble_sporsmal",
    ).length,

  };
}

type PointerAtom = {
  id: string;
  atom_type: string | null;
  atom_class: string | null;
  content_no: string | null;
  structured_data?: unknown;
  parent_atom_id?: string | null;
};


export function CvReviewPage() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const qc = useQueryClient();
  const search = useSearch({ strict: false }) as { import?: string; legacy?: boolean };
  // Direkte oppstart: kommer brukeren rett fra analysen, åpner vi den importen.
  const [importId, setImportId] = useState<string | null>(search.import ?? null);

  const imports = useQuery(cvImportsQuery(userId));
  const activeImportId = importId ?? imports.data?.[0]?.id ?? null;
  const candidates = useQuery(cvParseCandidatesQuery(userId, activeImportId));
  const pointers = useQuery(evidencePointerAtomsQuery(userId));

  const rows = candidates.data ?? [];
  const pending = rows.filter((r) => r.status === "ubehandlet");
  const confirmed = rows.filter((r) => r.status === "bekreftet");
  const questions = rows.filter((r) => r.status === "ble_sporsmal");
  const rejected = rows.filter((r) => r.status === "avvist");

  const pointerAtoms = (pointers.data ?? []) as PointerAtom[];
  const roleAtoms = pointerAtoms.filter((a) => a.atom_type === "role");
  const evidencePointerOptions = pointerAtoms.filter(
    (a) =>
      a.atom_type === "role" ||
      a.atom_class === "kvalifikasjon" ||
      a.atom_class === "resultat",
  );

  // Trinnvis gjennomgang: fremdriften er bundet til kandidatsettet. Endres
  // settet, blir en påbegynt gjennomgang foreldet og starter på nytt.
  const signature = useMemo(
    () => candidateSetSignature(rows.map((r) => ({ id: r.id, updated_at: r.updated_at }))),
    [rows],
  );
  const progress = useQuery(cvReviewProgressQuery(userId, activeImportId));
  const progressRow = progress.data ?? null;
  const hasRows = rows.length > 0;
  // Første gangs oppstart: ingen fremdrift finnes, så vi oppretter den.
  const needsFirstSync =
    Boolean(activeImportId) && hasRows && !progress.isLoading && progressRow === null;
  const storedSignature = progressRow?.candidate_set_signature ?? null;
  // Samme antall kandidater ⇒ settet er uendret; signaturen er bare lagret i
  // et eldre format (den inkluderte tidsstempler). Da oppdaterer vi den stille
  // i stedet for å påstå at innholdet er endret.
  const signatureIsLegacy =
    Boolean(storedSignature) &&
    storedSignature !== signature &&
    storedSignature!.split("-")[0] === String(rows.length);
  // Foreldet kandidatsett: aldri gjenoppta som om ingenting har skjedd.
  const isStale = Boolean(progressRow) && storedSignature !== signature && hasRows && !signatureIsLegacy;
  const [showChanges, setShowChanges] = useState(false);

  useEffect(() => {
    if (!activeImportId || (!needsFirstSync && !signatureIsLegacy)) return;
    let cancelled = false;
    void syncReviewProgress(activeImportId, signature)
      .then(() => {
        if (!cancelled) invalidateReviewProgress(qc, userId);
      })
      .catch((e: Error) => toast.error(e.message));
    return () => {
      cancelled = true;
    };
  }, [activeImportId, needsFirstSync, signatureIsLegacy, signature, qc, userId]);


  const currentStep =
    progressRow && (storedSignature === signature || signatureIsLegacy)
      ? progressRow.current_step
      : 1;

  const roleCandidates = rows.filter(
    (r) => (r.resolved_atom_type ?? r.suggested_atom_type) === "role",
  );
  const resultCandidates = rows.filter(isResultCandidate);
  const skillCandidates = rows.filter(isSkillCandidate);
  const qualificationCandidates = rows.filter(isQualificationCandidate);
  const savedRoles = roleAtoms.map((a) =>
    roleFromAtom({ id: a.id, content_no: a.content_no, structured_data: a.structured_data }),
  );
  const suggestionRoles = savedRoles.map((r) => ({
    atomId: r.id,
    title: r.title,
    employer: r.employer,
  }));
  const suggestionResults = pointerAtoms
    .filter((a) => a.atom_class === "resultat")
    .map((a) => ({
      atomId: a.id,
      title: (a.content_no ?? "").trim(),
      roleAtomId: a.parent_atom_id ?? null,
    }));

  const promoted = useMemo(
    () => new Map(confirmed.map((c) => [c.local_ref, c.promoted_atom_id])),
    [confirmed],
  );

  // Trinn 3 leser v2.1-forslagene som autoritet for kompetanseplassering.
  const proposals = useQuery(importProposalsQuery(activeImportId));
  const skillBasis = useMemo(
    () =>
      buildSkillBasis({
        proposals: proposals.data ?? [],
        skillCandidates,
        allCandidates: rows,
        roles: suggestionRoles,
        results: suggestionResults,
        promotedByLocalRef: promoted,
      }),
    [proposals.data, skillCandidates, rows, suggestionRoles, suggestionResults, promoted],
  );
  const skillReviewCandidates = skillBasis.items.map((i) => i.candidate);


  const stepStatuses = [
    { step: 1, label: "Roller", ...countStep(roleCandidates) },
    { step: 2, label: "Resultater", ...countStep(resultCandidates) },
    { step: 3, label: "Kompetanse", ...countStep(skillReviewCandidates) },
    { step: 4, label: "Kvalifikasjoner", ...countStep(qualificationCandidates) },
  ];


  function goToStep(step: number) {
    if (!activeImportId) return;
    void advanceReviewProgress(activeImportId, signature, step)
      .then(() => invalidateReviewProgress(qc, userId))
      .catch((e: Error) => toast.error(e.message));
  }

  function restartReview() {
    if (!activeImportId) return;
    void syncReviewProgress(activeImportId, signature)
      .then(() => {
        setShowChanges(false);
        invalidateReviewProgress(qc, userId);
      })
      .catch((e: Error) => toast.error(e.message));
  }




  const promote = useMutation({
    mutationFn: (v: {
      candidate: CvParseCandidateRow;
      resolvedType: CareerAtomType;
      parentAtomId: string | null;
      evidenceAtomIds: string[];
    }) => promoteCandidate({ userId, verified: true, ...v }),
    onSuccess: () => {
      toast.success("Bekreftet. Atomet er lagt i karriereprofilen din.");
      invalidateCandidateQueries(qc, userId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const question = useMutation({
    mutationFn: (v: { candidate: CvParseCandidateRow; ref: string }) =>
      markCandidateAsQuestion(userId, v.candidate, v.ref),
    onSuccess: () => {
      toast.success("Lagret som spørsmål. Vi spør deg om belegg senere.");
      invalidateCandidateQueries(qc, userId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: (v: { candidate: CvParseCandidateRow; reason: string | null }) =>
      rejectCandidate(userId, v.candidate, v.reason),
    onSuccess: () => {
      toast.success("Avvist. Raden beholdes med status «avvist».");
      invalidateCandidateQueries(qc, userId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reopen = useMutation({
    mutationFn: (candidate: CvParseCandidateRow) => reopenCandidate(userId, candidate),
    onSuccess: () => {
      toast.success("Åpnet på nytt.");
      invalidateCandidateQueries(qc, userId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const busy = promote.isPending || question.isPending || reject.isPending || reopen.isPending;

  function renderCandidate(c: CvParseCandidateRow, nested = false) {
    return (
      <CandidateCard
        key={c.id}
        candidate={c}
        nested={nested}
        busy={busy}
        roleAtoms={roleAtoms}
        pointerOptions={evidencePointerOptions}
        parentPromotedAtomId={
          c.parent_local_ref ? (promoted.get(c.parent_local_ref) ?? null) : null
        }
        parentIsPending={Boolean(c.parent_local_ref) && !promoted.has(c.parent_local_ref ?? "")}
        onConfirm={(resolvedType, parentAtomId, evidenceAtomIds) =>
          promote.mutate({ candidate: c, resolvedType, parentAtomId, evidenceAtomIds })
        }
        onQuestion={(ref) => question.mutate({ candidate: c, ref })}
        onReject={() => reject.mutate({ candidate: c, reason: "avvist i gjennomgang" })}
        onReopen={() => reopen.mutate(c)}
      />
    );
  }

  const tree = buildCandidateTree(pending);

  if (imports.isLoading || candidates.isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Laster gjennomgangen …
      </div>
    );
  }

  const hasImports = (imports.data?.length ?? 0) > 0;
  const activeImport = imports.data?.find((i) => i.id === activeImportId) ?? null;
  // Bare funn brukeren har bekreftet sendes til analyse — evidens først.
  const analysisCandidates = confirmed.map((c) => ({
    id: c.id,
    text: candidateTitle(c),
  }));
  const importNotCommitted =
    Boolean(activeImport) && activeImport?.status !== "committed" && rows.length === 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Gjennomgang av CV-import</h1>
        <p className="text-muted-foreground">
          Maskinen har tolket dokumentet ditt. Ingenting er evidens før du har bekreftet det.
          Du bekrefter ett funn om gangen, og du kan endre typen der maskinen gjettet feil.
        </p>
      </header>

      {imports.isError && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-base">Kunne ikke hente importene dine</CardTitle>
            <CardDescription>
              {imports.error instanceof Error ? imports.error.message : "Ukjent årsak"}. Dette
              betyr ikke at du ikke har importer.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {!imports.isError && !hasImports && (
        <Card className="border-amber-500/50">
          <CardHeader>
            <CardTitle className="text-base">Ingen CV-import å gå gjennom ennå</CardTitle>
            <CardDescription className="space-y-2">
              <span className="block">
                Filene du laster opp under <strong>Om meg → CV</strong> er et arkiv: de lagres
                som de er, uten analyse. Derfor blir det ingen funn å bekrefte her.
              </span>
              <span className="block">
                For å bygge karrieredata må du laste opp CV-en under{" "}
                <strong>Om meg → Karriereoversikt</strong>, kjøre <em>Analyser CV</em> og
                deretter <em>Bekreft og lagre</em>. Da dukker funnene opp på denne siden.
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/about-me" search={{ tab: "karriereoversikt" }}>Gå til Om meg → Karriereoversikt</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {importNotCommitted && (
        <Card className="border-amber-500/50">
          <CardHeader>
            <CardTitle className="text-base">Importen er ikke ferdig behandlet</CardTitle>
            <CardDescription>
              «{activeImport?.source_filename ?? activeImport?.import_type}» har status «
              {activeImport?.status}». Fullfør <em>Analyser CV</em> og <em>Bekreft og lagre</em> i
              opplasteren under Om meg → Karriereoversikt, så kommer funnene hit.
              {activeImport?.error_message ? ` Feil: ${activeImport.error_message}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/about-me">Åpne opplasteren</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {(imports.data?.length ?? 0) > 1 && (

        <div className="max-w-md space-y-2">
          <Label>Import</Label>
          <Select value={activeImportId ?? ""} onValueChange={setImportId}>
            <SelectTrigger>
              <SelectValue placeholder="Velg import" />
            </SelectTrigger>
            <SelectContent>
              {imports.data?.map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  {i.source_filename ?? i.import_type} — {fmtDateTime(i.created_at)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {activeImportId && hasRows && !isStale && (
        <CvReviewProgressBar
          steps={stepStatuses}
          currentStep={currentStep}
          onGoToStep={goToStep}
        />
      )}

      {activeImportId && isStale && (
        <>
          <CvReviewStaleNotice
            onRestart={restartReview}
            onShowChanges={() => setShowChanges((v) => !v)}
            showingChanges={showChanges}
            changedCount={pending.length}
          />
          {showChanges && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Dette ligger i importen nå</CardTitle>
                <CardDescription>
                  {roleCandidates.length} roller, {resultCandidates.length} resultater,{" "}
                  {skillCandidates.length} kompetanser og {qualificationCandidates.length}{" "}
                  kvalifikasjoner — hvorav {pending.length} ikke er gjennomgått.
                </CardDescription>
              </CardHeader>
            </Card>
          )}
        </>
      )}

      {activeImportId && !isStale && currentStep === 1 ? (
        <CvReviewTimelineStep
          userId={userId}
          importId={activeImportId}
          signature={signature}
          roleCandidates={roleCandidates}
          savedRoles={savedRoles}
          onContinue={() => invalidateReviewProgress(qc, userId)}
        />
      ) : activeImportId && !isStale && currentStep === 2 ? (
        <CvReviewResultsStep
          userId={userId}
          importId={activeImportId}
          signature={signature}
          resultCandidates={resultCandidates}
          roleCandidates={roleCandidates}
          savedRoles={savedRoles}
          roleChoices={readRoleChoices(progressRow)}
          promotedByLocalRef={promoted}
          onContinue={() => invalidateReviewProgress(qc, userId)}
          onBack={() => goToStep(1)}
        />
      ) : activeImportId && !isStale && currentStep === 3 ? (
        <CvReviewSkillsStep
          userId={userId}
          importId={activeImportId}
          signature={signature}
          basis={skillBasis}
          roles={suggestionRoles}
          results={suggestionResults}

          onContinue={() => invalidateReviewProgress(qc, userId)}
          onBack={() => goToStep(2)}
        />
      ) : activeImportId && !isStale && currentStep === 4 ? (
        <CvReviewQualificationsStep
          userId={userId}
          importId={activeImportId}
          signature={signature}
          candidates={qualificationCandidates}
          onFinish={() => invalidateReviewProgress(qc, userId)}
          onBack={() => goToStep(3)}
        />
      ) : activeImportId && !isStale ? (
        <>
          <CvReviewSummary
            lines={stepStatuses.map((s) => ({
              step: s.step,
              label: s.label,
              confirmed: s.total - s.remaining,
              remaining: s.remaining,
            }))}
            onGoToStep={goToStep}
          />
          {/* Valgfritt ettersteg. Blokkerer ikke at gjennomgangen er ferdig. */}
          <CvAnalysisPanel
            userId={userId}
            importId={activeImportId}
            candidates={analysisCandidates}
          />
        </>
      ) : null}

      {search.legacy && (
      <Tabs defaultValue="pending">

        <TabsList>
          <TabsTrigger value="pending">Til gjennomgang</TabsTrigger>
          <TabsTrigger value="confirmed">Bekreftet ({confirmed.length})</TabsTrigger>
          <TabsTrigger value="questions">Spørsmål ({questions.length})</TabsTrigger>
          <TabsTrigger value="rejected">Avvist ({rejected.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-6 pt-4">
          {pending.length === 0 ? (
            <EmptyState
              title={hasImports ? "Ingenting å gå gjennom" : "Ingen import ennå"}
              description={
                hasImports
                  ? "Alle funn fra denne importen er behandlet."
                  : "Last opp CV-en under Om meg → Karriereoversikt for å få funn å bekrefte her."
              }

            />
          ) : (
            <>
              {tree.roles.map((node) => (
                <Card key={node.candidate.id} className="border-primary/30">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">
                      {candidateTitle(node.candidate)}
                    </CardTitle>
                    <CardDescription>
                      Rolle med {node.children.length} tilhørende funn. Bekreft rollen først —
                      de underliggende funnene henger på den.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {renderCandidate(node.candidate)}
                    {node.children.length > 0 && (
                      <div className="space-y-3 border-l-2 border-muted pl-4">
                        {node.children.map((child) => renderCandidate(child, true))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
              {tree.standalone.length > 0 && (
                <div className="space-y-3">
                  <Separator />
                  <h2 className="text-sm font-medium text-muted-foreground">
                    Frittstående funn
                  </h2>
                  {tree.standalone.map((c) => renderCandidate(c))}
                </div>
              )}
              {tree.orphans.length > 0 && (
                <div className="space-y-3">
                  <h2 className="text-sm font-medium text-muted-foreground">
                    Funn uten kjent kontekst
                  </h2>
                  {tree.orphans.map((c) => renderCandidate(c))}
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="confirmed" className="space-y-3 pt-4">
          {confirmed.length === 0 ? (
            <EmptyState title="Ingen bekreftede funn ennå" description="Bekreft funn i fanen «Til gjennomgang»." />
          ) : (
            confirmed.map((c) => (
              <ResolvedRow key={c.id} candidate={c} tone="bekreftet" onReopen={null} />
            ))
          )}
        </TabsContent>

        <TabsContent value="questions" className="space-y-3 pt-4">
          {questions.length === 0 ? (
            <EmptyState title="Ingen åpne spørsmål" description="Kompetanse uten belegg havner her." />
          ) : (
            questions.map((c) => (
              <ResolvedRow
                key={c.id}
                candidate={c}
                tone="spørsmål"
                onReopen={() => reopen.mutate(c)}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="rejected" className="space-y-3 pt-4">
          {rejected.length === 0 ? (
            <EmptyState title="Ingen avviste funn" description="Avviste funn slettes ikke — de beholdes her." />
          ) : (
            rejected.map((c) => (
              <ResolvedRow key={c.id} candidate={c} tone="avvist" onReopen={() => reopen.mutate(c)} />
            ))
          )}
        </TabsContent>
      </Tabs>
      )}


    </div>
  );
}

function ResolvedRow({
  candidate,
  tone,
  onReopen,
}: {
  candidate: CvParseCandidateRow;
  tone: string;
  onReopen: (() => void) | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border p-3">
      <div className="min-w-0">
        <p className="truncate text-sm">{candidateTitle(candidate)}</p>
        <p className="text-xs text-muted-foreground">
          {tone}
          {candidate.resolved_atom_type
            ? ` · ${ATOM_TYPE_LABEL[candidate.resolved_atom_type as CareerAtomType] ?? candidate.resolved_atom_type}`
            : ""}
          {candidate.rejected_reason ? ` · ${candidate.rejected_reason}` : ""}
        </p>
      </div>
      {onReopen && (
        <Button variant="ghost" size="sm" onClick={onReopen}>
          <Undo2 className="mr-1 h-3.5 w-3.5" /> Åpne på nytt
        </Button>
      )}
    </div>
  );
}

function CandidateCard({
  candidate,
  nested,
  busy,
  roleAtoms,
  pointerOptions,
  parentPromotedAtomId,
  parentIsPending,
  onConfirm,
  onQuestion,
  onReject,
  onReopen: _onReopen,
}: {
  candidate: CvParseCandidateRow;
  nested: boolean;
  busy: boolean;
  roleAtoms: PointerAtom[];
  pointerOptions: PointerAtom[];
  parentPromotedAtomId: string | null;
  parentIsPending: boolean;
  onConfirm: (t: CareerAtomType, parentAtomId: string | null, pointers: string[]) => void;
  onQuestion: (ref: string) => void;
  onReject: () => void;
  onReopen: () => void;
}) {
  const suggested = (candidate.suggested_atom_type as CareerAtomType) ?? "skill";
  const [type, setType] = useState<CareerAtomType>(suggested);
  const [roleId, setRoleId] = useState<string>("");
  const [pointerId, setPointerId] = useState<string>("");

  const needsPointer = requiresEvidencePointer(type);
  const needsRole = requiresRoleParent(type);
  const effectiveParent = needsRole ? roleId || null : parentPromotedAtomId;
  const pointerIds = needsPointer ? (pointerId ? [pointerId] : []) : [];
  const noPointersAvailable = needsPointer && pointerOptions.length === 0;
  const blocked =
    parentIsPending ||
    (needsRole && !effectiveParent) ||
    (needsPointer && pointerIds.length === 0);

  return (
    <div className={nested ? "space-y-3 rounded-md border p-3" : "space-y-3 rounded-md border p-4"}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{candidateTitle(candidate)}</p>
          {candidate.source_quote && (
            <p className="mt-1 text-xs italic text-muted-foreground">«{candidate.source_quote}»</p>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge variant="secondary">
            Forslag: {ATOM_TYPE_LABEL[suggested] ?? suggested}
          </Badge>
          {candidateSuggestedFromLexicon(candidate) && (
            <Badge variant="outline">Gjenkjent navn</Badge>
          )}
        </div>
      </div>

      {parentIsPending && (
        <p className="text-xs text-amber-600">
          Bekreft rollen over først. Da vet vi hvilken sammenheng dette funnet hører til.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as CareerAtomType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CANDIDATE_ATOM_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {ATOM_TYPE_LABEL[t]}
                  {ATOM_TYPE_CLASS[t] ? ` (${ATOM_TYPE_CLASS[t]})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {needsRole && (
          <div className="space-y-1">
            <Label className="text-xs">Avledet av rolle</Label>
            <Select value={roleId} onValueChange={setRoleId}>
              <SelectTrigger>
                <SelectValue placeholder={roleAtoms.length ? "Velg rolle" : "Bekreft en rolle først"} />
              </SelectTrigger>
              <SelectContent>
                {roleAtoms.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.content_no ?? "Rolle"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Eksponering er bransjer og fagfelt du har vært i. Den er alltid avledet av en
              rolle — derfor må du velge hvilken.
            </p>
          </div>
        )}

        {needsPointer && (
          <div className="space-y-1">
            <Label className="text-xs">Hvor har du brukt denne?</Label>
            <Select value={pointerId} onValueChange={setPointerId}>
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    noPointersAvailable ? "Ingen belegg finnes ennå" : "Velg rolle, utdanning eller resultat"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {pointerOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.content_no ?? "Atom"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Kompetanse kan ikke stå alene. Finnes det ikke belegg, blir den et spørsmål vi
              stiller deg senere.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy || blocked}
          onClick={() => onConfirm(type, effectiveParent, pointerIds)}
        >
          <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Bekreft
        </Button>
        {needsPointer && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onQuestion(`kompetanse_uten_evidens:${candidate.local_ref}`)}
          >
            <HelpCircle className="mr-1 h-3.5 w-3.5" /> Gjør til spørsmål
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={onReject}>
          <XCircle className="mr-1 h-3.5 w-3.5" /> Avvis
        </Button>
      </div>
    </div>
  );
}
