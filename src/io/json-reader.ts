import { constants, type BigIntStats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join } from "node:path";
import JSON5 from "json5";
import type { ReadBufferPool } from "./read-buffer.js";
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

export type Awaitable<T> = T | PromiseLike<T>;
export function isAsyncValue<T>(value: Awaitable<T>): value is PromiseLike<T> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof value.then === "function"
  );
}

export interface ReadOnlyHandle {
  stat(): Awaitable<BigIntStats>;
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Awaitable<{ bytesRead: number }>;
  close(): Awaitable<void>;
}

export interface ReadOnlyFileSystem {
  readonly bufferPool?: ReadBufferPool;
  realpath(path: string): Awaitable<string>;
  lstat(path: string): Awaitable<BigIntStats>;
  open(path: string, flags: number): Awaitable<ReadOnlyHandle>;
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
  const state = { observed: false, loaned: false };
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
  } finally {
    if (state.loaned) request.io?.bufferPool?.release();
  }
}

async function readDocument(
  request: JsonReadRequest,
  state: { observed: boolean; loaned: boolean },
): Promise<JsonReadResult> {
  const io = request.io ?? nodeReadOnlyFileSystem;
  const ioResult1 = io.realpath(request.rootPath);
  const resolvedRoot = isAsyncValue(ioResult1) ? await ioResult1 : ioResult1;
  if (request.signal?.aborted) return { kind: "aborted" };
  let path = resolvedRoot;
  const rootStatResult = io.lstat(path);
  const rootStat = isAsyncValue(rootStatResult)
    ? await rootStatResult
    : rootStatResult;
  const parents: { path: string; stat: BigIntStats }[] = [
    { path, stat: rootStat },
  ];
  let before: BigIntStats = parents[0]!.stat;
  for (let index = 0; index < request.pathSegments.length; index++) {
    if (request.signal?.aborted) return { kind: "aborted" };
    path = join(path, request.pathSegments[index]!);
    const ioResult2 = io.lstat(path);
    before = isAsyncValue(ioResult2) ? await ioResult2 : ioResult2;
    if (before.isSymbolicLink()) return warning(request, "SYMLINK_SKIPPED");
    if (index < request.pathSegments.length - 1) {
      if (!before.isDirectory()) return warning(request, "FILE_NOT_REGULAR");
      parents.push({ path, stat: before });
    }
  }
  state.observed = true;
  if (request.signal?.aborted) return { kind: "aborted" };
  const ioResult3 = io.open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  const handle = isAsyncValue(ioResult3) ? await ioResult3 : ioResult3;
  let bytes: Uint8Array;
  try {
    const ioResult4 = handle.stat();
    const stat = isAsyncValue(ioResult4) ? await ioResult4 : ioResult4;
    if (request.signal?.aborted) return { kind: "aborted" };
    if (!sameVersion(before, stat)) return warning(request, "FILE_CHANGED");
    if (!stat.isFile()) return warning(request, "FILE_NOT_REGULAR");
    if (stat.size > 1_048_576n) return warning(request, "FILE_TOO_LARGE");
    let buffer = io.bufferPool
      ? io.bufferPool.borrow(Number(stat.size) + 1)
      : new Uint8Array(Number(stat.size) + 1);
    state.loaned = io.bufferPool !== undefined;
    let total = 0;
    while (total < 1_048_577) {
      if (total === buffer.length) {
        const size = Math.min(1_048_577, buffer.length * 2);
        const expanded = io.bufferPool
          ? io.bufferPool.grow(buffer, size)
          : new Uint8Array(size);
        if (!io.bufferPool) expanded.set(buffer);
        buffer = expanded;
      }
      if (request.signal?.aborted) return { kind: "aborted" };
      const requested = buffer.length - total;
      const ioResult5 = handle.read(
        buffer,
        total,
        buffer.length - total,
        total,
      );
      const { bytesRead } = isAsyncValue(ioResult5)
        ? await ioResult5
        : ioResult5;
      if (request.signal?.aborted) return { kind: "aborted" };
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total === Number(stat.size) && bytesRead < requested) break;
    }
    if (total > 1_048_576) return warning(request, "FILE_TOO_LARGE");
    const ioResult6 = handle.stat();
    const after = isAsyncValue(ioResult6) ? await ioResult6 : ioResult6;
    if (request.signal?.aborted) return { kind: "aborted" };
    if (!sameVersion(stat, after)) return warning(request, "FILE_CHANGED");
    const ioResult7 = io.lstat(path);
    const finalPath = isAsyncValue(ioResult7) ? await ioResult7 : ioResult7;
    if (request.signal?.aborted) return { kind: "aborted" };
    if (!sameVersion(stat, finalPath)) return warning(request, "FILE_CHANGED");
    for (const parent of parents) {
      if (request.signal?.aborted) return { kind: "aborted" };
      const ioResult8 = io.lstat(parent.path);
      const current = isAsyncValue(ioResult8) ? await ioResult8 : ioResult8;
      if (request.signal?.aborted) return { kind: "aborted" };
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
    const closing = handle.close();
    if (isAsyncValue(closing)) await closing;
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
