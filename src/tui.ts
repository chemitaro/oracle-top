import { collectInputs, type CollectorFileSystem } from "./io/sessions.js";
import { buildDashboard } from "./aggregate.js";
import type { MonitorStartup } from "./config.js";
import { renderText } from "./render/text.js";
import type { EventEmitter } from "node:events";
import type { Writable } from "node:stream";
import type { DashboardSnapshot } from "./model/dashboard.js";
export interface TuiInput extends EventEmitter {
  isRaw?: boolean;
  readonly readableFlowing?: boolean | null;
  isPaused(): boolean;
  setRawMode(value: boolean): unknown;
  resume(): unknown;
  pause(): unknown;
}
export interface TuiTerminal {
  input: TuiInput;
  output: Writable & { columns?: number; rows?: number };
  signals: EventEmitter;
}
export interface TuiTimer {
  now(): number;
  schedule(callback: () => void, delayMs: number): () => void;
}
export type TuiCollectResult =
  | { kind: "snapshot"; snapshot: DashboardSnapshot }
  | { kind: "usage-error" }
  | { kind: "aborted" };
export interface TuiDependencies {
  terminal: TuiTerminal;
  timer: TuiTimer;
  collect(signal: AbortSignal): Promise<TuiCollectResult>;
  onLateExitCode?(code: number): void;
}
const enter = "\u001b[?1049h\u001b[?25l";
const clear = "\u001b[H\u001b[2J";
const restore = "\u001b[?25h\u001b[0m\u001b[?1049l";
export function runTui(
  deps: TuiDependencies,
  intervalMs: number,
): Promise<number> {
  return new Promise<number>((resolve) => {
    const { input, output, signals } = deps.terminal;
    const start = deps.timer.now(),
      abort = new AbortController();
    const raw = input.isRaw ?? false;
    const wasFlowing =
      input.readableFlowing === undefined
        ? !input.isPaused()
        : input.readableFlowing === true;
    let latest: DashboardSnapshot | undefined;
    let stopped = false,
      finished = false,
      busy = false,
      resizeQueued = false,
      resizeNeeded = false,
      broken = false;
    let exitCode = 0,
      pendingWrites = 0,
      lateReported = false,
      outputFailed = false,
      outputClosed = false;
    let cancelPoll: (() => void) | undefined,
      cancelResize: (() => void) | undefined;
    let wait: { cancel(): void; fail(error: Error): void } | undefined;
    function removeGuardian() {
      output.off("error", onOutputError);
      output.off("close", onOutputClose);
    }
    function releaseGuardian() {
      if (stopped && pendingWrites === 0) removeGuardian();
    }
    function finish() {
      if (!finished) {
        finished = true;
        resolve(exitCode);
      }
      releaseGuardian();
    }
    function observeOutputError(error: unknown) {
      if (outputFailed) return;
      outputFailed = true;
      const epipe =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EPIPE";
      if (epipe) broken = true;
      if (!stopped) {
        stop(epipe ? 0 : 1);
        return;
      }
      if (!broken && exitCode !== 130 && exitCode !== 143) exitCode = 1;
      if (finished && !lateReported) {
        lateReported = true;
        try {
          deps.onLateExitCode?.(exitCode);
        } catch {}
      }
      if (!finished) finish();
    }
    function onOutputError(error: Error) {
      observeOutputError(error);
      wait?.fail(error);
    }
    function onOutputClose() {
      outputClosed = true;
      const error = new Error("Output closed");
      if (!stopped || pendingWrites > 0) observeOutputError(error);
      wait?.fail(error);
      if (stopped && !finished) finish();
      removeGuardian();
    }
    function outputWrite(
      value: string,
      callback: (error?: Error | null) => void,
    ): boolean {
      pendingWrites++;
      let called = false;
      const done = (error?: Error | null) => {
        if (called) return;
        called = true;
        const settle = () => {
          pendingWrites--;
          if (error) observeOutputError(error);
          callback(error);
          releaseGuardian();
        };
        if (error) setImmediate(settle);
        else settle();
      };
      try {
        return output.write(value, done);
      } catch (error) {
        observeOutputError(error);
        done(error as Error);
        throw error;
      }
    }
    function writeFrame(value: string): Promise<void> {
      return new Promise((yes, no) => {
        let writing = true,
          done = false,
          drained = true,
          settled = false;
        const cleanup = () => {
          output.off("drain", onDrain);
          if (wait === operation) wait = undefined;
        };
        const complete = () => {
          if (!settled && !writing && done && drained) {
            settled = true;
            cleanup();
            yes();
          }
        };
        const operation = {
          cancel() {
            if (!settled) {
              settled = true;
              cleanup();
              yes();
            }
          },
          fail(error: Error) {
            if (!settled) {
              settled = true;
              cleanup();
              no(error);
            }
          },
        };
        const onDrain = () => {
          drained = true;
          complete();
        };
        wait = operation;
        output.on("drain", onDrain);
        try {
          drained = outputWrite(value, (error) => {
            if (error) operation.fail(error);
            else {
              done = true;
              complete();
            }
          });
          writing = false;
          complete();
        } catch (error) {
          operation.fail(error as Error);
        }
      });
    }
    function stop(code: number) {
      if (stopped) return;
      const blocked = wait !== undefined || pendingWrites > 0;
      stopped = true;
      exitCode = code;
      cancelPoll?.();
      cancelResize?.();
      abort.abort();
      wait?.cancel();
      input.off("data", onData);
      input.off("error", onInputError);
      output.off("resize", onResize);
      signals.off("SIGINT", onInterrupt);
      signals.off("SIGTERM", onTerminate);
      try {
        input.setRawMode(raw);
      } catch {
        if (exitCode !== 130 && exitCode !== 143) exitCode = 1;
      }
      if (!wasFlowing)
        try {
          input.pause();
        } catch {
          if (exitCode !== 130 && exitCode !== 143) exitCode = 1;
        }
      if (
        (outputClosed || output.destroyed) &&
        !broken &&
        exitCode !== 130 &&
        exitCode !== 143
      )
        exitCode = 1;
      if (broken || outputClosed || output.destroyed) {
        finish();
        return;
      }
      try {
        outputWrite(restore, () => finish());
        if (blocked) finish();
      } catch {
        if (exitCode !== 130 && exitCode !== 143) exitCode = 1;
        finish();
      }
    }
    function failure() {
      if (!stopped) stop(1);
    }
    function onTerminate() {
      stop(143);
    }
    function onInterrupt() {
      stop(130);
    }
    function onInputError() {
      stop(1);
    }
    function onData(chunk: Buffer | string) {
      const text = chunk.toString();
      if (text.includes("\u0003")) stop(130);
      else if (text.includes("q")) stop(0);
    }
    async function draw() {
      if (latest && !stopped)
        await writeFrame(
          clear +
            renderText(latest, {
              columns: output.columns ?? 80,
              rows: output.rows ?? 24,
            }),
        );
    }
    function schedulePoll() {
      if (stopped) return;
      cancelPoll?.();
      const next =
        start +
        (Math.floor((deps.timer.now() - start) / intervalMs) + 1) * intervalMs;
      cancelPoll = deps.timer.schedule(() => {
        void scan().catch(failure);
      }, next - deps.timer.now());
    }
    async function flushFrames() {
      do {
        resizeNeeded = false;
        await draw();
      } while (!stopped && resizeNeeded);
    }
    async function redraw() {
      if (stopped || busy || !latest) return;
      busy = true;
      cancelPoll?.();
      await flushFrames();
      busy = false;
      schedulePoll();
    }
    function onResize() {
      if (stopped) return;
      resizeNeeded = true;
      if (resizeQueued || busy || !latest) return;
      resizeQueued = true;
      cancelResize = deps.timer.schedule(() => {
        resizeQueued = false;
        void redraw().catch(failure);
      }, 0);
    }
    async function scan() {
      if (stopped || busy) return;
      busy = true;
      const result = await deps.collect(abort.signal);
      if (stopped) return;
      if (result.kind !== "snapshot") {
        stop(result.kind === "usage-error" ? 2 : 1);
        return;
      }
      latest = result.snapshot;
      await flushFrames();
      busy = false;
      schedulePoll();
    }
    input.on("data", onData);
    input.on("error", onInputError);
    output.on("resize", onResize);
    signals.on("SIGINT", onInterrupt);
    signals.on("SIGTERM", onTerminate);
    output.on("error", onOutputError);
    output.on("close", onOutputClose);
    try {
      input.setRawMode(true);
      input.resume();
      void writeFrame(enter)
        .then(() => scan())
        .catch(failure);
    } catch {
      stop(1);
    }
  });
}

