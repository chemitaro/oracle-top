import type { DataWarning } from "../model/dashboard.js";
import {
  readJsonFile,
  isAsyncValue,
  nodeReadOnlyFileSystem,
  type ReadOnlyFileSystem,
} from "./json-reader.js";
export interface LeasesRequest {
  profilePath: string;
  io?: ReadOnlyFileSystem;
  signal?: AbortSignal;
}
export type LeasesResult =
  | {
      kind: "leases";
      active: number | null;
      profileRealPath: string | null;
      dataWarnings: DataWarning[];
    }
  | { kind: "aborted" };
export async function collectLeases(
  request: LeasesRequest,
): Promise<LeasesResult> {
  if (request.signal?.aborted) return { kind: "aborted" };
  const io = request.io ?? nodeReadOnlyFileSystem;
  let profileRealPath: string;
  try {
    const ioResult1 = io.realpath(request.profilePath);
    profileRealPath = isAsyncValue(ioResult1) ? await ioResult1 : ioResult1;
  } catch (error: unknown) {
    if (request.signal?.aborted) return { kind: "aborted" };
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : null;
    const missing = code === "ENOENT" || code === "ENOTDIR";
    return {
      kind: "leases",
      active: missing ? 0 : null,
      profileRealPath: null,
      dataWarnings: [
        {
          source: "leases",
          code: missing ? "FILE_MISSING" : "FILE_UNREADABLE",
        },
      ],
    };
  }
  if (request.signal?.aborted) return { kind: "aborted" };
  let before: import("node:fs").BigIntStats;
  try {
    const ioResult2 = io.lstat(profileRealPath);
    before = isAsyncValue(ioResult2) ? await ioResult2 : ioResult2;
  } catch (error: unknown) {
    if (request.signal?.aborted) return { kind: "aborted" };
    return {
      kind: "leases",
      active: null,
      profileRealPath,
      dataWarnings: [{ source: "leases", code: observedFailure(error) }],
    };
  }
  if (request.signal?.aborted) return { kind: "aborted" };
  if (!before.isDirectory())
    return {
      kind: "leases",
      active: null,
      profileRealPath,
      dataWarnings: [{ source: "leases", code: "FILE_NOT_REGULAR" }],
    };
  const doc = await readJsonFile({
    rootPath: profileRealPath,
    pathSegments: ["oracle-tab-leases.json"],
    format: "json",
    context: { source: "leases" },
    io,
    ...(request.signal ? { signal: request.signal } : {}),
  });
  if (doc.kind === "aborted" || request.signal?.aborted)
    return { kind: "aborted" };
  try {
    const ioResult3 = io.lstat(profileRealPath);
    const after = isAsyncValue(ioResult3) ? await ioResult3 : ioResult3;
    if (request.signal?.aborted) return { kind: "aborted" };
    if (
      !after.isDirectory() ||
      after.isSymbolicLink() ||
      before.dev !== after.dev ||
      before.ino !== after.ino
    )
      return {
        kind: "leases",
        active: null,
        profileRealPath,
        dataWarnings: [{ source: "leases", code: "FILE_CHANGED" }],
      };
  } catch (error: unknown) {
    if (request.signal?.aborted) return { kind: "aborted" };
    return {
      kind: "leases",
      active: null,
      profileRealPath,
      dataWarnings: [{ source: "leases", code: observedFailure(error) }],
    };
  }
  if (doc.kind === "warning")
    return {
      kind: "leases",
      active: doc.warning.code === "FILE_MISSING" ? 0 : null,
      profileRealPath,
      dataWarnings: [doc.warning],
    };
  const leases = own(doc.value, "leases");
  const valid =
    own(doc.value, "version") === 1 &&
    Array.isArray(leases) &&
    leases.every(
      (value) =>
        typeof value === "object" && value !== null && !Array.isArray(value),
    );
  return {
    kind: "leases",
    active: valid ? leases.length : null,
    profileRealPath,
    dataWarnings: valid ? [] : [{ source: "leases", code: "LEASES_INVALID" }],
  };
}
function own(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function observedFailure(error: unknown): "FILE_CHANGED" | "FILE_UNREADABLE" {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : null;
  return code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP"
    ? "FILE_CHANGED"
    : "FILE_UNREADABLE";
}
