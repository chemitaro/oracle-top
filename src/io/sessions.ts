import { join } from "node:path";
import { normalizeSession } from "../model/normalize.js";
import { collectLeases } from "./leases.js";
import { readdir } from "node:fs/promises";
import {
  resolveMonitorConfig,
  type MonitorStartup,
  type MonitorConfig,
} from "../config.js";
import type { DataWarning } from "../model/dashboard.js";
import type { NormalizedSession } from "../model/session.js";
import {
  readJsonFile,
  nodeReadOnlyFileSystem,
  type ReadOnlyFileSystem,
  type Awaitable,
  isAsyncValue,
} from "./json-reader.js";

export interface CollectorFileSystem extends ReadOnlyFileSystem {
  readdir(path: string): Awaitable<string[]>;
}
export const nodeCollectorFileSystem: CollectorFileSystem = {
  ...nodeReadOnlyFileSystem,
  readdir,
};
export interface CollectorDependencies {
  io?: CollectorFileSystem;
  signal?: AbortSignal;
}
export interface SessionsRequest extends CollectorDependencies {
  homePath: string;
}
export type SessionsResult =
  | {
      kind: "sessions";
      sessions: NormalizedSession[] | null;
      dataWarnings: DataWarning[];
    }
  | { kind: "aborted" };
export interface DashboardInputs {
  config: MonitorConfig;
  selectedProfileRealPath: string | null;
  active: number | null;
  sessions: NormalizedSession[] | null;
  dataWarnings: DataWarning[];
}
export type CollectInputsResult =
  | { kind: "inputs"; nowMs: number; inputs: DashboardInputs }
  | { kind: "usage-error" }
  | { kind: "aborted" };
