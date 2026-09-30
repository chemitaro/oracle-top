import { expect, test } from "vitest";
import { renderText } from "../src/render/text.js";
import { serializeJson } from "../src/render/json.js";
import {
  displayWidth,
  sanitizeText,
  truncateText,
} from "../src/render/width.js";
import type { DashboardSnapshot } from "../src/model/dashboard.js";
function snapshot(): DashboardSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: "2026-09-30T06:00:00.000Z",
    browserCapacity: {
      active: 2,
      maximum: 3,
      maximumSource: "default",
      utilization: 0.6666666666666666,
    },
    currentSessions: [
      {
        id: "sample",
        status: "running",
        elapsedMs: 120000,
        project: "sample-project",
        slug: "saved-slug",
        model: "gpt-6-astra",
        effort: "high",
      },
    ],
    reliability24h: {
      completed: 24,
      partial: 2,
      error: 4,
      cancelled: 1,
      evaluated: 30,
      successRate: 0.8,
    },
    submittedMessages: [
      { model: "gpt-6-astra", effort: "high", submitted24h: 1, submitted7d: 1 },
    ],
    dataWarnings: [],
  };
}
test("renders-exactly-six-current-columns", () => {
  const text = renderText(snapshot());
  expect(
    text
      .split("\n")
      .find((line) => line.startsWith("STATUS"))
      ?.split(" | ")
      .map((value) => value.trim()),
  ).toEqual([
    "STATUS",
    "ELAPSED",
    "PROJECT",
    "SESSION / SLUG",
    "MODEL",
    "EFFORT",
  ]);
  expect(
    text
      .split("\n")
      .find((line) => line.startsWith("running"))
      ?.split(" | ")
      .map((value) => value.trim()),
  ).toEqual([
    "running",
    "00:02:00",
    "sample-project",
    "saved-slug",
    "gpt-6-astra",
    "high",
  ]);
});
test("distinguishes-unavailable-from-zero-and-empty", () => {
  const value = snapshot();
  value.browserCapacity = {
    active: null,
    maximum: 3,
    maximumSource: "default",
    utilization: null,
  };
  value.currentSessions = null;
  value.reliability24h = null;
  value.submittedMessages = null;
  const unknown = renderText(value);
  expect(unknown).toContain("Browser slots (stored): N/A / 3  N/A");
  expect(unknown).toContain("Current sessions: N/A");
  expect(unknown).toContain("Current sessions unavailable");
  expect(unknown).toContain(
    "completed N/A   partial N/A   error N/A   cancelled N/A   evaluated N/A",
  );
  expect(unknown).toContain("success N/A");
  expect(unknown).toContain("Submitted messages unavailable");
  value.currentSessions = [];
  value.submittedMessages = [];
  value.reliability24h = {
    completed: 0,
    partial: 0,
    error: 0,
    cancelled: 0,
    evaluated: 0,
    successRate: null,
  };
  value.browserCapacity = {
    active: 0,
    maximum: 3,
    maximumSource: "default",
    utilization: 0,
  };
  const empty = renderText(value);
  expect(empty).toContain("0 / 3  0.0%");
  expect(empty).toContain("No current sessions");
  expect(empty).toContain("No submitted messages");
  expect(empty).toContain("evaluated 0");
  expect(empty).toContain("success N/A");
});
test("measures-and-truncates-whole-graphemes-in-cells", () => {
  expect(displayWidth("日本語e\u0301👩‍💻")).toBe(9);
  expect(truncateText("日e\u0301👩‍💻本", 6)).toBe("日e\u0301👩‍💻…");
  expect(truncateText("日e\u0301👩‍💻本", 4)).toBe("日e\u0301…");
  expect(truncateText("日e\u0301", 0)).toBe("");
  expect(truncateText("日本", 1)).toBe("…");
});
test("shrinks-project-and-slug-before-protected-columns", () => {
  const value = snapshot();
  value.currentSessions![0]!.project = "日本語".repeat(30);
  value.currentSessions![0]!.slug = "👩‍💻e\u0301".repeat(30);
  value.currentSessions![0]!.model = "custom-model-protected-name";
  value.currentSessions![0]!.effort = "requested-custom";
  const text = renderText(value, { columns: 120, rows: 50 });
  expect(text).toContain("custom-model-protected-name");
  expect(text).toContain("requested-custom");
  expect(text).not.toContain("日本語".repeat(30));
  expect(text).toContain("…");
  for (const line of text.split("\n"))
    expect(displayWidth(line)).toBeLessThanOrEqual(119);
});
test("renders-five-regions-and-provenance-notes", () => {
  const value = snapshot();
  value.dataWarnings = [
    { source: "session", sessionId: "broken-a", code: "INVALID_JSON" },
    { source: "leases", code: "FILE_MISSING" },
    { source: "config", code: "INVALID_FIELD" },
  ];
  const text = renderText(value);
  for (const label of [
    "ORACLE TOP",
    "CURRENT SESSIONS",
    "RELIABILITY — ROLLING 24 HOURS",
    "SUBMITTED MESSAGES BY MODEL / EFFORT",
    "Oracle-only submission-operation counts; direct ChatGPT usage is excluded.",
    "Requested model/effort. Slots: selected profile; sessions: selected home.",
    "Values from readable records only",
    "session INVALID_JSON broken-a",
    "leases FILE_MISSING",
    "config INVALID_FIELD",
  ])
    expect(text).toContain(label);
  expect(text).toContain("66.7%");
  expect(text).toContain("success 80.0%");
  expect(text).not.toMatch(/failureRate|errorRate|quota|remaining allowance/);
});
test("reports-omitted-rows-per-section", () => {
  const value = snapshot();
  value.currentSessions = Array.from({ length: 10 }, (_, index) => ({
    ...value.currentSessions![0]!,
    id: `id-${index}`,
    slug: `current-${index}`,
  }));
  value.submittedMessages = Array.from({ length: 9 }, (_, index) => ({
    model: `usage-${index}`,
    effort: "high",
    submitted24h: 1,
    submitted7d: 1,
  }));
  const before = JSON.stringify(value);
  const text = renderText(value, { columns: 120, rows: 24 });
  expect(text).toContain("... 7 more; use oracle-top snapshot");
  expect(text).toContain("... 6 more; use oracle-top snapshot");
  for (const name of [
    "current-0",
    "current-1",
    "current-2",
    "usage-0",
    "usage-1",
    "usage-2",
  ])
    expect(text).toContain(name);
  expect(text).not.toContain("current-3");
  expect(text).not.toContain("usage-3");
  expect(text.split("\n")).toHaveLength(23);
  expect(JSON.stringify(value)).toBe(before);
  const full = renderText(value);
  for (const name of ["current-9", "usage-8"]) expect(full).toContain(name);
  expect(full).not.toContain("more; use");
});
test("neutralizes-text-controls-without-changing-snapshot", () => {
  for (const code of [
    0, 9, 10, 13, 27, 31, 127, 128, 133, 155, 159, 0x2028, 0x2029, 0x061c,
    0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067,
    0x2068, 0x2069,
  ])
    expect(sanitizeText(`left${String.fromCharCode(code)}right`)).toBe(
      "left right",
    );
  const value = snapshot();
  value.currentSessions![0]!.slug = "before\u001b]0;title\u0007\r\n\tafter";
  value.currentSessions![0]!.model = "gpt-\u009bmodel\u2066name";
  value.dataWarnings = [
    { source: "session", sessionId: "bad\u001bid", code: "DISPLAY_SANITIZED" },
  ];
  const before = JSON.stringify(value);
  const text = renderText(value);
  expect(text).toContain("before ]0;title    after");
  expect(text).toContain("gpt- model name");
  expect(text).toContain("bad id");
  expect(text).not.toMatch(
    /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u,
  );
  expect(JSON.stringify(value)).toBe(before);
});
test("serializes-safe-json-with-full-value-round-trip", () => {
  const value = snapshot();
  value.currentSessions![0]!.model =
    "custom\u0085\u009b\u007f\u061c\u200e\u202e\u2066\u2028\u2029\u001bname";
  value.dataWarnings = [
    { source: "session", sessionId: "sample", code: "DISPLAY_SANITIZED" },
  ];
  value.currentSessions = Array.from({ length: 10 }, (_, index) => ({
    ...value.currentSessions![0]!,
    id: `id-${index}`,
  }));
  value.submittedMessages = Array.from({ length: 9 }, (_, index) => ({
    model: `custom-${index}`,
    effort: "High",
    submitted24h: 1,
    submitted7d: 1,
  }));
  const text = serializeJson(value);
  expect(JSON.parse(text)).toEqual(value);
  expect(text).toContain("\\u0085");
  expect(text).toContain("\\u202e");
  expect(text).not.toMatch(
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u,
  );
});
test("wraps-fixed-lines-without-hiding-safe-integer-values", () => {
  const value = snapshot();
  value.browserCapacity = {
    active: 9007199254740991,
    maximum: 9007199254740991,
    maximumSource: "default",
    utilization: 1,
  };
  value.reliability24h = {
    completed: 9007199254740989,
    partial: 1,
    error: 1,
    cancelled: 9007199254740991,
    evaluated: 9007199254740991,
    successRate: 0.9999999999999998,
  };
  value.submittedMessages![0]!.submitted24h = 9007199254740991;
  value.submittedMessages![0]!.submitted7d = 9007199254740991;
  const text = renderText(value, { columns: 80, rows: 40 });
  for (const line of text.split("\n"))
    expect(displayWidth(line)).toBeLessThanOrEqual(79);
  const joined = text.replace(/\n/g, " ");
  for (const label of [
    "completed 9007199254740989",
    "cancelled 9007199254740991",
    "evaluated 9007199254740991",
  ])
    expect(joined).toContain(label);
  expect(text).toContain("100.0%");
});
test("shows-generated-clock-in-os-local-time-with-offset", () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = "UTC";
    expect(renderText(snapshot()).split("\n")[0]).toBe(
      "ORACLE TOP   2026-09-30 06:00:00 GMT+00:00",
    );
    process.env.TZ = "Asia/Tokyo";
    expect(renderText(snapshot()).split("\n")[0]).toBe(
      "ORACLE TOP   2026-09-30 15:00:00 GMT+09:00",
    );
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
test("computes-required-width-from-protected-values-before-omission", () => {
  const value = snapshot();
  value.currentSessions!.push({
    ...value.currentSessions![0]!,
    id: "hidden",
    slug: "hidden",
    model: "M".repeat(100),
  });
  expect(renderText(value, { columns: 120, rows: 19 })).toBe(
    "Terminal too narrow: need 139 columns. Use oracle-top snapshot.",
  );
  const fitting = renderText(value, { columns: 139, rows: 30 });
  expect(fitting).toContain("M".repeat(100));
  for (const line of fitting.split("\n"))
    expect(displayWidth(line)).toBeLessThanOrEqual(138);
  value.currentSessions = snapshot().currentSessions;
  value.submittedMessages!.push({
    model: "U".repeat(120),
    effort: "high",
    submitted24h: 1,
    submitted7d: 1,
  });
  expect(renderText(value, { columns: 120, rows: 19 })).toBe(
    "Terminal too narrow: need 141 columns. Use oracle-top snapshot.",
  );
});
test("uses-size-messages-and-reserves-last-row-and-column", () => {
  const value = snapshot();
  for (const columns of [0, 1])
    expect(renderText(value, { columns, rows: 24 })).toBe("");
  expect(renderText(value, { columns: 2, rows: 24 })).toBe("!");
  expect(renderText(value, { columns: 79, rows: 24 })).toBe(
    "Terminal too narrow: need 80 columns. Use oracle-top snapshot.",
  );
  for (const rows of [0, 1])
    expect(renderText(value, { columns: 120, rows })).toBe("");
  expect(renderText(value, { columns: 120, rows: 17 })).toBe(
    "Terminal too short: need 18 rows. Use oracle-top snapshot.",
  );
  expect(
    renderText(value, { columns: 120, rows: 18 }).split("\n"),
  ).toHaveLength(17);
});
test("gives-odd-body-row-to-current-and-redistributes-unused-space", () => {
  const value = snapshot();
  value.currentSessions = Array.from({ length: 10 }, (_, i) => ({
    ...value.currentSessions![0]!,
    id: `current-${i}`,
    slug: `current-${i}`,
  }));
  value.submittedMessages = Array.from({ length: 9 }, (_, i) => ({
    model: `usage-${i}`,
    effort: "high",
    submitted24h: 1,
    submitted7d: 1,
  }));
  const odd = renderText(value, { columns: 120, rows: 25 });
  expect(odd).toContain("current-3");
  expect(odd).not.toContain("current-4");
  expect(odd).toContain("... 6 more; use oracle-top snapshot");
  expect(odd).toContain("usage-2");
  expect(odd).not.toContain("usage-3");
  value.submittedMessages = [];
  const current = renderText(value, { columns: 120, rows: 24 });
  expect(current).toContain("current-5");
  expect(current).not.toContain("current-6");
  expect(current).toContain("... 4 more; use oracle-top snapshot");
  expect(current).toContain("No submitted messages");
  value.currentSessions = [];
  value.submittedMessages = Array.from({ length: 9 }, (_, i) => ({
    model: `usage-${i}`,
    effort: "high",
    submitted24h: 1,
    submitted7d: 1,
  }));
  const usage = renderText(value, { columns: 120, rows: 24 });
  expect(usage).toContain("usage-5");
  expect(usage).not.toContain("usage-6");
  expect(usage).toContain("... 3 more; use oracle-top snapshot");
  expect(usage).toContain("No current sessions");
});
test("limits-tui-warning-summary-to-two-lines-and-full-text-keeps-all", () => {
  const value = snapshot();
  value.currentSessions = Array.from({ length: 10 }, (_, i) => ({
    ...value.currentSessions![0]!,
    id: `id-${i}`,
    slug: `current-${i}`,
  }));
  value.submittedMessages = Array.from({ length: 9 }, (_, i) => ({
    model: `usage-${i}`,
    effort: "high",
    submitted24h: 1,
    submitted7d: 1,
  }));
  value.dataWarnings = Array.from({ length: 5 }, (_, i) => ({
    source: "session",
    code: "INVALID_JSON",
    sessionId: `warning-${i}`,
  }));
  const viewport = renderText(value, { columns: 120, rows: 26 });
  expect(viewport).toContain("Warnings (5): use oracle-top snapshot");
  expect(viewport).toContain("Values from readable records only");
  expect(viewport).toContain("... 7 more; use oracle-top snapshot");
  expect(viewport).toContain("... 6 more; use oracle-top snapshot");
  expect(viewport.split("\n")).toHaveLength(25);
  const full = renderText(value);
  for (const id of [
    "warning-0",
    "warning-1",
    "warning-2",
    "warning-3",
    "warning-4",
  ])
    expect(full).toContain(id);
});
test("keeps-hours-above-day-and-formats-unclamped-percent-to-one-decimal", () => {
  const value = snapshot();
  value.currentSessions![0]!.elapsedMs = 93600000;
  value.browserCapacity = {
    active: 4,
    maximum: 3,
    maximumSource: "default",
    utilization: 1.3333333333333333,
  };
  expect(renderText(value)).toContain("26:00:00");
  expect(renderText(value)).toContain("4 / 3  133.3%");
  expect(JSON.parse(serializeJson(value)).browserCapacity.utilization).toBe(
    1.3333333333333333,
  );
});
