// @ts-nocheck
export type CvImportStatus =
  | "pending"
  | "processing"
  | "parsed"
  | "reviewed"
  | "committed"
  | "failed";

export type CvImportRow = {
  id: string;
  user_id: string;
  import_type: string;
  source_filename: string | null;
  source_file_path: string | null;
  status: CvImportStatus;
  error_message: string | null;
  raw_parsed_data: any | null;
  atoms_created_count: number;
  atoms_committed_count: number;
  started_at: string;
  parsed_at: string | null;
  committed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ParseResponse = {
  import_id: string;
  status: "parsed";
  atoms_preview_count: number;
};

/** After storage upload + DB row (pending) — user must run parse separately. */
export type RegisterUploadResponse = {
  import_id: string;
  status: "pending";
  source_file_path: string;
  source_filename: string;
};

export type CommitResponse = {
  import_id: string;
  status: "committed";
  atoms_created: number;
  atoms_merged: number;
  atoms_skipped: number;
  atoms_total_now: number;
  validation_warnings?: unknown[];
  merge_log?: unknown[];
  skipped_log?: unknown[];
};

export type ErrorResponse = {
  error: string;
  message?: string;
  import_id?: string;
};

export type PreviewCounts = {
  experience: number;
  education: number;
  skills: number;
  languages: number;
  certifications: number;
  projects: number;
  achievements: number;
  total: number;
};

export type FlowState =
  | { kind: "idle" }
  | { kind: "file_selected"; file: File }
  | { kind: "uploading"; file: File }
  | {
      kind: "await_parse";
      importId: string;
      fileName: string;
      lastError?: string;
    }
  | { kind: "parsing"; importId: string; fileName: string }
  | {
      kind: "parsed_preview";
      importId: string;
      counts: PreviewCounts;
      fileName: string;
      raw: any;
    }
  | { kind: "committing"; importId: string }
  | { kind: "done"; result: CommitResponse }
  | {
      kind: "error";
      from: "upload" | "parse" | "commit";
      errorCode: string;
      message?: string;
      importId?: string;
    };
