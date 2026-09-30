import { afterEach, beforeEach, expect, test } from "vitest";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
  symlink,
  rename,
} from "node:fs/promises";
import { join } from "node:path";
import {
  collectInputs,
  collectSessions,
  nodeCollectorFileSystem,
  type CollectorFileSystem,
} from "../src/io/sessions.js";
import { collectLeases } from "../src/io/leases.js";
import { buildDashboard } from "../src/aggregate.js";
let fixture: string;
let home: string;
let profile: string;
const now = 1790748000000;
beforeEach(async () => {
  await mkdir(join(process.cwd(), ".workbench/p06"), { recursive: true });
  fixture = await mkdtemp(join(process.cwd(), ".workbench/p06/fixture-"));
  home = join(fixture, "home");
  profile = join(fixture, "profile");
  await mkdir(join(home, "sessions"), { recursive: true });
  await mkdir(profile);
  await writeFile(join(home, "config.json"), "{}");
  await writeFile(
    join(profile, "oracle-tab-leases.json"),
    '{"version":1,"leases":[]}',
  );
});
afterEach(async () => {
  await rm(fixture, { recursive: true, force: true });
});
async function session(id: string, extra: Record<string, unknown> = {}) {
  await mkdir(join(home, "sessions", id));
  await writeFile(
    join(home, "sessions", id, "meta.json"),
    JSON.stringify({
      id,
      mode: "browser",
      model: "gpt-6-astra",
      status: "running",
      cwd: "/workspace/project",
      startedAt: "2026-09-30T05:58:00.000Z",
      options: {
        browserConfig: { manualLoginProfileDir: profile, maxConcurrentTabs: 3 },
      },
      ...extra,
    }),
  );
}
function startup() {
  return {
    cwd: fixture,
    osHome: fixture,
    env: { ORACLE_HOME_DIR: home, ORACLE_BROWSER_PROFILE_DIR: profile },
  };
}
test("scans-all-directories-including-old-current", async () => {
  await session("old", { startedAt: "2026-09-22T06:00:00.000Z" });
  await session("recent");
  const result = await collectInputs(startup(), { now: () => now });
  expect(result.kind).toBe("inputs");
  if (result.kind !== "inputs") throw new Error("inputs required");
  expect(result.inputs.sessions?.map((row) => row.id).sort()).toEqual([
    "old",
    "recent",
  ]);
});
test("isolates-corrupt-metadata-without-derived-warnings", async () => {
  await session("good-a");
  await session("good-b");
  await session("broken");
  await writeFile(join(home, "sessions/broken/meta.json"), "{");
  const result = await collectSessions({ homePath: home });
  expect(result).toMatchObject({
    kind: "sessions",
    dataWarnings: [
      { source: "session", sessionId: "broken", code: "INVALID_JSON" },
    ],
  });
  if (result.kind !== "sessions") throw new Error("sessions required");
  expect(result.sessions?.map((row) => row.id).sort()).toEqual([
    "good-a",
    "good-b",
  ]);
});
test("missing-sessions-root-is-unavailable", async () => {
  await rm(join(home, "sessions"), { recursive: true });
  expect(await collectSessions({ homePath: home })).toEqual({
    kind: "sessions",
    sessions: null,
    dataWarnings: [{ source: "sessions", code: "SESSIONS_MISSING" }],
  });
});
test("unreadable-sessions-root-is-unavailable", async () => {
  const io: CollectorFileSystem = {
    ...nodeCollectorFileSystem,
    async readdir() {
      throw Object.assign(new Error("private path must not leak"), {
        code: "EACCES",
      });
    },
  };
  expect(await collectSessions({ homePath: home, io })).toEqual({
    kind: "sessions",
    sessions: null,
    dataWarnings: [{ source: "sessions", code: "SESSIONS_UNREADABLE" }],
  });
});
test("rejects-sessions-symlink-before-enumeration", async () => {
  await rm(join(home, "sessions"), { recursive: true });
  await mkdir(join(fixture, "elsewhere"));
  await symlink(join(fixture, "elsewhere"), join(home, "sessions"));
  let enumerated = false;
  const io: CollectorFileSystem = {
    ...nodeCollectorFileSystem,
    async readdir(path) {
      enumerated = true;
      return nodeCollectorFileSystem.readdir(path);
    },
  };
  expect(await collectSessions({ homePath: home, io })).toEqual({
    kind: "sessions",
    sessions: null,
    dataWarnings: [{ source: "sessions", code: "SYMLINK_SKIPPED" }],
  });
  expect(enumerated).toBe(false);
});
test("counts-all-v1-leases-without-pid-or-stale-filtering", async () => {
  await writeFile(
    join(profile, "oracle-tab-leases.json"),
    JSON.stringify({
      version: 1,
      leases: [
        { pid: -1, heartbeat: "old" },
        { pid: -1, heartbeat: "old" },
        {},
        { pid: "invalid but uninspected" },
      ],
    }),
  );
  expect(await collectLeases({ profilePath: profile })).toEqual({
    kind: "leases",
    active: 4,
    profileRealPath: profile,
    dataWarnings: [],
  });
});
test("rejects-invalid-v1-lease-structure", async () => {
  for (const value of [
    { version: 2, leases: [] },
    { version: "1", leases: [] },
    { version: 1, leases: null },
    { version: 1, leases: [null] },
    { version: 1, leases: [[]] },
    { version: 1, leases: [1] },
    { leases: [] },
  ]) {
    await writeFile(
      join(profile, "oracle-tab-leases.json"),
      JSON.stringify(value),
    );
    expect(await collectLeases({ profilePath: profile })).toEqual({
      kind: "leases",
      active: null,
      profileRealPath: profile,
      dataWarnings: [{ source: "leases", code: "LEASES_INVALID" }],
    });
  }
});
test("missing-profile-or-registry-means-zero-stored-leases", async () => {
  await rm(join(profile, "oracle-tab-leases.json"));
  expect(await collectLeases({ profilePath: profile })).toEqual({
    kind: "leases",
    active: 0,
    profileRealPath: profile,
    dataWarnings: [{ source: "leases", code: "FILE_MISSING" }],
  });
  await rm(profile, { recursive: true });
  expect(await collectLeases({ profilePath: profile })).toEqual({
    kind: "leases",
    active: 0,
    profileRealPath: null,
    dataWarnings: [{ source: "leases", code: "FILE_MISSING" }],
  });
});
test("ignores-files-and-skips-session-directory-symlinks", async () => {
  await session("normal");
  await writeFile(join(home, "sessions/irrelevant.txt"), "synthetic");
  await mkdir(join(fixture, "outside"));
  await writeFile(join(fixture, "outside/meta.json"), "{}");
  await symlink(join(fixture, "outside"), join(home, "sessions/linked"));
  const opened: string[] = [];
  const io: CollectorFileSystem = {
    ...nodeCollectorFileSystem,
    async open(path, flags) {
      opened.push(path);
      return nodeCollectorFileSystem.open(path, flags);
    },
  };
  const result = await collectSessions({ homePath: home, io });
  expect(result).toMatchObject({
    kind: "sessions",
    dataWarnings: [
      { source: "session", sessionId: "linked", code: "SYMLINK_SKIPPED" },
    ],
  });
  if (result.kind !== "sessions") throw new Error("sessions required");
  expect(result.sessions?.map((r) => r.id)).toEqual(["normal"]);
  expect(opened).toEqual([join(home, "sessions/normal/meta.json")]);
});
test("isolates-enumeration-directory-replacement", async () => {
  await session("old");
  const io: CollectorFileSystem = {
    ...nodeCollectorFileSystem,
    async readdir(path) {
      const ids = await nodeCollectorFileSystem.readdir(path);
      await rename(path, join(home, "moved-sessions"));
      await mkdir(path);
      return ids;
    },
  };
  expect(await collectSessions({ homePath: home, io })).toEqual({
    kind: "sessions",
    sessions: null,
    dataWarnings: [{ source: "sessions", code: "FILE_CHANGED" }],
  });
});
test("isolates-directory-disappearance-and-keeps-other-session", async () => {
  await session("gone");
  await session("healthy");
  const io: CollectorFileSystem = {
    ...nodeCollectorFileSystem,
    async readdir(path) {
      const ids = await nodeCollectorFileSystem.readdir(path);
      await rm(join(path, "gone"), { recursive: true });
      return ids;
    },
  };
  const result = await collectSessions({ homePath: home, io });
  expect(result).toMatchObject({
    kind: "sessions",
    dataWarnings: [
      { source: "session", sessionId: "gone", code: "FILE_CHANGED" },
    ],
  });
  if (result.kind !== "sessions") throw new Error("sessions required");
  expect(result.sessions?.map((r) => r.id)).toEqual(["healthy"]);
});
test("isolates-session-directory-replacement-before-file-read", async () => {
  await session("swapped");
  await session("healthy");
  let replaced = false;
  const path = join(home, "sessions/swapped");
  const io: CollectorFileSystem = {
    ...nodeCollectorFileSystem,
    async lstat(target) {
      const stat = await nodeCollectorFileSystem.lstat(target);
      if (target === path && !replaced) {
        replaced = true;
        await rename(path, join(home, "moved-session"));
        await mkdir(path);
        await writeFile(
          join(path, "meta.json"),
          JSON.stringify({
            mode: "browser",
            model: "gpt-6-astra",
            status: "running",
          }),
        );
      }
      return stat;
    },
  };
  const result = await collectSessions({ homePath: home, io });
  expect(result).toMatchObject({
    kind: "sessions",
    dataWarnings: [
      { source: "session", sessionId: "swapped", code: "FILE_CHANGED" },
    ],
  });
  if (result.kind !== "sessions") throw new Error("sessions required");
  expect(result.sessions?.map((r) => r.id)).toEqual(["healthy"]);
});
test("abort-discards-late-read-and-starts-no-further-files", async () => {
  await session("a");
  await session("b");
  const controller = new AbortController();
  let opens = 0;
  let closes = 0;
  const io: CollectorFileSystem = {
    ...nodeCollectorFileSystem,
    async open(path, flags) {
      opens++;
      const handle = await nodeCollectorFileSystem.open(path, flags);
      return {
        ...handle,
        async read(buffer, offset, length, position) {
          const result = await handle.read(buffer, offset, length, position);
          controller.abort();
          return result;
        },
        async close() {
          closes++;
          await handle.close();
        },
      };
    },
  };
  expect(
    await collectInputs(startup(), {
      io,
      signal: controller.signal,
      now: () => now,
    }),
  ).toEqual({ kind: "aborted" });
  expect(opens).toBe(1);
  expect(closes).toBe(1);
});
test("session-abort-discards-results-and-stops-new-reads", async () => {
  await session("a");
  await session("b");
  const controller = new AbortController();
  let opens = 0;
  let closes = 0;
  const io: CollectorFileSystem = {
    ...nodeCollectorFileSystem,
    async open(path, flags) {
      opens++;
      const handle = await nodeCollectorFileSystem.open(path, flags);
      return {
        ...handle,
        async read(buffer, offset, length, position) {
          const result = await handle.read(buffer, offset, length, position);
          controller.abort();
          return result;
        },
        async close() {
          closes++;
          await handle.close();
        },
      };
    },
  };
  expect(
    await collectSessions({ homePath: home, io, signal: controller.signal }),
  ).toEqual({ kind: "aborted" });
  expect(opens).toBe(1);
  expect(closes).toBe(1);
});
test("aborted-lease-collection-does-not-probe-profile", async () => {
  const controller = new AbortController();
  controller.abort();
  let probes = 0;
  const io: CollectorFileSystem = {
    ...nodeCollectorFileSystem,
    async realpath(path) {
      probes++;
      return nodeCollectorFileSystem.realpath(path);
    },
  };
  expect(
    await collectLeases({
      profilePath: profile,
      io,
      signal: controller.signal,
    }),
  ).toEqual({ kind: "aborted" });
  expect(probes).toBe(0);
});
test("abort-during-identity-check-stops-following-probes", async () => {
  await session("normal");
  const controller = new AbortController();
  let directoryProbes = 0;
  let rootProbes = 0;
  let opens = 0;
  const io: CollectorFileSystem = {
    ...nodeCollectorFileSystem,
    async lstat(path) {
      const stat = await nodeCollectorFileSystem.lstat(path);
      if (path === home) rootProbes++;
      if (path === join(home, "sessions") && ++directoryProbes === 2)
        controller.abort();
      return stat;
    },
    async open(path, flags) {
      opens++;
      return nodeCollectorFileSystem.open(path, flags);
    },
  };
  expect(
    await collectSessions({ homePath: home, io, signal: controller.signal }),
  ).toEqual({ kind: "aborted" });
  expect(rootProbes).toBe(1);
  expect(opens).toBe(0);
});
test("counts-directories-not-conversations-and-keeps-unknown-status-usage", async () => {
  const extra = {
    status: "completed",
    completedAt: "2026-09-30T05:59:00Z",
    conversationId: "synthetic-same",
    browser: { runtime: { promptSubmitted: true } },
    options: {
      browserFollowUps: ["duplicate synthetic", "duplicate synthetic"],
    },
  };
  await session("a", extra);
  await session("b", extra);
  await session("unknown", {
    status: "saved-future-status",
    browser: { runtime: { promptSubmitted: true } },
    options: { browserFollowUps: ["ignored extra"] },
  });
  const result = await collectInputs(startup(), { now: () => now });
  if (result.kind !== "inputs") throw new Error("inputs required");
  const snapshot = buildDashboard(result.inputs, result.nowMs);
  expect(snapshot.submittedMessages).toEqual([
    {
      model: "gpt-6-astra",
      effort: "unknown",
      submitted24h: 7,
      submitted7d: 7,
    },
  ]);
  expect(snapshot.currentSessions).toEqual([]);
  expect(snapshot.reliability24h).toEqual({
    completed: 2,
    partial: 0,
    error: 0,
    cancelled: 0,
    evaluated: 2,
    successRate: 1,
  });
});
test("captures-clock-before-config-and-rereads-config-each-poll", async () => {
  const events: string[] = [];
  let clockCalls = 0;
  const io: CollectorFileSystem = {
    ...nodeCollectorFileSystem,
    async open(path, flags) {
      if (path === join(home, "config.json")) events.push("config");
      return nodeCollectorFileSystem.open(path, flags);
    },
  };
  const deps = {
    io,
    now: () => {
      clockCalls++;
      events.push("now");
      return now;
    },
  };
  const first = await collectInputs(startup(), deps);
  expect(events.slice(0, 2)).toEqual(["now", "config"]);
  expect(clockCalls).toBe(1);
  if (first.kind !== "inputs") throw new Error("inputs required");
  expect(first.nowMs).toBe(1790748000000);
  expect(first.inputs.config.fallbackMaximum).toBe(3);
  await writeFile(join(home, "config.json"), "{browser:{maxConcurrentTabs:6}}");
  const second = await collectInputs(startup(), deps);
  if (second.kind !== "inputs") throw new Error("inputs required");
  expect(second.inputs.config.fallbackMaximum).toBe(6);
  expect(clockCalls).toBe(2);
});
test("reads-only-selected-profile-and-accepts-its-resolved-alias", async () => {
  const selectedAlias = join(fixture, "profile-alias");
  await symlink(profile, selectedAlias);
  const foreign = join(fixture, "foreign-profile");
  await session("selected", {
    options: {
      browserConfig: { manualLoginProfileDir: profile, maxConcurrentTabs: 3 },
    },
  });
  await session("foreign", {
    startedAt: "2026-09-30T06:00:00Z",
    options: {
      browserConfig: { manualLoginProfileDir: foreign, maxConcurrentTabs: 9 },
    },
  });
  const paths: string[] = [];
  const io: CollectorFileSystem = {
    ...nodeCollectorFileSystem,
    async realpath(path) {
      paths.push(path);
      return nodeCollectorFileSystem.realpath(path);
    },
    async lstat(path) {
      paths.push(path);
      return nodeCollectorFileSystem.lstat(path);
    },
    async open(path, flags) {
      paths.push(path);
      return nodeCollectorFileSystem.open(path, flags);
    },
  };
  const config = startup();
  config.env.ORACLE_BROWSER_PROFILE_DIR = selectedAlias;
  const result = await collectInputs(config, { io, now: () => now });
  if (result.kind !== "inputs") throw new Error("inputs required");
  const snapshot = buildDashboard(result.inputs, result.nowMs);
  expect(snapshot.browserCapacity.maximum).toBe(3);
  expect(snapshot.currentSessions?.map((r) => r.id)).toEqual([
    "foreign",
    "selected",
  ]);
  expect(snapshot.dataWarnings).toEqual([
    { source: "session", sessionId: "foreign", code: "PROFILE_DIFFERENT" },
  ]);
  expect(
    paths.some((path) => path === foreign || path.startsWith(`${foreign}/`)),
  ).toBe(false);
});
test("configured-home-symlink-is-allowed-but-meta-file-symlink-is-skipped", async () => {
  await session("healthy");
  await session("linked");
  await rm(join(home, "sessions/linked/meta.json"));
  await writeFile(join(fixture, "outside-meta.json"), "{}");
  await symlink(
    join(fixture, "outside-meta.json"),
    join(home, "sessions/linked/meta.json"),
  );
  const alias = join(fixture, "home-alias");
  await symlink(home, alias);
  const opened: string[] = [];
  const io: CollectorFileSystem = {
    ...nodeCollectorFileSystem,
    async open(path, flags) {
      opened.push(path);
      return nodeCollectorFileSystem.open(path, flags);
    },
  };
  const result = await collectSessions({ homePath: alias, io });
  expect(result).toMatchObject({
    kind: "sessions",
    dataWarnings: [
      { source: "session", sessionId: "linked", code: "SYMLINK_SKIPPED" },
    ],
  });
  if (result.kind !== "sessions") throw new Error("sessions required");
  expect(result.sessions?.map((r) => r.id)).toEqual(["healthy"]);
  expect(opened).toEqual([join(home, "sessions/healthy/meta.json")]);
});
test("lease-read-stays-on-resolved-profile-after-root-alias-retarget", async () => {
  const alias = join(fixture, "alias");
  const other = join(fixture, "other-profile");
  await mkdir(other);
  await writeFile(
    join(other, "oracle-tab-leases.json"),
    '{"version":1,"leases":[{},{}]}',
  );
  await symlink(profile, alias);
  let retargeted = false;
  const opened: string[] = [];
  const io: CollectorFileSystem = {
    ...nodeCollectorFileSystem,
    async realpath(path) {
      const value = await nodeCollectorFileSystem.realpath(path);
      if (path === alias && !retargeted) {
        retargeted = true;
        await rm(alias);
        await symlink(other, alias);
      }
      return value;
    },
    async open(path, flags) {
      opened.push(path);
      return nodeCollectorFileSystem.open(path, flags);
    },
  };
  expect(await collectLeases({ profilePath: alias, io })).toEqual({
    kind: "leases",
    profileRealPath: profile,
    active: 0,
    dataWarnings: [],
  });
  expect(opened).toEqual([join(profile, "oracle-tab-leases.json")]);
});
test("session-reads-stay-on-enumerated-root-after-alias-retarget", async () => {
  await session("same-id");
  const alias = join(fixture, "home-alias");
  const other = join(fixture, "other-home");
  await mkdir(join(other, "sessions/same-id"), { recursive: true });
  await writeFile(
    join(other, "sessions/same-id/meta.json"),
    JSON.stringify({
      mode: "browser",
      model: "gpt-6-astra",
      status: "completed",
    }),
  );
  await symlink(home, alias);
  let retargeted = false;
  const opened: string[] = [];
  const io: CollectorFileSystem = {
    ...nodeCollectorFileSystem,
    async realpath(path) {
      const value = await nodeCollectorFileSystem.realpath(path);
      if (path === alias && !retargeted) {
        retargeted = true;
        await rm(alias);
        await symlink(other, alias);
      }
      return value;
    },
    async open(path, flags) {
      opened.push(path);
      return nodeCollectorFileSystem.open(path, flags);
    },
  };
  const result = await collectSessions({ homePath: alias, io });
  if (result.kind !== "sessions") throw new Error("sessions required");
  expect(result.sessions?.map((r) => [r.id, r.status])).toEqual([
    ["same-id", "running"],
  ]);
  expect(opened).toEqual([join(home, "sessions/same-id/meta.json")]);
});
test("observed-profile-disappearance-is-changed-not-initial-missing", async () => {
  const io: CollectorFileSystem = {
    ...nodeCollectorFileSystem,
    async realpath(path) {
      const resolved = await nodeCollectorFileSystem.realpath(path);
      if (path === profile) await rm(profile, { recursive: true });
      return resolved;
    },
  };
  expect(await collectLeases({ profilePath: profile, io })).toEqual({
    kind: "leases",
    active: null,
    profileRealPath: profile,
    dataWarnings: [{ source: "leases", code: "FILE_CHANGED" }],
  });
});
test("profile-replacement-during-read-is-unknown-capacity", async () => {
  let replaced = false;
  const io: CollectorFileSystem = {
    ...nodeCollectorFileSystem,
    async lstat(path) {
      const stat = await nodeCollectorFileSystem.lstat(path);
      if (path === profile && !replaced) {
        replaced = true;
        await rename(profile, join(fixture, "moved-profile"));
        await mkdir(profile);
        await writeFile(
          join(profile, "oracle-tab-leases.json"),
          '{"version":1,"leases":[{}]}',
        );
      }
      return stat;
    },
  };
  expect(await collectLeases({ profilePath: profile, io })).toEqual({
    kind: "leases",
    active: null,
    profileRealPath: profile,
    dataWarnings: [{ source: "leases", code: "FILE_CHANGED" }],
  });
});
test("all-document-reads-stay-within-eight-and-close", async () => {
  for (let index = 0; index < 12; index++) await session(`session-${index}`);
  let active = 0;
  let peak = 0;
  let opens = 0;
  let closes = 0;
  const io: CollectorFileSystem = {
    ...nodeCollectorFileSystem,
    async open(path, flags) {
      const handle = await nodeCollectorFileSystem.open(path, flags);
      opens++;
      active++;
      peak = Math.max(peak, active);
      return {
        ...handle,
        async close() {
          try {
            await handle.close();
          } finally {
            active--;
            closes++;
          }
        },
      };
    },
  };
  const result = await collectInputs(startup(), { io, now: () => now });
  expect(result.kind).toBe("inputs");
  expect(peak).toBeLessThanOrEqual(8);
  expect(peak).toBeGreaterThan(0);
  expect(opens).toBe(14);
  expect(closes).toBe(14);
  expect(active).toBe(0);
});
test("profile-permission-failure-stays-unreadable-not-missing", async () => {
  const io: CollectorFileSystem = {
    ...nodeCollectorFileSystem,
    async lstat(path) {
      if (path === profile)
        throw Object.assign(new Error("private profile path"), {
          code: "EACCES",
        });
      return nodeCollectorFileSystem.lstat(path);
    },
  };
  expect(await collectLeases({ profilePath: profile, io })).toEqual({
    kind: "leases",
    active: null,
    profileRealPath: profile,
    dataWarnings: [{ source: "leases", code: "FILE_UNREADABLE" }],
  });
});
test("lease-reader-failure-is-isolated-without-structure-warnings", async () => {
  for (const [text, code] of [
    ["{", "INVALID_JSON"],
    ["null", "INVALID_ROOT"],
    ["[]", "INVALID_ROOT"],
  ]) {
    await writeFile(join(profile, "oracle-tab-leases.json"), text!);
    expect(await collectLeases({ profilePath: profile })).toEqual({
      kind: "leases",
      active: null,
      profileRealPath: profile,
      dataWarnings: [{ source: "leases", code }],
    });
  }
  const io: CollectorFileSystem = {
    ...nodeCollectorFileSystem,
    async open() {
      throw Object.assign(new Error("private failure"), { code: "EACCES" });
    },
  };
  expect(await collectLeases({ profilePath: profile, io })).toEqual({
    kind: "leases",
    active: null,
    profileRealPath: profile,
    dataWarnings: [{ source: "leases", code: "FILE_UNREADABLE" }],
  });
});
test("non-directory-profile-is-not-regular-without-reading-registry", async () => {
  await rm(profile, { recursive: true });
  await writeFile(profile, "synthetic profile file");
  let opens = 0;
  const io: CollectorFileSystem = {
    ...nodeCollectorFileSystem,
    async open(path, flags) {
      opens++;
      return nodeCollectorFileSystem.open(path, flags);
    },
  };
  expect(await collectLeases({ profilePath: profile, io })).toEqual({
    kind: "leases",
    active: null,
    profileRealPath: profile,
    dataWarnings: [{ source: "leases", code: "FILE_NOT_REGULAR" }],
  });
  expect(opens).toBe(0);
});
test("changed-file-is-not-retried-and-next-poll-adopts-normal-file", async () => {
  await session("changing");
  let changed = false;
  let opens = 0;
  const io: CollectorFileSystem = {
    ...nodeCollectorFileSystem,
    async open(path, flags) {
      opens++;
      const handle = await nodeCollectorFileSystem.open(path, flags);
      return {
        ...handle,
        async read(buffer, offset, length, position) {
          const result = await handle.read(buffer, offset, length, position);
          if (!changed && result.bytesRead > 0) {
            changed = true;
            await writeFile(
              path,
              JSON.stringify({
                mode: "browser",
                model: "gpt-6-astra",
                status: "running",
                cwd: "/workspace/project",
                startedAt: "2026-09-30T05:58:00Z",
                options: {
                  browserConfig: {
                    manualLoginProfileDir: profile,
                    maxConcurrentTabs: 3,
                  },
                },
              }),
            );
          }
          return result;
        },
      };
    },
  };
  expect(await collectSessions({ homePath: home, io })).toEqual({
    kind: "sessions",
    sessions: [],
    dataWarnings: [
      { source: "session", sessionId: "changing", code: "FILE_CHANGED" },
    ],
  });
  expect(opens).toBe(1);
  const next = await collectSessions({ homePath: home, io });
  expect(next).toMatchObject({ kind: "sessions", dataWarnings: [] });
  if (next.kind !== "sessions") throw new Error("sessions required");
  expect(next.sessions?.map((r) => r.id)).toEqual(["changing"]);
  expect(opens).toBe(2);
});
test("observed-home-disappearance-is-changed-not-initial-missing", async () => {
  const io: CollectorFileSystem = {
    ...nodeCollectorFileSystem,
    async realpath(path) {
      const value = await nodeCollectorFileSystem.realpath(path);
      if (path === home) await rm(home, { recursive: true });
      return value;
    },
  };
  expect(await collectSessions({ homePath: home, io })).toEqual({
    kind: "sessions",
    sessions: null,
    dataWarnings: [{ source: "sessions", code: "FILE_CHANGED" }],
  });
});
test("abort-in-last-session-identity-check-stops-success-and-failure-probes", async () => {
  await session("last");
  for (const fails of [false, true]) {
    const controller = new AbortController();
    let closed = false;
    const afterAbort: string[] = [];
    const probe = (path: string) => {
      if (controller.signal.aborted) afterAbort.push(path);
    };
    const io: CollectorFileSystem = {
      ...nodeCollectorFileSystem,
      async realpath(path) {
        probe(path);
        return nodeCollectorFileSystem.realpath(path);
      },
      async readdir(path) {
        probe(path);
        return nodeCollectorFileSystem.readdir(path);
      },
      async lstat(path) {
        probe(path);
        const value = await nodeCollectorFileSystem.lstat(path);
        if (closed && path === join(home, "sessions/last")) {
          controller.abort();
          if (fails)
            throw Object.assign(new Error("synthetic post-identity failure"), {
              code: "EACCES",
            });
        }
        return value;
      },
      async open(path, flags) {
        probe(path);
        const handle = await nodeCollectorFileSystem.open(path, flags);
        return {
          ...handle,
          async close() {
            await handle.close();
            closed = true;
          },
        };
      },
    };
    expect(
      await collectSessions({ homePath: home, io, signal: controller.signal }),
    ).toEqual({ kind: "aborted" });
    expect(afterAbort).toEqual([]);
  }
});
test("abort-during-last-directory-stat-failure-starts-no-final-probes", async () => {
  await session("last");
  const controller = new AbortController();
  const afterAbort: string[] = [];
  const io: CollectorFileSystem = {
    ...nodeCollectorFileSystem,
    async lstat(path) {
      if (controller.signal.aborted) afterAbort.push(path);
      if (path === join(home, "sessions/last")) {
        controller.abort();
        throw Object.assign(new Error("synthetic directory stat failure"), {
          code: "EACCES",
        });
      }
      return nodeCollectorFileSystem.lstat(path);
    },
  };
  expect(
    await collectSessions({ homePath: home, io, signal: controller.signal }),
  ).toEqual({ kind: "aborted" });
  expect(afterAbort).toEqual([]);
});
