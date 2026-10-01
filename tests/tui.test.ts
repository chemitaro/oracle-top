import { afterEach, expect, test } from "vitest";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import {
  runTui,
  type TuiDependencies,
  type TuiCollectResult,
} from "../src/tui.js";
import type { DashboardSnapshot } from "../src/model/dashboard.js";
function snapshot(): DashboardSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: "2026-09-30T06:00:00.000Z",
    browserCapacity: {
      active: 0,
      maximum: 3,
      maximumSource: "default",
      utilization: 0,
    },
    currentSessions: [],
    reliability24h: {
      completed: 0,
      partial: 0,
      error: 0,
      cancelled: 0,
      evaluated: 0,
      successRate: null,
    },
    submittedMessages: [],
    dataWarnings: [],
  };
}
class Input extends EventEmitter {
  isRaw = false;
  paused = true;
  rawChanges: boolean[] = [];
  isPaused() {
    return this.paused;
  }
  setRawMode(value: boolean) {
    this.rawChanges.push(value);
    this.isRaw = value;
  }
  resume() {
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
}
class Output extends Writable {
  columns = 120;
  rows = 32;
  frames: string[] = [];
  block = false;
  pending: Array<(error?: Error | null) => void> = [];
  constructor() {
    super({ highWaterMark: 1 });
  }
  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    done: (error?: Error | null) => void,
  ) {
    this.frames.push(chunk.toString());
    if (this.block && chunk.toString().startsWith("\u001b[H\u001b[2J"))
      this.pending.push(done);
    else done();
  }
}
class Timer {
  time = 0;
  jobs = new Map<number, { at: number; callback: () => void }>();
  next = 0;
  now = () => this.time;
  schedule = (callback: () => void, delayMs: number) => {
    const id = ++this.next;
    this.jobs.set(id, { at: this.time + delayMs, callback });
    return () => {
      this.jobs.delete(id);
    };
  };
  advance(time: number) {
    this.time = time;
    for (const [id, job] of [...this.jobs]) {
      if (job.at <= time) {
        this.jobs.delete(id);
        job.callback();
      }
    }
  }
}
interface Harness {
  input: Input;
  output: Output;
  signals: EventEmitter;
  timer: Timer;
  deps: TuiDependencies;
  starts: number[];
  aborts: AbortSignal[];
}
const fixtures: Harness[] = [];
function harness(collect?: TuiDependencies["collect"]): Harness {
  const input = new Input(),
    output = new Output(),
    signals = new EventEmitter(),
    timer = new Timer();
  const starts: number[] = [];
  const aborts: AbortSignal[] = [];
  const deps: TuiDependencies = {
    terminal: { input, output, signals },
    timer,
    collect: async (signal) => {
      starts.push(timer.time);
      aborts.push(signal);
      return collect
        ? collect(signal)
        : { kind: "snapshot", snapshot: snapshot() };
    },
  };
  const value = { input, output, signals, timer, deps, starts, aborts };
  fixtures.push(value);
  return value;
}
afterEach(() => {
  for (const h of fixtures) h.input.emit("data", Buffer.from("q"));
  fixtures.length = 0;
});
async function flush() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
test("collects-immediately-and-renders-current-viewport", async () => {
  const h = harness();
  void runTui(h.deps, 2000);
  await flush();
  expect(h.starts).toEqual([0]);
  expect(h.output.frames.join("")).toContain("No current sessions");
  expect(h.output.frames.join("")).toContain("\u001b[H\u001b[2J");
});
test("polls-on-two-second-start-grid", async () => {
  const h = harness();
  void runTui(h.deps, 2000);
  await flush();
  h.timer.advance(1999);
  await flush();
  expect(h.starts).toEqual([0]);
  h.timer.advance(2000);
  await flush();
  expect(h.starts).toEqual([0, 2000]);
  h.timer.advance(4000);
  await flush();
  expect(h.starts).toEqual([0, 2000, 4000]);
});
test("skips-missed-ticks-without-overlap", async () => {
  const first = deferred<TuiCollectResult>();
  const h = harness(() =>
    h.starts.length === 1
      ? first.promise
      : Promise.resolve({ kind: "snapshot", snapshot: snapshot() }),
  );
  void runTui(h.deps, 2000);
  await flush();
  h.timer.advance(5000);
  await flush();
  expect(h.starts).toEqual([0]);
  first.resolve({ kind: "snapshot", snapshot: snapshot() });
  await flush();
  h.timer.advance(5999);
  await flush();
  expect(h.starts).toEqual([0]);
  h.timer.advance(6000);
  await flush();
  expect(h.starts).toEqual([0, 6000]);
  h.timer.advance(8000);
  await flush();
  expect(h.starts).toEqual([0, 6000, 8000]);
});
test("coalesces-resize-without-collecting", async () => {
  const value = snapshot();
  value.currentSessions = Array.from({ length: 10 }, (_, index) => ({
    id: `id-${index}`,
    status: "running",
    elapsedMs: 1000,
    project: "project",
    slug: `slug-${index}`,
    model: "gpt-6-astra",
    effort: "high",
  }));
  const h = harness(async () => ({ kind: "snapshot", snapshot: value }));
  void runTui(h.deps, 2000);
  await flush();
  const before = h.output.frames.length;
  h.output.rows = 18;
  h.output.emit("resize");
  h.output.rows = 32;
  h.output.emit("resize");
  h.output.columns = 0;
  h.output.emit("resize");
  h.timer.advance(0);
  await flush();
  expect(h.starts).toEqual([0]);
  expect(h.output.frames.slice(before)).toEqual(["\u001b[H\u001b[2J"]);
  h.output.columns = 120;
  h.output.rows = 24;
  h.output.emit("resize");
  h.timer.advance(0);
  await flush();
  expect(h.output.frames.at(-1)).toContain("slug-9");
  expect(h.output.frames.at(-1)).not.toContain("more; use oracle-top snapshot");
  expect(h.starts).toEqual([0]);
});
test("q-aborts-restores-and-removes-only-owned-resources", async () => {
  const h = harness();
  const foreign = () => {};
  h.input.on("data", foreign);
  h.output.on("resize", foreign);
  h.output.on("error", foreign);
  h.output.on("close", foreign);
  h.signals.on("SIGINT", foreign);
  h.signals.on("SIGTERM", foreign);
  const result = runTui(h.deps, 2000);
  await flush();
  expect(h.input.isRaw).toBe(true);
  expect(h.input.paused).toBe(false);
  expect(h.output.frames.join("")).toContain("\u001b[?1049h\u001b[?25l");
  h.input.emit("data", Buffer.from("q"));
  await expect(result).resolves.toBe(0);
  expect(h.input.rawChanges).toEqual([true, false]);
  expect(h.input.paused).toBe(true);
  expect(h.aborts[0]!.aborted).toBe(true);
  expect(h.output.frames.at(-1)).toBe("\u001b[?25h\u001b[0m\u001b[?1049l");
  expect(h.input.listeners("data")).toEqual([foreign]);
  expect(h.output.listeners("resize")).toEqual([foreign]);
  expect(h.output.listeners("error")).toEqual([foreign]);
  expect(h.output.listeners("close")).toEqual([foreign]);
  expect(h.signals.listeners("SIGINT")).toEqual([foreign]);
  expect(h.signals.listeners("SIGTERM")).toEqual([foreign]);
  expect(h.timer.jobs.size).toBe(0);
  const count = h.output.frames.length;
  h.input.emit("data", Buffer.from("q"));
  h.timer.advance(10000);
  await flush();
  expect(h.output.frames.length).toBe(count);
});
test("raw-etx-and-sigint-exit-130", async () => {
  for (const exit of ["etx", "SIGINT"]) {
    const h = harness();
    const result = runTui(h.deps, 2000);
    await flush();
    if (exit === "etx") h.input.emit("data", Buffer.from("\u0003"));
    else h.signals.emit("SIGINT");
    const state = { raw: h.input.isRaw, aborted: h.aborts[0]!.aborted };
    expect(state).toEqual({ raw: false, aborted: true });
    await expect(result).resolves.toBe(130);
  }
});
test("sigterm-exits-143-and-preserves-signal-code-on-restore-failure", async () => {
  const h = harness();
  const result = runTui(h.deps, 2000);
  await flush();
  h.input.setRawMode = () => {
    throw new Error("synthetic restoration error");
  };
  h.signals.emit("SIGTERM");
  expect(h.aborts[0]!.aborted).toBe(true);
  await expect(result).resolves.toBe(143);
  expect(h.input.paused).toBe(true);
  expect(h.output.frames.at(-1)).toBe("\u001b[?25h\u001b[0m\u001b[?1049l");
});
test("internal-collector-exception-restores-and-exits-one", async () => {
  const h = harness(async () => {
    throw new Error("synthetic-private-detail");
  });
  await expect(runTui(h.deps, 2000)).resolves.toBe(1);
  expect(h.input.isRaw).toBe(false);
  expect(h.input.paused).toBe(true);
  expect(h.timer.jobs.size).toBe(0);
  expect(h.output.frames.at(-1)).toBe("\u001b[?25h\u001b[0m\u001b[?1049l");
  expect(h.output.frames.join("")).not.toContain("synthetic-private-detail");
});

