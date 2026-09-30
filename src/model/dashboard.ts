export type MaximumSource =
  "session" | "environment" | "user-config" | "default";

export interface BrowserCapacity {
  active: number | null;
  maximum: number;
  utilization: number | null;
  maximumSource: MaximumSource;
}

export interface CurrentSessionRow {
  id: string;
  status: "pending" | "running";
  elapsedMs: number | null;
  project: string;
  slug: string;
  model: string;
  effort: string;
}

export interface Reliability24h {
  completed: number;
  partial: number;
  error: number;
  cancelled: number;
  evaluated: number;
  successRate: number | null;
}

export interface SubmittedMessageRow {
  model: string;
  effort: string;
  submitted24h: number;
  submitted7d: number;
}

export type DataWarningCode =
  | "SESSIONS_MISSING"
  | "SESSIONS_UNREADABLE"
  | "FILE_MISSING"
  | "FILE_UNREADABLE"
  | "FILE_TOO_LARGE"
  | "FILE_NOT_REGULAR"
  | "FILE_CHANGED"
  | "SYMLINK_SKIPPED"
  | "INVALID_ENCODING"
  | "INVALID_JSON"
  | "INVALID_JSON5"
  | "INVALID_ROOT"
  | "INVALID_FIELD"
  | "MODE_UNRESOLVED"
  | "MODE_CONFLICT"
  | "PROVIDER_UNRESOLVED"
  | "PROVIDER_CONFLICT"
  | "STATUS_UNRECOGNIZED"
  | "ID_MISMATCH"
  | "TIME_INVALID"
  | "TIME_FUTURE"
  | "TIME_UNAVAILABLE"
  | "FOLLOWUPS_INVALID"
  | "SUBMISSION_UNRECORDED"
  | "PROFILE_UNRESOLVED"
  | "PROFILE_DIFFERENT"
  | "PROFILE_CONFLICT"
  | "CAPACITY_CONFLICT"
  | "LEASES_INVALID"
  | "DISPLAY_SANITIZED";

export type DataWarning =
  | {
      code: DataWarningCode;
      source: "session";
      sessionId: string;
    }
  | {
      code: DataWarningCode;
      source: "sessions" | "config" | "leases";
    };

export interface DashboardSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  browserCapacity: BrowserCapacity;
  currentSessions: CurrentSessionRow[] | null;
  reliability24h: Reliability24h | null;
  submittedMessages: SubmittedMessageRow[] | null;
  dataWarnings: DataWarning[];
}