export interface NodeTuiOptions {
  terminal?: TuiTerminal;
  io?: CollectorFileSystem;
  now?: () => number;
  onLateExitCode?: (code: number) => void;
}
export function createNodeTuiDependencies(
  startup: MonitorStartup,
  options: NodeTuiOptions = {},
): TuiDependencies {
  const frozen = {
    ...startup,
    env: { ...startup.env },
    ...(startup.intervalArguments
      ? { intervalArguments: [...startup.intervalArguments] }
      : {}),
  };
  return {
    terminal: options.terminal ?? {
      input: process.stdin,
      output: process.stdout,
      signals: process,
    },
    timer: {
      now: () => performance.now(),
      schedule(callback, delayMs) {
        const timer = setTimeout(callback, delayMs);
        return () => clearTimeout(timer);
      },
    },
    collect: async (signal) => {
      const result = await collectInputs(frozen, {
        signal,
        ...(options.io ? { io: options.io } : {}),
        ...(options.now ? { now: options.now } : {}),
      });
      return result.kind === "inputs"
        ? {
            kind: "snapshot",
            snapshot: buildDashboard(result.inputs, result.nowMs),
          }
        : result;
    },
    ...(options.onLateExitCode
      ? { onLateExitCode: options.onLateExitCode }
      : {}),
  };
}