test("waits-for-frame-drain-before-next-scan", async () => {
  const h = harness();
  h.output.block = true;
  void runTui(h.deps, 2000);
  await flush();
  h.timer.advance(5000);
  await flush();
  expect(h.starts).toEqual([0]);
  h.output.block = false;
  h.output.pending.shift()!();
  await flush();
  h.timer.advance(5999);
  await flush();
  expect(h.starts).toEqual([0]);
  h.timer.advance(6000);
  await flush();
  expect(h.starts).toEqual([0, 6000]);
  expect(h.output.listenerCount("drain")).toBe(0);
});
test("resize-during-drain-keeps-only-latest-dimensions", async () => {
  const h = harness();
  h.output.block = true;
  void runTui(h.deps, 2000);
  await flush();
  h.output.columns = 79;
  h.output.emit("resize");
  h.output.columns = 120;
  h.output.emit("resize");
  h.output.columns = 79;
  h.output.emit("resize");
  h.timer.advance(5000);
  expect(h.output.frames.length).toBe(2);
  h.output.block = false;
  h.output.pending.shift()!();
  await flush();
  expect(h.output.frames.at(-1)).toBe(
    "\u001b[H\u001b[2JTerminal too narrow: need 80 columns. Use oracle-top snapshot.",
  );
  expect(h.output.frames.length).toBe(3);
  expect(h.starts).toEqual([0]);
  h.timer.advance(6000);
  await flush();
  expect(h.starts).toEqual([0, 6000]);
});
test("epipe-exits-zero-without-restoring-to-broken-stdout", async () => {
  const h = harness();
  const attempts: string[] = [];
  const write = h.output.write.bind(h.output);
  h.output.write = ((...args: unknown[]) => {
    attempts.push(String(args[0]));
    return Reflect.apply(write, h.output, args) as boolean;
  }) as typeof h.output.write;
  h.output._write = (chunk, _encoding, done) => {
    h.output.frames.push(chunk.toString());
    if (chunk.toString().startsWith("\u001b[H"))
      done(
        Object.assign(new Error("synthetic-private-detail"), { code: "EPIPE" }),
      );
    else done();
  };
  await expect(runTui(h.deps, 2000)).resolves.toBe(0);
  expect(h.input.isRaw).toBe(false);
  expect(h.input.paused).toBe(true);
  expect(h.timer.jobs.size).toBe(0);
  expect(attempts).toHaveLength(2);
  expect(attempts.some((value) => value.includes("\u001b[?1049l"))).toBe(false);
  expect(h.output.listenerCount("error")).toBe(0);
  expect(h.output.listenerCount("drain")).toBe(0);
});
test("other-output-error-exits-one-and-keeps-local-restoration", async () => {
  const h = harness();
  h.output._write = (chunk, _encoding, done) => {
    h.output.frames.push(chunk.toString());
    if (chunk.toString().startsWith("\u001b[H"))
      done(
        Object.assign(new Error("synthetic-private-detail"), { code: "EIO" }),
      );
    else done();
  };
  await expect(runTui(h.deps, 2000)).resolves.toBe(1);
  expect(h.input.isRaw).toBe(false);
  expect(h.input.paused).toBe(true);
  expect(h.aborts[0]!.aborted).toBe(true);
  expect(h.timer.jobs.size).toBe(0);
  expect(h.output.listenerCount("error")).toBe(0);
  expect(h.output.listenerCount("drain")).toBe(0);
});
test("q-during-collection-restores-before-late-result", async () => {
  const pending = deferred<TuiCollectResult>();
  const h = harness(() => pending.promise);
  const result = runTui(h.deps, 2000);
  await flush();
  h.input.emit("data", Buffer.from("q"));
  await expect(result).resolves.toBe(0);
  expect(h.aborts[0]!.aborted).toBe(true);
  expect(h.input.isRaw).toBe(false);
  const count = h.output.frames.length;
  pending.resolve({ kind: "snapshot", snapshot: snapshot() });
  await flush();
  h.timer.advance(10000);
  await flush();
  expect(h.output.frames.length).toBe(count);
  expect(h.timer.jobs.size).toBe(0);
  expect(h.starts).toEqual([0]);
});
test("q-during-drain-resolves-and-bounds-late-error-guardian", async () => {
  const h = harness();
  h.output.block = true;
  const late: number[] = [];
  const deps = { ...h.deps, onLateExitCode: (code: number) => late.push(code) };
  const result = runTui(deps, 2000);
  let finished = false;
  void result.then(() => {
    finished = true;
  });
  await flush();
  h.input.emit("data", Buffer.from("q"));
  await flush();
  expect(finished).toBe(true);
  await expect(result).resolves.toBe(0);
  expect(h.input.isRaw).toBe(false);
  expect(h.input.paused).toBe(true);
  expect(h.aborts[0]!.aborted).toBe(true);
  expect(h.output.listenerCount("drain")).toBe(0);
  expect(h.output.listenerCount("error")).toBe(1);
  expect(h.input.listenerCount("data")).toBe(0);
  expect(h.output.listenerCount("resize")).toBe(0);
  expect(h.timer.jobs.size).toBe(0);
  h.output.block = false;
  h.output.pending.shift()!();
  await flush();
  expect(h.output.frames.at(-1)).toBe("\u001b[?25h\u001b[0m\u001b[?1049l");
  expect(h.output.listenerCount("error")).toBe(0);
  expect(late).toEqual([]);
});
test("late-output-error-notifies-once-after-backpressured-q", async () => {
  const h = harness();
  h.output.block = true;
  const late: number[] = [];
  const result = runTui(
    { ...h.deps, onLateExitCode: (code) => late.push(code) },
    2000,
  );
  await flush();
  h.input.emit("data", Buffer.from("q"));
  await expect(result).resolves.toBe(0);
  h.output.pending.shift()!(
    Object.assign(new Error("synthetic-private-detail"), { code: "EIO" }),
  );
  await flush();
  expect(late).toEqual([1]);
  expect(h.output.listenerCount("error")).toBe(0);
  expect(h.output.listenerCount("close")).toBe(0);
  expect(
    h.output.frames.filter((value) => value.startsWith("\u001b[H")),
  ).toHaveLength(1);
});
test("late-output-error-keeps-signal-exit-code", async () => {
  const h = harness();
  h.output.block = true;
  const late: number[] = [];
  const result = runTui(
    { ...h.deps, onLateExitCode: (code) => late.push(code) },
    2000,
  );
  await flush();
  h.signals.emit("SIGTERM");
  await expect(result).resolves.toBe(143);
  h.output.pending.shift()!(
    Object.assign(new Error("synthetic-private-detail"), { code: "EIO" }),
  );
  await flush();
  expect(late).toEqual([143]);
  expect(h.input.isRaw).toBe(false);
  expect(h.input.paused).toBe(true);
  expect(h.output.listenerCount("error")).toBe(0);
});
test("normal-restoration-output-failure-exits-one", async () => {
  const h = harness();
  h.output._write = (chunk, _encoding, done) => {
    h.output.frames.push(chunk.toString());
    done(
      chunk.toString().includes("\u001b[?1049l")
        ? Object.assign(new Error("synthetic-private-detail"), { code: "EIO" })
        : undefined,
    );
  };
  const result = runTui(h.deps, 2000);
  await flush();
  h.input.emit("data", Buffer.from("q"));
  await expect(result).resolves.toBe(1);
  await flush();
  expect(h.input.isRaw).toBe(false);
  expect(h.input.paused).toBe(true);
  expect(h.output.listenerCount("error")).toBe(0);
});
test("late-collector-rejection-does-not-change-exit-or-write", async () => {
  const pending = deferred<TuiCollectResult>();
  const h = harness(() => pending.promise);
  const late: number[] = [];
  const result = runTui(
    { ...h.deps, onLateExitCode: (code) => late.push(code) },
    2000,
  );
  await flush();
  h.input.emit("data", Buffer.from("q"));
  await expect(result).resolves.toBe(0);
  const count = h.output.frames.length;
  pending.reject(new Error("synthetic-private-detail"));
  await flush();
  expect(late).toEqual([]);
  expect(h.output.frames.length).toBe(count);
  expect(h.timer.jobs.size).toBe(0);
});
test("guardian-close-cleans-up-without-new-frames", async () => {
  const h = harness();
  h.output.block = true;
  const result = runTui(h.deps, 2000);
  await flush();
  h.input.emit("data", Buffer.from("q"));
  await expect(result).resolves.toBe(0);
  h.output.destroy();
  await flush();
  expect(h.output.listenerCount("error")).toBe(0);
  expect(h.output.listenerCount("close")).toBe(0);
  expect(h.timer.jobs.size).toBe(0);
  expect(
    h.output.frames.filter((value) => value.startsWith("\u001b[H")),
  ).toHaveLength(1);
});
test("restores-original-raw-and-input-flow-state", async () => {
  const h = harness();
  h.input.isRaw = true;
  h.input.paused = false;
  const result = runTui(h.deps, 2000);
  await flush();
  h.input.emit("data", Buffer.from("q"));
  await expect(result).resolves.toBe(0);
  expect(h.input.isRaw).toBe(true);
  expect(h.input.paused).toBe(false);
  expect(h.input.rawChanges).toEqual([true, true]);
});
test("input-error-restores-with-safe-exit-one", async () => {
  const h = harness();
  const foreign = () => {};
  h.input.on("error", foreign);
  const result = runTui(h.deps, 2000);
  await flush();
  h.input.emit(
    "error",
    Object.assign(new Error("synthetic-private-detail"), { code: "EPIPE" }),
  );
  expect(h.input.isRaw).toBe(false);
  await expect(result).resolves.toBe(1);
  expect(h.input.listeners("error")).toEqual([foreign]);
});
test("cleanup-attempts-remaining-steps-after-local-failure", async () => {
  const h = harness();
  const result = runTui(h.deps, 2000);
  await flush();
  let pauseAttempts = 0;
  h.input.setRawMode = () => {
    throw new Error("synthetic raw error");
  };
  h.input.pause = () => {
    pauseAttempts++;
    throw new Error("synthetic pause error");
  };
  h.input.emit("data", Buffer.from("q"));
  await expect(result).resolves.toBe(1);
  expect(pauseAttempts).toBe(1);
  expect(h.output.frames.at(-1)).toBe("\u001b[?25h\u001b[0m\u001b[?1049l");
  expect(h.input.listenerCount("data")).toBe(0);
  expect(h.signals.listenerCount("SIGINT")).toBe(0);
  expect(h.timer.jobs.size).toBe(0);
});
test("pending-output-close-notifies-late-failure-and-removes-guardian", async () => {
  const h = harness();
  h.output.block = true;
  const late: number[] = [];
  const result = runTui(
    { ...h.deps, onLateExitCode: (code) => late.push(code) },
    2000,
  );
  await flush();
  h.input.emit("data", Buffer.from("q"));
  await expect(result).resolves.toBe(0);
  h.output.destroy();
  await flush();
  expect(late).toEqual([1]);
  expect(h.output.listenerCount("error")).toBe(0);
  expect(h.output.listenerCount("close")).toBe(0);
});
test("error-during-drain-after-callback-releases-stop", async () => {
  const h = harness();
  h.output.write = ((
    value: string,
    callback?: (error?: Error | null) => void,
  ) => {
    h.output.frames.push(value);
    if (value.includes("\u001b[?1049l")) return false;
    callback?.();
    return !value.startsWith("\u001b[H");
  }) as typeof h.output.write;
  const result = runTui(h.deps, 2000);
  let finished = false;
  void result.then(() => {
    finished = true;
  });
  await flush();
  h.output.emit(
    "error",
    Object.assign(new Error("synthetic-private-detail"), { code: "EIO" }),
  );
  await flush();
  expect(finished).toBe(true);
  await expect(result).resolves.toBe(1);
  expect(h.input.isRaw).toBe(false);
  expect(h.output.listenerCount("drain")).toBe(0);
  h.output.emit("close");
  expect(h.output.listenerCount("error")).toBe(0);
});
test("output-close-during-drain-stops-without-restoration-write", async () => {
  const h = harness();
  h.output.write = ((
    value: string,
    callback?: (error?: Error | null) => void,
  ) => {
    h.output.frames.push(value);
    if (value.includes("\u001b[?1049l")) return false;
    callback?.();
    return !value.startsWith("\u001b[H");
  }) as typeof h.output.write;
  const result = runTui(h.deps, 2000);
  let finished = false;
  void result.then(() => {
    finished = true;
  });
  await flush();
  h.output.emit("close");
  await flush();
  expect(finished).toBe(true);
  await expect(result).resolves.toBe(1);
  expect(h.output.frames).toHaveLength(2);
  expect(h.input.isRaw).toBe(false);
  expect(h.input.paused).toBe(true);
  expect(h.output.listenerCount("error")).toBe(0);
});

