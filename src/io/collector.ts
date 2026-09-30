import type { MonitorStartup } from "../config.js";
import {
  collectInputs,
  type CollectInputsResult,
  type CollectorFileSystem,
} from "./sessions.js";
import type { EventEmitter } from "node:events";
import { Worker, type WorkerOptions } from "node:worker_threads";
export interface WorkerPort extends EventEmitter {
  postMessage(value: unknown): void;
  ref(): unknown;
  unref(): unknown;
  terminate(): Promise<number>;
}
export interface CollectorMetrics {
  readPeak: number;
  readCalls: number;
  bufferAllocatedBytes: number;
}
export interface InputCollectorOptions {
  io?: CollectorFileSystem;
  now?: () => number;
  workerFactory?: (url: URL, options: WorkerOptions) => WorkerPort;
  onMetrics?: (metrics: CollectorMetrics) => void;
}
export function createInputCollector(
  startup: MonitorStartup,
  options: InputCollectorOptions = {},
) {
  const env: Record<string, string> = {};
  for (const key of [
    "ORACLE_HOME_DIR",
    "ORACLE_BROWSER_PROFILE_DIR",
    "ORACLE_BROWSER_MAX_CONCURRENT_TABS",
  ])
    if (startup.env[key] !== undefined) env[key] = startup.env[key]!;
  const frozen = {
    env,
    cwd: startup.cwd,
    osHome: startup.osHome,
    ...(startup.intervalArguments
      ? { intervalArguments: [...startup.intervalArguments] }
      : {}),
  };
  let worker: WorkerPort | undefined;
  let stopped = false,
    failed = false,
    id = 0;
  const abort = new AbortController();
  let pending:
    | {
        reject: (error: Error) => void;
        resolve: (result: CollectInputsResult) => void;
        flag: Int32Array;
        signal: AbortSignal;
        abort: () => void;
      }
    | undefined;
  const onMessage = (value: {
    id: number;
    result: CollectInputsResult;
    metrics?: CollectorMetrics;
  }) => {
    if (stopped || !pending || value.id !== id) return;
    try {
      if (value.metrics && options.onMetrics) options.onMetrics(value.metrics);
    } catch {
      onError();
      return;
    }
    const operation = pending;
    pending = undefined;
    operation.signal.removeEventListener("abort", operation.abort);
    worker?.unref();
    operation.resolve(value.result);
  };
  const onError = () => {
    if (stopped) return;
    failed = true;
    if (pending) {
      const operation = pending;
      pending = undefined;
      operation.signal.removeEventListener("abort", operation.abort);
      operation.reject(new Error("Collection failed"));
    }
    worker?.unref();
  };
  const onExit = () => {
    onError();
    removeGuard();
  };
  const removeGuard = () => {
    worker?.off("error", onError);
    worker?.off("exit", onExit);
  };
  function stop() {
    if (stopped) return;
    stopped = true;
    abort.abort();
    if (pending) {
      Atomics.store(pending.flag, 0, 1);
      pending.signal.removeEventListener("abort", pending.abort);
      pending.resolve({ kind: "aborted" });
      pending = undefined;
    }
    if (worker) {
      worker.off("message", onMessage);
      worker.unref();
      void worker.terminate().then(removeGuard, removeGuard);
    }
  }
  return {
    collect(signal: AbortSignal): Promise<CollectInputsResult> {
      if (stopped || signal.aborted)
        return Promise.resolve({ kind: "aborted" });
      if (failed) return Promise.reject(new Error("Collection failed"));
      if (pending)
        return Promise.reject(new Error("Collection already running"));
      const nowMs = (options.now ?? Date.now)();
      if (signal.aborted) return Promise.resolve({ kind: "aborted" });
      if (options.io) {
        const io = options.io;
        return new Promise((resolve, reject) => {
          const requestId = ++id;
          pending = {
            resolve,
            reject,
            flag: new Int32Array(new SharedArrayBuffer(4)),
            signal,
            abort: stop,
          };
          signal.addEventListener("abort", stop, { once: true });
          void collectInputs(frozen, {
            io,
            signal: abort.signal,
            now: () => nowMs,
          }).then((result) => onMessage({ id: requestId, result }), onError);
        });
      }
      if (!worker) {
        worker = (
          options.workerFactory ?? ((url, opts) => new Worker(url, opts))
        )(new URL("./collector-worker.js", import.meta.url), {
          env: { HOME: frozen.osHome, ...env },
          execArgv: [],
          trackUnmanagedFds: true,
          resourceLimits: { maxYoungGenerationSizeMb: 4 },
        });
        worker.on("message", onMessage);
        worker.on("error", onError);
        worker.on("exit", onExit);
      }
      worker.ref();
      return new Promise((resolve, reject) => {
        const stopFlag = new SharedArrayBuffer(4);
        pending = {
          resolve,
          reject,
          flag: new Int32Array(stopFlag),
          signal,
          abort: stop,
        };
        signal.addEventListener("abort", stop, { once: true });
        worker!.postMessage({
          id: ++id,
          startup: frozen,
          nowMs,
          stopFlag,
          ...(options.onMetrics ? { metrics: true } : {}),
        });
      });
    },
    stop,
  };
}
