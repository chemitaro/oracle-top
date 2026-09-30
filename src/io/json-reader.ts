import { constants, type BigIntStats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join } from "node:path";
import JSON5 from "json5";
import type { DataWarning, DataWarningCode } from "../model/dashboard.js";

export type WarningContext =
  | { source: "session"; sessionId: string }
  | { source: "sessions" | "config" | "leases" };

export interface JsonReadRequest {
  rootPath: string;
  pathSegments: readonly string[];
  format: "json" | "json5";
  context: WarningContext;
  io?: ReadOnlyFileSystem;
  signal?: AbortSignal;
}

export interface ReadOnlyHandle {
  stat(): Promise<BigIntStats>;
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

export interface ReadOnlyFileSystem {
  realpath(path: string): Promise<string>;
  lstat(path: string): Promise<BigIntStats>;
  open(path: string, flags: number): Promise<ReadOnlyHandle>;
}

export const nodeReadOnlyFileSystem: ReadOnlyFileSystem = {
  realpath,
  lstat: (path) => lstat(path, { bigint: true }),
  async open(path, flags) {
    const handle = await open(path, flags);
    return {
      stat: () => handle.stat({ bigint: true }),
      read: (buffer, offset, length, position) =>
        handle.read(buffer, offset, length, position),
      close: () => handle.close(),
    };
  },
};

export type JsonReadResult =
  | { kind: "value"; value: unknown }
  | { kind: "warning"; warning: DataWarning }
  | { kind: "aborted" };

export async function readJsonFile(
  request: JsonReadRequest,
): Promise<JsonReadResult> {
  if (request.signal?.aborted) return { kind: "aborted" };
  if (
    request.pathSegments.length === 0 ||
    request.pathSegments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        segment.includes("/") ||
        segment.includes("\0"),
    )
  )
    return warning(request, "INVALID_FIELD");
  const state = { observed: false };
  try {
    const result = await readDocument(request, state);
    return request.signal?.aborted ? { kind: "aborted" } : result;
  } catch (error: unknown) {
    if (request.signal?.aborted) return { kind: "aborted" };
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    if (code === "ENOENT" || code === "ENOTDIR")
      return warning(request, state.observed ? "FILE_CHANGED" : "FILE_MISSING");
    if (code === "ELOOP")
      return warning(
        request,
        state.observed ? "FILE_CHANGED" : "SYMLINK_SKIPPED",
      );
    return warning(request, "FILE_UNREADABLE");
  }
}

async function readDocument(
  request: JsonReadRequest,
  state: { observed: boolean },
): Promise<JsonReadResult> {
  const io = request.io ?? nodeReadOnlyFileSystem;
  const resolvedRoot = await io.realpath(request.rootPath);
  if (request.signal?.aborted) return { kind: "aborted" };
  let path = resolvedRoot;
  const parents: { path: string; stat: BigIntStats }[] = [
    { path, stat: await io.lstat(path) },
  ];
  let before: BigIntStats = parents[0]!.stat;
  for (let index = 0; index < request.pathSegments.length; index++) {
    if (request.signal?.aborted) return { kind: "aborted" };
    path = join(path, request.pathSegments[index]!);
    before = await io.lstat(path);
    if (before.isSymbolicLink()) return warning(request, "SYMLINK_SKIPPED");
    if (index < request.pathSegments.length - 1) {
      if (!before.isDirectory()) return warning(request, "FILE_NOT_REGULAR");
      parents.push({ path, stat: before });
    }
  }
  state.observed = true;
  if (request.signal?.aborted) return { kind: "aborted" };
  const handle = await io.open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  let bytes: Uint8Array;
  try {
    const stat = await handle.stat();
    if (request.signal?.aborted) return { kind: "aborted" };
    if (!sameVersion(before, stat)) return warning(request, "FILE_CHANGED");
    if (!stat.isFile()) return warning(request, "FILE_NOT_REGULAR");
    if (stat.size > 1_048_576n) return warning(request, "FILE_TOO_LARGE");
    const buffer = new Uint8Array(1_048_577);
    let total = 0;
    while (total < buffer.length) {
      if (request.signal?.aborted) return { kind: "aborted" };
      const { bytesRead } = await handle.read(
        buffer,
        total,
        buffer.length - total,
        total,
      );
      if (request.signal?.aborted) return { kind: "aborted" };
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > 1_048_576) return warning(request, "FILE_TOO_LARGE");
    if (
      !sameVersion(stat, await handle.stat()) ||
      !sameVersion(stat, await io.lstat(path))
    )
      return warning(request, "FILE_CHANGED");
    for (const parent of parents) {
      const current = await io.lstat(parent.path);
      if (
        !current.isDirectory() ||
        current.dev !== parent.stat.dev ||
        current.ino !== parent.stat.ino
      )
        return warning(request, "FILE_CHANGED");
    }
    if (request.signal?.aborted) return { kind: "aborted" };
    bytes = buffer.subarray(0, total);
  } finally {
    await handle.close();
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return warning(request, "INVALID_ENCODING");
  }
  try {
    const value: unknown =
      request.format === "json5" ? JSON5.parse(text) : JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return warning(request, "INVALID_ROOT");
    }
    return { kind: "value", value };
  } catch {
    return warning(
      request,
      request.format === "json5" ? "INVALID_JSON5" : "INVALID_JSON",
    );
  }
}

function warning(
  request: JsonReadRequest,
  code: DataWarningCode,
): JsonReadResult {
  return { kind: "warning", warning: { code, ...request.context } };
}

function sameVersion(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}
