import { parentPort } from "node:worker_threads";
import {
  realpathSync,
  lstatSync,
  openSync,
  fstatSync,
  readSync,
  closeSync,
  readdirSync,
} from "node:fs";
import { collectInputs, type CollectorFileSystem } from "./sessions.js";
import type { MonitorStartup } from "../config.js";
import { BoundedReadBuffer } from "./read-buffer.js";
const pool = new BoundedReadBuffer();
interface Request {
  id: number;
  startup: MonitorStartup;
  nowMs: number;
  stopFlag: SharedArrayBuffer;
  metrics?: boolean;
}
parentPort!.on("message", async (request: Request) => {
  const flag = new Int32Array(request.stopFlag),
    abort = new AbortController();
  const check = () => {
    if (Atomics.load(flag, 0) !== 0) abort.abort();
  };
  const guard =
    <Args extends unknown[], T>(operation: (...args: Args) => T) =>
    (...args: Args): T => {
      check();
      if (abort.signal.aborted) throw new Error("Collection aborted");
      try {
        return operation(...args);
      } finally {
        check();
      }
    };
  const observed = request.metrics === true;
  const allocated = pool.allocatedBytes;
  let reads = 0,
    active = 0,
    peak = 0;
  const io: CollectorFileSystem = {
    bufferPool: pool,
    realpath: guard((path: string) => realpathSync.native(path)),
    lstat: guard((path: string) => lstatSync(path, { bigint: true })),
    readdir: guard((path: string) => readdirSync(path)),
    open: guard((path: string, flags: number) => {
      const fd = openSync(path, flags);
      if (observed) {
        active++;
        peak = Math.max(peak, active);
      }
      return {
        stat: guard(() => fstatSync(fd, { bigint: true })),
        read: guard(
          (
            buffer: Uint8Array,
            offset: number,
            length: number,
            position: number,
          ) => {
            if (observed) reads++;
            return {
              bytesRead: readSync(fd, buffer, offset, length, position),
            };
          },
        ),
        close: () => {
          try {
            closeSync(fd);
          } finally {
            if (observed) active--;
            check();
          }
        },
      };
    }),
  };
  try {
    check();
    const result = await collectInputs(request.startup, {
      io,
      signal: abort.signal,
      now: () => request.nowMs,
    });
    check();
    parentPort!.postMessage({
      id: request.id,
      result: abort.signal.aborted ? { kind: "aborted" } : result,
      ...(observed
        ? {
            metrics: {
              readPeak: peak,
              readCalls: reads,
              bufferAllocatedBytes: pool.allocatedBytes - allocated,
            },
          }
        : {}),
    });
  } catch {
    throw new Error("Collection failed");
  }
});