test("disposes-after-abort-without-waiting-for-collection", async () => {
  const pending = deferred<TuiCollectResult>();
  const h = harness(() => pending.promise);
  let disposed = 0,
    aborted = false;
  h.deps.dispose = () => {
    disposed++;
    aborted = h.aborts[0]!.aborted;
  };
  const running = runTui(h.deps, 2000);
  await flush();
  h.input.emit("data", "q");
  await expect(running).resolves.toBe(0);
  expect({
    disposed,
    aborted,
    raw: h.input.isRaw,
    restored: h.output.frames.includes("\u001b[?25h\u001b[0m\u001b[?1049l"),
  }).toEqual({ disposed: 1, aborted: true, raw: false, restored: true });
  pending.resolve({ kind: "snapshot", snapshot: snapshot() });
  await flush();
});
test("continues-restoration-after-dispose-failure", async () => {
  const h = harness();
  h.deps.dispose = () => {
    throw new Error("synthetic dispose");
  };
  const running = runTui(h.deps, 2000);
  await flush();
  let threw = false;
  try {
    h.input.emit("data", "q");
  } catch {
    threw = true;
  }
  expect({
    threw,
    raw: h.input.isRaw,
    restored: h.output.frames.includes("\u001b[?25h\u001b[0m\u001b[?1049l"),
  }).toEqual({ threw: false, raw: false, restored: true });
  await expect(running).resolves.toBe(1);
});

test("preserves-signal-priority-when-dispose-fails", async () => {
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const) {
    const h = harness();
    h.deps.dispose = () => {
      throw new Error("synthetic dispose");
    };
    const running = runTui(h.deps, 2000);
    await flush();
    h.signals.emit(signal);
    await expect(running).resolves.toBe(code);
    expect(h.input.isRaw).toBe(false);
    expect(h.output.frames).toContain("\u001b[?25h\u001b[0m\u001b[?1049l");
  }
});
