import { createNodeTuiDependencies } from "../src/tui.js";
import { expect, test } from "vitest";
import { EventEmitter } from "node:events";
import { createInputCollector, type WorkerPort } from "../src/io/collector.js";
import type { WorkerOptions } from "node:worker_threads";
const startup = {
  env: {
    ORACLE_HOME_DIR: "/synthetic/home",
    ORACLE_BROWSER_PROFILE_DIR: "/synthetic/profile",
    ORACLE_BROWSER_MAX_CONCURRENT_TABS: "4",
    SECRET: "never",
  },
  cwd: "/synthetic/cwd",
  osHome: "/synthetic",
  intervalArguments: ["2s"],
};
class Port extends EventEmitter implements WorkerPort {
  requests: any[] = [];
  terminations = 0;
  refs = 0;
  postMessage(value: unknown) {
    this.requests.push(value);
    queueMicrotask(() =>
      this.emit("message", {
        id: (value as any).id,
        result: { kind: "usage-error" },
      }),
    );
  }
  ref() {
    this.refs++;
  }
  unref() {
    this.refs--;
  }
  async terminate() {
    this.terminations++;
    return 0;
  }
}
test("starts-worker-lazily-and-captures-clock-once", async () => {
  const port = new Port();
  let starts = 0,
    clocks = 0;
  let opts: WorkerOptions | undefined;
  const collector = createInputCollector(startup, {
    now: () => {
      clocks++;
      return 1790748000000;
    },
    workerFactory(_url, options) {
      starts++;
      opts = options;
      return port;
    },
  });
  expect(starts).toBe(0);
  await expect(
    collector.collect(new AbortController().signal),
  ).resolves.toEqual({ kind: "usage-error" });
  expect({
    starts,
    clocks,
    now: port.requests[0].nowMs,
    env: opts?.env,
    execArgv: opts?.execArgv,
  }).toEqual({
    starts: 1,
    clocks: 1,
    now: 1790748000000,
    env: {
      HOME: "/synthetic",
      ORACLE_HOME_DIR: "/synthetic/home",
      ORACLE_BROWSER_PROFILE_DIR: "/synthetic/profile",
      ORACLE_BROWSER_MAX_CONCURRENT_TABS: "4",
    },
    execArgv: [],
  });
  collector.stop();
});
test("reuses-one-worker-and-fixed-startup-across-polls", async () => {
  const port = new Port();
  let starts = 0;
  const mutable = { ...startup, env: { ...startup.env } };
  const c = createInputCollector(mutable, {
    workerFactory() {
      starts++;
      return port;
    },
  });
  await c.collect(new AbortController().signal);
  mutable.env.ORACLE_HOME_DIR = "/other";
  await c.collect(new AbortController().signal);
  expect({
    starts,
    homes: port.requests.map((r) => r.startup.env.ORACLE_HOME_DIR),
  }).toEqual({ starts: 1, homes: ["/synthetic/home", "/synthetic/home"] });
  c.stop();
});
class BlockedPort extends Port {
  override postMessage(value: unknown) {
    this.requests.push(value);
  }
}
test("stop-releases-blocked-poll-and-rejects-late-reply", async () => {
  const port = new BlockedPort();
  let starts = 0;
  const c = createInputCollector(startup, {
    workerFactory() {
      starts++;
      return port;
    },
  });
  let result: unknown;
  const poll = c
    .collect(new AbortController().signal)
    .then((r) => (result = r));
  c.stop();
  c.stop();
  await Promise.resolve();
  expect({
    result,
    terminations: port.terminations,
    flag: Atomics.load(new Int32Array(port.requests[0].stopFlag), 0),
  }).toEqual({ result: { kind: "aborted" }, terminations: 1, flag: 1 });
  port.emit("message", { id: 1, result: { kind: "usage-error" } });
  await poll;
  await expect(c.collect(new AbortController().signal)).resolves.toEqual({
    kind: "aborted",
  });
  expect(starts).toBe(1);
});
test("rejects-overlapping-polls-without-extra-request", async () => {
  const port = new BlockedPort();
  const c = createInputCollector(startup, { workerFactory: () => port });
  const first = c.collect(new AbortController().signal);
  let outcome = "pending";
  void c.collect(new AbortController().signal).then(
    () => (outcome = "resolved"),
    () => (outcome = "rejected"),
  );
  await Promise.resolve();
  expect({ outcome, requests: port.requests.length }).toEqual({
    outcome: "rejected",
    requests: 1,
  });
  c.stop();
  await first;
});
test("isolates-worker-error-and-does-not-restart", async () => {
  const port = new BlockedPort();
  const external = () => {};
  port.on("error", external);
  let starts = 0;
  const c = createInputCollector(startup, {
    workerFactory() {
      starts++;
      return port;
    },
  });
  let outcome = "pending";
  const first = c.collect(new AbortController().signal).then(
    () => (outcome = "resolved"),
    () => (outcome = "rejected"),
  );
  port.emit("error", new Error("/private synthetic fault"));
  await Promise.resolve();
  expect(outcome).toBe("rejected");
  await first;
  await expect(c.collect(new AbortController().signal)).rejects.toThrow(
    "Collection failed",
  );
  expect(starts).toBe(1);
  c.stop();
  await Promise.resolve();
  expect(port.listeners("error")).toEqual([external]);
});
test("isolates-unexpected-worker-exit-before-stop", async () => {
  const port = new BlockedPort();
  const c = createInputCollector(startup, { workerFactory: () => port });
  let outcome = "pending";
  const poll = c.collect(new AbortController().signal).then(
    () => (outcome = "resolved"),
    () => (outcome = "rejected"),
  );
  port.emit("exit", 0);
  await Promise.resolve();
  expect(outcome).toBe("rejected");
  await poll;
  c.stop();
});
test("preserves-injected-io-path-without-worker", async () => {
  let starts = 0;
  const io = {
    realpath() {
      throw Object.assign(new Error("synthetic"), { code: "ENOENT" });
    },
    lstat() {
      throw new Error("unused");
    },
    open() {
      throw new Error("unused");
    },
    readdir() {
      throw new Error("unused");
    },
  };
  const c = createInputCollector(startup, {
    io,
    now: () => 1790748000000,
    workerFactory() {
      starts++;
      return new Port();
    },
  });
  await expect(c.collect(new AbortController().signal)).resolves.toMatchObject({
    kind: "inputs",
    nowMs: 1790748000000,
    inputs: { sessions: null, active: 0 },
  });
  expect(starts).toBe(0);
  c.stop();
});
test("node-tui-connects-collector-and-disposes-idle-worker", async () => {
  const port = new Port();
  let starts = 0;
  const deps = createNodeTuiDependencies(startup, {
    workerFactory() {
      starts++;
      return port;
    },
  });
  await expect(deps.collect(new AbortController().signal)).resolves.toEqual({
    kind: "usage-error",
  });
  expect(starts).toBe(1);
  deps.dispose?.();
  await Promise.resolve();
  expect({
    terminations: port.terminations,
    messageListeners: port.listenerCount("message"),
    errorListeners: port.listenerCount("error"),
  }).toEqual({ terminations: 1, messageListeners: 0, errorListeners: 0 });
});

