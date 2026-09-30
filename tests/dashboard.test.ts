import { normalizeSession } from "../src/model/normalize.js";
import { expect, test } from "vitest";
import { buildDashboard } from "../src/aggregate.js";
import type { DashboardInputs } from "../src/io/sessions.js";
import type { NormalizedSession } from "../src/model/session.js";
const now = 1790748000000;
function row(
  id: string,
  extra: Partial<NormalizedSession> = {},
): NormalizedSession {
  return {
    id,
    status: "running",
    project: "project",
    slug: id,
    model: "gpt-6-astra",
    effort: "high",
    startTimeMs: 1790747880000,
    reliabilityTimeMs: 1790747880000,
    submittedCount: 0,
    profilePath: "/selected/profile",
    maximum: 3,
    ...extra,
  };
}
function inputs(sessions: NormalizedSession[] | null): DashboardInputs {
  return {
    sessions,
    active: 0,
    selectedProfileRealPath: "/selected/real",
    config: {
      homePath: "/store",
      sessionsPath: "/store/sessions",
      profilePath: "/selected/profile",
      intervalMs: 2000,
      fallbackMaximum: 3,
      fallbackMaximumSource: "default",
    },
    dataWarnings: [],
  };
}
test("orders-current-by-elapsed-null-last-and-utf16-id", () => {
  const snapshot = buildDashboard(
    inputs([
      row("old", { startTimeMs: 1790056800000 }),
      row("unknown", { startTimeMs: null }),
      row("z"),
      row("A"),
      row("😀"),
      row("\ue000"),
      row("done", { status: "completed" }),
      row("pending", { status: "pending", startTimeMs: 1790748000000 }),
    ]),
    now,
  );
  expect(
    snapshot.currentSessions?.map(({ id, elapsedMs }) => ({ id, elapsedMs })),
  ).toEqual([
    { id: "pending", elapsedMs: 0 },
    { id: "A", elapsedMs: 120000 },
    { id: "z", elapsedMs: 120000 },
    { id: "😀", elapsedMs: 120000 },
    { id: "\ue000", elapsedMs: 120000 },
    { id: "old", elapsedMs: 691200000 },
    { id: "unknown", elapsedMs: null },
  ]);
});
test("counts-reliability-with-cancelled-outside-denominator", () => {
  const sessions = [
    ...Array.from({ length: 24 }, (_, i) =>
      row(`completed-${i}`, { status: "completed" }),
    ),
    row("partial-a", { status: "partial" }),
    row("partial-b", { status: "partial" }),
    ...Array.from({ length: 4 }, (_, i) =>
      row(`error-${i}`, { status: "error" }),
    ),
    row("cancelled", { status: "cancelled" }),
    row("running"),
    row("unknown", { status: "new-status" }),
  ];
  expect(buildDashboard(inputs(sessions), now).reliability24h).toEqual({
    completed: 24,
    partial: 2,
    error: 4,
    cancelled: 1,
    evaluated: 30,
    successRate: 0.8,
  });
});
test("counts-inclusive-submission-windows-and-excludes-future", () => {
  const sessions = [
    row("now", { startTimeMs: 1790748000000, submittedCount: 1 }),
    row("24h", { startTimeMs: 1790661600000, submittedCount: 2 }),
    row("24h-minus-one", { startTimeMs: 1790661599999, submittedCount: 3 }),
    row("7d", { startTimeMs: 1790143200000, submittedCount: 4 }),
    row("7d-minus-one", { startTimeMs: 1790143199999, submittedCount: 5 }),
    row("future", { startTimeMs: 1790748000001, submittedCount: 6 }),
    row("unknown", { startTimeMs: null, submittedCount: 7 }),
  ];
  expect(buildDashboard(inputs(sessions), now).submittedMessages).toEqual([
    { model: "gpt-6-astra", effort: "high", submitted24h: 3, submitted7d: 10 },
  ]);
});
test("counts-submitted-completed-followups", () => {
  const normalized = normalizeSession(
    {
      mode: "browser",
      model: "gpt-6-astra",
      status: "completed",
      startedAt: "2026-09-30T05:00:00.000Z",
      browser: { runtime: { promptSubmitted: true } },
      options: {
        browserFollowUps: ["same synthetic text", "same synthetic text"],
      },
    },
    "followup",
  );
  if (normalized.kind !== "session") throw new Error("session required");
  expect(
    buildDashboard(inputs([normalized.session]), now).submittedMessages,
  ).toEqual([
    {
      model: "gpt-6-astra",
      effort: "unknown",
      submitted24h: 3,
      submitted7d: 3,
    },
  ]);
});
test("orders-model-effort-with-fixed-priorities-and-utf16", () => {
  const sessions = [
    row("other", { model: "A-model", effort: "pro", submittedCount: 1 }),
    row("sol", { model: "gpt-5.6-sol", effort: "pro", submittedCount: 1 }),
    ...[
      "High",
      "unknown",
      "light",
      "standard",
      "high",
      "extended",
      "extra-high",
      "heavy",
      "pro",
      "😀",
      "\ue000",
    ].map((effort, i) => row(`astra-${i}`, { effort, submittedCount: 1 })),
    row("zero", { model: "absent", submittedCount: 0 }),
    row("old", { model: "old", startTimeMs: 1790143199999, submittedCount: 1 }),
  ];
  expect(
    buildDashboard(inputs(sessions), now).submittedMessages?.map((r) => [
      r.model,
      r.effort,
    ]),
  ).toEqual([
    ["gpt-6-astra", "pro"],
    ["gpt-6-astra", "heavy"],
    ["gpt-6-astra", "extra-high"],
    ["gpt-6-astra", "extended"],
    ["gpt-6-astra", "high"],
    ["gpt-6-astra", "standard"],
    ["gpt-6-astra", "light"],
    ["gpt-6-astra", "unknown"],
    ["gpt-6-astra", "High"],
    ["gpt-6-astra", "😀"],
    ["gpt-6-astra", "\ue000"],
    ["gpt-5.6-sol", "pro"],
    ["A-model", "pro"],
  ]);
});
test("selects-maximum-only-from-same-profile-current", () => {
  const snapshot = buildDashboard(
    inputs([
      row("other", {
        profilePath: "/other/profile",
        maximum: 9,
        startTimeMs: 1790748000000,
      }),
      row("selected", { maximum: 3 }),
      row("terminal", { status: "completed", maximum: 8 }),
    ]),
    now,
  );
  expect(snapshot.browserCapacity).toEqual({
    active: 0,
    maximum: 3,
    maximumSource: "session",
    utilization: 0,
  });
  expect(snapshot.currentSessions?.map((r) => r.id)).toEqual([
    "other",
    "selected",
  ]);
  expect(snapshot.dataWarnings).toEqual([
    { source: "session", sessionId: "other", code: "PROFILE_DIFFERENT" },
  ]);
});
test("future-and-unavailable-time-stay-null-with-safe-warnings", () => {
  const snapshot = buildDashboard(
    inputs([
      row("future", { startTimeMs: 1790748000001, submittedCount: 1 }),
      row("unknown", { startTimeMs: null, submittedCount: 1 }),
      row("terminal-future", {
        status: "completed",
        reliabilityTimeMs: 1790748000001,
      }),
      row("terminal-unknown", { status: "error", reliabilityTimeMs: null }),
    ]),
    now,
  );
  expect(snapshot.currentSessions?.map((r) => [r.id, r.elapsedMs])).toEqual([
    ["future", null],
    ["unknown", null],
  ]);
  expect(snapshot.submittedMessages).toEqual([]);
  expect(snapshot.reliability24h).toEqual({
    completed: 0,
    partial: 0,
    error: 0,
    cancelled: 0,
    evaluated: 0,
    successRate: null,
  });
  expect(snapshot.dataWarnings).toEqual([
    { source: "session", sessionId: "future", code: "TIME_FUTURE" },
    { source: "session", sessionId: "terminal-future", code: "TIME_FUTURE" },
    {
      source: "session",
      sessionId: "terminal-unknown",
      code: "TIME_UNAVAILABLE",
    },
    { source: "session", sessionId: "unknown", code: "TIME_UNAVAILABLE" },
  ]);
});
test("latest-valid-same-profile-max-wins-with-conflict", () => {
  const snapshot = buildDashboard(
    inputs([
      row("old", { maximum: 3, startTimeMs: 1790747880000 }),
      row("new", { maximum: 2, startTimeMs: 1790747940000 }),
      row("future", { maximum: 9, startTimeMs: 1790748000001 }),
      row("unknown", { maximum: 8, startTimeMs: null }),
    ]),
    now,
  );
  expect(snapshot.browserCapacity.maximum).toBe(2);
  expect(snapshot.dataWarnings).toContainEqual({
    source: "session",
    sessionId: "old",
    code: "CAPACITY_CONFLICT",
  });
});
test("deduplicates-and-sorts-warning-tuples-by-utf16", () => {
  const value = inputs([
    row("😀", { startTimeMs: null }),
    row("\ue000", { startTimeMs: null }),
  ]);
  value.dataWarnings = [
    { source: "sessions", code: "SESSIONS_UNREADABLE" },
    { source: "session", sessionId: "😀", code: "TIME_UNAVAILABLE" },
    { source: "leases", code: "FILE_MISSING" },
    { source: "config", code: "INVALID_FIELD" },
    { source: "config", code: "FILE_MISSING" },
    { source: "leases", code: "FILE_MISSING" },
  ];
  expect(buildDashboard(value, now).dataWarnings).toEqual([
    { source: "config", code: "FILE_MISSING" },
    { source: "config", code: "INVALID_FIELD" },
    { source: "leases", code: "FILE_MISSING" },
    { source: "session", sessionId: "😀", code: "TIME_UNAVAILABLE" },
    { source: "session", sessionId: "\ue000", code: "TIME_UNAVAILABLE" },
    { source: "sessions", code: "SESSIONS_UNREADABLE" },
  ]);
});
test("normal-empty-and-unavailable-have-distinct-session-regions", () => {
  const empty = buildDashboard(inputs([]), now);
  expect([
    empty.currentSessions,
    empty.reliability24h,
    empty.submittedMessages,
  ]).toEqual([
    [],
    {
      completed: 0,
      partial: 0,
      error: 0,
      cancelled: 0,
      evaluated: 0,
      successRate: null,
    },
    [],
  ]);
  const unavailable = buildDashboard(inputs(null), now);
  expect([
    unavailable.currentSessions,
    unavailable.reliability24h,
    unavailable.submittedMessages,
  ]).toEqual([null, null, null]);
  expect(empty.generatedAt).toBe("2026-09-30T06:00:00.000Z");
});
test("reliability-uses-independent-inclusive-completion-window", () => {
  expect(
    buildDashboard(
      inputs([
        row("lower", {
          status: "completed",
          reliabilityTimeMs: 1790661600000,
          startTimeMs: 1790143199999,
        }),
        row("upper", { status: "error", reliabilityTimeMs: 1790748000000 }),
        row("minus-one", {
          status: "partial",
          reliabilityTimeMs: 1790661599999,
        }),
        row("future", {
          status: "cancelled",
          reliabilityTimeMs: 1790748000001,
        }),
      ]),
      now,
    ).reliability24h,
  ).toEqual({
    completed: 1,
    partial: 0,
    error: 1,
    cancelled: 0,
    evaluated: 2,
    successRate: 0.5,
  });
});
test("unknown-profile-max-falls-back-without-clamping-utilization", () => {
  const normalized = normalizeSession(
    {
      mode: "browser",
      model: "gpt-6-astra",
      status: "running",
      startedAt: "2026-09-30T05:00:00Z",
      options: {
        browserConfig: {
          manualLoginProfileDir: "/selected/profile",
          maxConcurrentTabs: 9,
        },
      },
    },
    "unknown",
  );
  if (normalized.kind !== "session") throw new Error("session required");
  const value = inputs([normalized.session]);
  value.active = 4;
  value.config.fallbackMaximum = 4;
  value.config.fallbackMaximumSource = "environment";
  value.dataWarnings = normalized.dataWarnings;
  expect(buildDashboard(value, now).browserCapacity).toEqual({
    active: 4,
    maximum: 4,
    maximumSource: "environment",
    utilization: 1,
  });
  value.config.fallbackMaximum = 3;
  value.config.fallbackMaximumSource = "default";
  expect(buildDashboard(value, now).browserCapacity).toEqual({
    active: 4,
    maximum: 3,
    maximumSource: "default",
    utilization: 1.3333333333333333,
  });
  value.active = null;
  expect(buildDashboard(value, now).browserCapacity.utilization).toBeNull();
});
test("maximum-ties-use-id-and-unknown-times-follow-valid-starts", () => {
  expect(
    buildDashboard(
      inputs([
        row("z", { maximum: 7 }),
        row("A", { maximum: 2 }),
        row("unknown", { startTimeMs: null, maximum: 9 }),
      ]),
      now,
    ).browserCapacity.maximum,
  ).toBe(2);
  expect(
    buildDashboard(
      inputs([
        row("z", { startTimeMs: null, maximum: 7 }),
        row("A", { startTimeMs: 1790748000001, maximum: 2 }),
      ]),
      now,
    ).browserCapacity.maximum,
  ).toBe(2);
  expect(
    buildDashboard(
      inputs([row("realpath", { profilePath: "/selected/real", maximum: 5 })]),
      now,
    ).browserCapacity.maximum,
  ).toBe(5);
});
test("valid-future-start-never-falls-back-to-past-created", () => {
  const result = normalizeSession(
    {
      mode: "browser",
      model: "gpt-6-astra",
      status: "running",
      startedAt: "2026-09-30T06:00:00.001Z",
      createdAt: "2026-09-30T05:00:00Z",
      cwd: "/project",
      browser: { runtime: { promptSubmitted: true } },
      options: {
        browserConfig: {
          manualLoginProfileDir: "/selected/profile",
          maxConcurrentTabs: 3,
        },
      },
    },
    "future",
  );
  if (result.kind !== "session") throw new Error("session required");
  const value = inputs([result.session]);
  value.dataWarnings = result.dataWarnings;
  const snapshot = buildDashboard(value, now);
  expect(snapshot.currentSessions?.map((r) => [r.id, r.elapsedMs])).toEqual([
    ["future", null],
  ]);
  expect(snapshot.submittedMessages).toEqual([]);
  expect(snapshot.dataWarnings).toEqual([
    { source: "session", sessionId: "future", code: "TIME_FUTURE" },
  ]);
});
test("invalid-followups-preserve-initial-only-and-do-not-count-subsets", () => {
  for (const browserFollowUps of [["synthetic", ""], ["synthetic", 1], null]) {
    const result = normalizeSession(
      {
        mode: "browser",
        model: "gpt-6-astra",
        status: "completed",
        startedAt: "2026-09-30T05:00:00Z",
        completedAt: "2026-09-30T05:59:00Z",
        browser: { runtime: { promptSubmitted: true } },
        options: { browserFollowUps },
      },
      "bad-followup",
    );
    if (result.kind !== "session") throw new Error("session required");
    const value = inputs([result.session]);
    value.dataWarnings = result.dataWarnings;
    expect(buildDashboard(value, now).submittedMessages).toEqual([
      {
        model: "gpt-6-astra",
        effort: "unknown",
        submitted24h: 1,
        submitted7d: 1,
      },
    ]);
    expect(buildDashboard(value, now).dataWarnings).toEqual([
      {
        source: "session",
        sessionId: "bad-followup",
        code: "FOLLOWUPS_INVALID",
      },
    ]);
  }
});
