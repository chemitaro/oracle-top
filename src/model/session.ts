import type { DataWarning } from "./dashboard.js";

export interface NormalizedSession {
  id: string;
  status: string | null;
  project: string;
  slug: string;
  model: string;
  effort: string;
  startTimeMs: number | null;
  reliabilityTimeMs: number | null;
  submittedCount: number;
  profilePath: string | null;
  maximum: number | null;
}

export type NormalizeResult =
  | { kind: "session"; session: NormalizedSession; dataWarnings: DataWarning[] }
  | { kind: "excluded"; dataWarnings: DataWarning[] };