test("aborts-blocked-worker-and-removes-only-owned-listeners", async () => {
  const port = new BlockedPort(),
    signal = new AbortController();
  const external = () => {};
  port.on("error", external);
  port.on("message", external);
  const c = createInputCollector(startup, { workerFactory: () => port });
  const poll = c.collect(signal.signal);
  signal.abort();
  await expect(poll).resolves.toEqual({ kind: "aborted" });
  port.emit("error", new Error("late"));
  port.emit("message", { id: 1, result: { kind: "usage-error" } });
  await Promise.resolve();
  expect({
    termination: port.terminations,
    error: port.listeners("error"),
    message: port.listeners("message"),
  }).toEqual({ termination: 1, error: [external], message: [external] });
});
test("stop-before-first-poll-does-not-create-worker", async () => {
  let starts = 0;
  const c = createInputCollector(startup, {
    workerFactory() {
      starts++;
      return new Port();
    },
  });
  c.stop();
  await expect(c.collect(new AbortController().signal)).resolves.toEqual({
    kind: "aborted",
  });
  expect(starts).toBe(0);
});

test("isolates-metrics-observer-failure-as-internal-error", async () => {
  const port = new BlockedPort();
  const c = createInputCollector(startup, {
    workerFactory: () => port,
    onMetrics() {
      throw new Error("synthetic observer");
    },
  });
  let outcome = "pending";
  const poll = c.collect(new AbortController().signal).then(
    () => (outcome = "resolved"),
    () => (outcome = "rejected"),
  );
  let threw = false;
  try {
    port.emit("message", {
      id: 1,
      result: { kind: "usage-error" },
      metrics: { readPeak: 1, readCalls: 1, bufferAllocatedBytes: 3 },
    });
  } catch {
    threw = true;
  }
  await Promise.resolve();
  expect({ threw, outcome }).toEqual({ threw: false, outcome: "rejected" });
  await poll;
  c.stop();
});
test("abort-during-clock-capture-starts-no-worker-or-read", async () => {
  const signal = new AbortController();
  let starts = 0;
  const c = createInputCollector(startup, {
    now() {
      signal.abort();
      return 1790748000000;
    },
    workerFactory() {
      starts++;
      return new Port();
    },
  });
  await expect(c.collect(signal.signal)).resolves.toEqual({ kind: "aborted" });
  expect(starts).toBe(0);
  c.stop();
});