export async function collectSessions(
  request: SessionsRequest,
): Promise<SessionsResult> {
  const io = request.io ?? nodeCollectorFileSystem;
  if (request.signal?.aborted) return { kind: "aborted" };
  let observed = false;
  const unavailable = (code: DataWarning["code"]): SessionsResult => ({
    kind: "sessions",
    sessions: null,
    dataWarnings: [{ source: "sessions", code }],
  });
  try {
    const ioResult1 = io.realpath(request.homePath);
    const root = isAsyncValue(ioResult1) ? await ioResult1 : ioResult1;
    if (request.signal?.aborted) return { kind: "aborted" };
    observed = true;
    const ioResult2 = io.lstat(root);
    const rootBefore = isAsyncValue(ioResult2) ? await ioResult2 : ioResult2;
    observed = false;
    if (request.signal?.aborted) return { kind: "aborted" };
    const path = join(root, "sessions");
    const ioResult3 = io.lstat(path);
    const before = isAsyncValue(ioResult3) ? await ioResult3 : ioResult3;
    if (request.signal?.aborted) return { kind: "aborted" };
    if (before.isSymbolicLink()) return unavailable("SYMLINK_SKIPPED");
    if (!before.isDirectory()) return unavailable("SESSIONS_UNREADABLE");
    observed = true;
    const ioResult4 = io.readdir(path);
    const ids = isAsyncValue(ioResult4) ? await ioResult4 : ioResult4;
    if (request.signal?.aborted) return { kind: "aborted" };
    {
      const ioResult5 = io.lstat(path);
      const after = isAsyncValue(ioResult5) ? await ioResult5 : ioResult5;
      if (request.signal?.aborted) return { kind: "aborted" };
      if (!sameDirectory(before, after)) return unavailable("FILE_CHANGED");
      const ioResult6 = io.lstat(root);
      const afterRoot = isAsyncValue(ioResult6) ? await ioResult6 : ioResult6;
      if (request.signal?.aborted) return { kind: "aborted" };
      if (!sameDirectory(rootBefore, afterRoot))
        return unavailable("FILE_CHANGED");
    }
    const sessions: NormalizedSession[] = [];
    const dataWarnings: DataWarning[] = [];
    for (const id of ids) {
      if (request.signal?.aborted) return { kind: "aborted" };
      let stat: import("node:fs").BigIntStats;
      try {
        const ioResult7 = io.lstat(join(path, id));
        stat = isAsyncValue(ioResult7) ? await ioResult7 : ioResult7;
      } catch (error: unknown) {
        if (request.signal?.aborted) return { kind: "aborted" };
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? error.code
            : null;
        dataWarnings.push({
          source: "session",
          sessionId: id,
          code:
            code === "ENOENT" || code === "ENOTDIR"
              ? "FILE_CHANGED"
              : "FILE_UNREADABLE",
        });
        continue;
      }
      if (request.signal?.aborted) return { kind: "aborted" };
      if (stat.isSymbolicLink()) {
        dataWarnings.push({
          source: "session",
          sessionId: id,
          code: "SYMLINK_SKIPPED",
        });
        continue;
      }
      if (!stat.isDirectory()) continue;
      const doc = await readJsonFile({
        rootPath: root,
        pathSegments: ["sessions", id, "meta.json"],
        format: "json",
        context: { source: "session", sessionId: id },
        io,
        ...(request.signal ? { signal: request.signal } : {}),
      });
      if (doc.kind === "aborted" || request.signal?.aborted)
        return { kind: "aborted" };
      try {
        const ioResult8 = io.lstat(join(path, id));
        const after = isAsyncValue(ioResult8) ? await ioResult8 : ioResult8;
        if (request.signal?.aborted) return { kind: "aborted" };
        if (!sameDirectory(stat, after)) {
          dataWarnings.push({
            source: "session",
            sessionId: id,
            code: "FILE_CHANGED",
          });
          continue;
        }
      } catch {
        if (request.signal?.aborted) return { kind: "aborted" };
        dataWarnings.push({
          source: "session",
          sessionId: id,
          code: "FILE_CHANGED",
        });
        continue;
      }
      if (doc.kind === "value") {
        const result = normalizeSession(doc.value, id);
        dataWarnings.push(...result.dataWarnings);
        if (result.kind === "session")
          sessions.push(structuredClone(result.session));
      } else if (doc.kind === "warning") dataWarnings.push(doc.warning);
    }
    {
      const ioResult9 = io.lstat(path);
      const after = isAsyncValue(ioResult9) ? await ioResult9 : ioResult9;
      if (request.signal?.aborted) return { kind: "aborted" };
      if (!sameDirectory(before, after)) return unavailable("FILE_CHANGED");
      const ioResult10 = io.lstat(root);
      const afterRoot = isAsyncValue(ioResult10)
        ? await ioResult10
        : ioResult10;
      if (request.signal?.aborted) return { kind: "aborted" };
      if (!sameDirectory(rootBefore, afterRoot))
        return unavailable("FILE_CHANGED");
    }
    return request.signal?.aborted
      ? { kind: "aborted" }
      : { kind: "sessions", sessions, dataWarnings };
  } catch (error: unknown) {
    if (request.signal?.aborted) return { kind: "aborted" };
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : null;
    return unavailable(
      code === "ENOENT" || code === "ENOTDIR"
        ? observed
          ? "FILE_CHANGED"
          : "SESSIONS_MISSING"
        : "SESSIONS_UNREADABLE",
    );
  }
}
function sameDirectory(
  left: import("node:fs").BigIntStats,
  right: import("node:fs").BigIntStats,
): boolean {
  return (
    right.isDirectory() &&
    !right.isSymbolicLink() &&
    left.dev === right.dev &&
    left.ino === right.ino
  );
}
export async function collectInputs(
  startup: MonitorStartup,
  dependencies: CollectorDependencies & { now?: () => number } = {},
): Promise<CollectInputsResult> {
  const nowMs = (dependencies.now ?? Date.now)();
  const config = await resolveMonitorConfig(startup, dependencies);
  if (config.kind !== "config") return config;
  const sessions = await collectSessions({
    homePath: config.config.homePath,
    ...dependencies,
  });
  if (sessions.kind === "aborted") return sessions;
  const leases = await collectLeases({
    profilePath: config.config.profilePath,
    ...dependencies,
  });
  if (leases.kind === "aborted") return leases;
  return {
    kind: "inputs",
    nowMs,
    inputs: {
      config: config.config,
      selectedProfileRealPath: leases.profileRealPath,
      active: leases.active,
      sessions: sessions.sessions,
      dataWarnings: [
        ...config.dataWarnings,
        ...sessions.dataWarnings,
        ...leases.dataWarnings,
      ],
    },
  };
}
