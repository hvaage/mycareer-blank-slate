// @ts-nocheck
// Module-level store so cover-letter generation survives route navigation.
// Sonner toasts fire from here regardless of which component is mounted.
import { normalizeAiErrorMessage } from "@/lib/ai-ux-messages";
import { toast } from "sonner";

export type CoverLetterStage =
  | "preparing"
  | "loading_profile"
  | "calling_ai"
  | "web_research"
  | "structuring"
  | "saving"
  | "done"
  | "cancelled"
  | "error";

export type InputSource = {
  label: string;
  kind: "profile" | "cv" | "ad" | "lead" | "annonse";
  href?: string; // optional internal link
  meta?: string; // small descriptor
};

export type CompanyStatus =
  | { kind: "none" }
  | { kind: "created"; companyId: string }
  | { kind: "updated"; companyId: string }
  | { kind: "existing_recent"; companyId: string };

export type CoverLetterJob = {
  key: string;
  status: "running" | "done" | "error" | "cancelled";
  stage: CoverLetterStage;
  startedAt: number;
  endedAt?: number;
  progress: number; // 0..1 heuristic
  company: string;
  role: string | null;
  inputSources: InputSource[];
  webSources: string[]; // URLs from AI web search (tool citations)
  letter?: string;
  jobAnalysis?: string;
  companyResearch?: string;
  matchAssessment?: string;
  companyId?: string | null;
  companyScoresUpdated?: boolean;
  companyStatus: CompanyStatus;
  error?: string;
  abort?: AbortController; // not serializable; in-memory only
  /** Set when auto- or manual-save to applications/documents succeeded */
  persisted?: boolean;
  /** Cleared when user visits Søknader / Mine genererte søknader (nav badge) */
  notificationSeen?: boolean;
};

type Listener = () => void;

const jobs = new Map<string, CoverLetterJob>();
const listeners = new Set<Listener>();
let cachedSnapshot: CoverLetterJob[] = [];

function emit() {
  cachedSnapshot = Array.from(jobs.values());
  for (const l of listeners) l();
}

const STAGE_PROGRESS: Record<CoverLetterStage, number> = {
  preparing: 0.05,
  loading_profile: 0.15,
  calling_ai: 0.3,
  web_research: 0.55,
  structuring: 0.8,
  saving: 0.92,
  done: 1,
  cancelled: 1,
  error: 1,
};

export const coverLetterJobs = {
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get(key: string): CoverLetterJob | undefined {
    return jobs.get(key);
  },
  list(): CoverLetterJob[] {
    return cachedSnapshot;
  },
  runningCount(): number {
    let n = 0;
    for (const j of jobs.values()) if (j.status === "running") n++;
    return n;
  },
  /** Done + saved to DB, not yet acknowledged on Søknader / Mine genererte søknader */
  unseenPersistedDoneCount(): number {
    let n = 0;
    for (const j of jobs.values()) {
      if (j.status === "done" && j.persisted && !j.notificationSeen) n++;
    }
    return n;
  },
  markPersistedJobsSeen() {
    let changed = false;
    for (const [k, j] of jobs) {
      if (j.status === "done" && j.persisted && !j.notificationSeen) {
        jobs.set(k, { ...j, notificationSeen: true });
        changed = true;
      }
    }
    if (changed) emit();
  },
  /** Call when this job finished while the user was on the flow (no sidebar ping needed). */
  markKeySeen(key: string) {
    const j = jobs.get(key);
    if (!j || j.status !== "done" || !j.persisted || j.notificationSeen) return;
    jobs.set(key, { ...j, notificationSeen: true });
    emit();
  },
  start(
    key: string,
    init: {
      company: string;
      role: string | null;
      inputSources: InputSource[];
      abort: AbortController;
    },
  ) {
    jobs.set(key, {
      key,
      company: init.company,
      role: init.role,
      inputSources: init.inputSources,
      abort: init.abort,
      webSources: [],
      status: "running",
      stage: "preparing",
      progress: STAGE_PROGRESS.preparing,
      startedAt: Date.now(),
      companyStatus: { kind: "none" },
    });
    emit();
  },
  setStage(key: string, stage: CoverLetterStage) {
    const j = jobs.get(key);
    if (!j || j.status !== "running") return;
    jobs.set(key, { ...j, stage, progress: STAGE_PROGRESS[stage] ?? j.progress });
    emit();
  },
  addInputSources(key: string, extra: InputSource[]) {
    const j = jobs.get(key);
    if (!j) return;
    const seen = new Set(j.inputSources.map((s) => s.label));
    const merged = [...j.inputSources];
    for (const s of extra) if (!seen.has(s.label)) merged.push(s);
    jobs.set(key, { ...j, inputSources: merged });
    emit();
  },
  succeed(
    key: string,
    payload: {
      letter: string;
      jobAnalysis: string;
      companyResearch: string;
      matchAssessment: string;
      webSources: string[];
      companyId: string | null;
      companyScoresUpdated: boolean;
      companyExistedAlready: boolean;
      /** True when letter + application status were written to DB (Mine genererte søknader). */
      persisted?: boolean;
    },
  ) {
    const prev = jobs.get(key);
    if (!prev || prev.status !== "running") return;

    let companyStatus: CompanyStatus = { kind: "none" };
    if (payload.companyId) {
      if (payload.companyScoresUpdated) {
        companyStatus = payload.companyExistedAlready
          ? { kind: "updated", companyId: payload.companyId }
          : { kind: "created", companyId: payload.companyId };
      } else {
        companyStatus = { kind: "existing_recent", companyId: payload.companyId };
      }
    }

    jobs.set(key, {
      ...prev,
      ...payload,
      persisted: payload.persisted ?? false,
      status: "done",
      stage: "done",
      progress: 1,
      endedAt: Date.now(),
      companyStatus,
      abort: undefined,
    });
    emit();
    // Completion toast is owned by the caller (e.g. after DB persist) so we never claim "klart" before save.
  },
  fail(key: string, error: string) {
    const prev = jobs.get(key);
    if (!prev) return;
    const safe = normalizeAiErrorMessage(error, { kind: "cover_letter" });
    jobs.set(key, {
      ...prev,
      status: "error",
      stage: "error",
      progress: 1,
      error: safe,
      endedAt: Date.now(),
      abort: undefined,
    });
    emit();
    toast.error(`Generering feilet for ${prev.company}: ${safe}`);
  },
  cancel(key: string) {
    const prev = jobs.get(key);
    if (!prev) return;
    if (prev.abort && prev.status === "running") {
      try { prev.abort.abort(); } catch { /* noop */ }
    }
    if (prev.status === "running") {
      jobs.set(key, {
        ...prev,
        status: "cancelled",
        stage: "cancelled",
        progress: 1,
        endedAt: Date.now(),
        abort: undefined,
      });
      emit();
      toast(`Generering avbrutt for ${prev.company}`);
    }
  },
  clear(key: string) {
    jobs.delete(key);
    emit();
  },
};
