import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parseIsoTimestamp } from "../src/model/time.js";
import { serializeJson } from "../src/render/json.js";
import { buildDashboard } from "../src/aggregate.js";
import type { NormalizedSession } from "../src/model/session.js";
const schema = JSON.parse(
  readFileSync(
    new URL("../docs/spec/dashboard.schema.json", import.meta.url),
    "utf8",
  ),
);
const example = JSON.parse(
  readFileSync(
    new URL("../docs/spec/snapshot-example.json", import.meta.url),
    "utf8",
  ),
);
const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addFormat("date-time", {
  type: "string",
  validate: (value: string) => parseIsoTimestamp(value) !== null,
});
const validate = ajv.compile(schema);
test("validates-canonical-snapshot-example", () => {
  expect(validate(JSON.parse(serializeJson(example)))).toBe(true);
});
test("rejects-extra-properties-at-every-output-object", () => {
  const values = [
    { ...structuredClone(example), extra: true },
    (() => {
      const v = structuredClone(example);
      v.browserCapacity.extra = true;
      return v;
    })(),
    (() => {
      const v = structuredClone(example);
      v.currentSessions[0].extra = true;
      return v;
    })(),
    (() => {
      const v = structuredClone(example);
      v.reliability24h.extra = true;
      return v;
    })(),
    (() => {
      const v = structuredClone(example);
      v.submittedMessages[0].extra = true;
      return v;
    })(),
    (() => {
      const v = structuredClone(example);
      v.dataWarnings = [
        {
          source: "session",
          code: "INVALID_JSON",
          sessionId: "sample",
          extra: true,
        },
      ];
      return v;
    })(),
  ];
  for (const value of values) expect(validate(value)).toBe(false);
});
test("rejects-invalid-numeric-boundaries-and-null-ratios", () => {
  for (const mutate of [
    (v: typeof example) => {
      v.currentSessions[0].elapsedMs = -1;
    },
    (v: typeof example) => {
      v.reliability24h.completed = 1.5;
    },
    (v: typeof example) => {
      v.submittedMessages[0].submitted24h = 9007199254740992;
    },
    (v: typeof example) => {
      v.submittedMessages[0].submitted7d = 0;
    },
    (v: typeof example) => {
      v.browserCapacity.maximum = 0;
    },
    (v: typeof example) => {
      v.browserCapacity.active = -1;
    },
    (v: typeof example) => {
      v.browserCapacity.utilization = -0.1;
    },
    (v: typeof example) => {
      v.browserCapacity.active = null;
      v.browserCapacity.utilization = 0;
    },
    (v: typeof example) => {
      v.browserCapacity.utilization = null;
    },
    (v: typeof example) => {
      v.reliability24h.evaluated = 0;
      v.reliability24h.successRate = 0;
    },
    (v: typeof example) => {
      v.reliability24h.successRate = null;
    },
    (v: typeof example) => {
      v.reliability24h.successRate = 1.1;
    },
  ]) {
    const value = structuredClone(example);
    mutate(value);
    expect(validate(value)).toBe(false);
  }
});
test("requires-three-session-regions-to-be-all-null-or-all-normal", () => {
  for (const keys of [
    ["currentSessions"],
    ["reliability24h"],
    ["submittedMessages"],
    ["currentSessions", "reliability24h"],
    ["currentSessions", "submittedMessages"],
    ["reliability24h", "submittedMessages"],
  ]) {
    const value = structuredClone(example);
    for (const key of keys) value[key] = null;
    expect(validate(value)).toBe(false);
  }
  const all = structuredClone(example);
  all.currentSessions = null;
  all.reliability24h = null;
  all.submittedMessages = null;
  expect(validate(all)).toBe(true);
});
test("rejects-unknown-warning-code-source-and-invalid-session-id-union", () => {
  for (const warning of [
    { source: "session", code: "CUSTOM_STATUS", sessionId: "sample" },
    { source: "network", code: "FILE_MISSING" },
    { source: "session", code: "INVALID_JSON" },
    { source: "session", code: "INVALID_JSON", sessionId: "" },
    { source: "leases", code: "FILE_MISSING", sessionId: "sample" },
  ]) {
    const value = structuredClone(example);
    value.dataWarnings = [warning];
    expect(validate(value)).toBe(false);
  }
});
test("requires-strict-utc-generated-time-and-nonempty-free-saved-names", () => {
  for (const time of [
    "2026-02-30T06:00:00.000Z",
    "0000-01-01T00:00:00.000Z",
    "2026-09-30T06:00:00Z",
    "2026-09-30T15:00:00.000+09:00",
    "2026-09-30T24:00:00.000Z",
  ]) {
    const value = structuredClone(example);
    value.generatedAt = time;
    expect(validate(value)).toBe(false);
  }
  for (const field of ["model", "effort"]) {
    const value = structuredClone(example);
    value.submittedMessages[0][field] = "";
    expect(validate(value)).toBe(false);
  }
  const value = structuredClone(example);
  value.generatedAt = "0001-01-01T00:00:00.000Z";
  value.currentSessions[0].model = "Custom Saved Alias";
  value.currentSessions[0].effort = "High";
  expect(validate(value)).toBe(true);
});
function normalized(
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
    profilePath: "/selected",
    maximum: 3,
    ...extra,
  };
}
test("validates-built-dashboard-with-literal-algebra-unique-rows-and-order", () => {
  const value = buildDashboard(
    {
      config: {
        homePath: "/store",
        sessionsPath: "/store/sessions",
        profilePath: "/selected",
        intervalMs: 2000,
        fallbackMaximum: 3,
        fallbackMaximumSource: "default",
      },
      active: 4,
      selectedProfileRealPath: "/selected",
      dataWarnings: [],
      sessions: [
        normalized("b", { submittedCount: 2 }),
        normalized("a", { submittedCount: 1, startTimeMs: 1790748000000 }),
        normalized("d", {
          model: "custom",
          effort: "High",
          submittedCount: 4,
          startTimeMs: 1790747940000,
        }),
        normalized("complete-a", { status: "completed", submittedCount: 3 }),
        normalized("complete-b", { status: "completed", submittedCount: 1 }),
        normalized("error", { status: "error" }),
        normalized("cancelled", { status: "cancelled" }),
      ],
    },
    1790748000000,
  );
  expect(validate(JSON.parse(serializeJson(value)))).toBe(true);
  expect(value.browserCapacity).toEqual({
    active: 4,
    maximum: 3,
    maximumSource: "session",
    utilization: 1.3333333333333333,
  });
  expect(value.reliability24h).toEqual({
    completed: 2,
    partial: 0,
    error: 1,
    cancelled: 1,
    evaluated: 3,
    successRate: 0.6666666666666666,
  });
  expect(value.currentSessions?.map((row) => row.id)).toEqual(["a", "d", "b"]);
  expect(value.submittedMessages).toEqual([
    { model: "gpt-6-astra", effort: "high", submitted24h: 7, submitted7d: 7 },
    { model: "custom", effort: "High", submitted24h: 4, submitted7d: 4 },
  ]);
});
test("requires-output-fields-in-root-and-nested-records", () => {
  for (const mutate of [
    (v: typeof example) => {
      delete v.generatedAt;
    },
    (v: typeof example) => {
      delete v.browserCapacity.maximumSource;
    },
    (v: typeof example) => {
      delete v.currentSessions[0].effort;
    },
    (v: typeof example) => {
      delete v.reliability24h.cancelled;
    },
    (v: typeof example) => {
      delete v.submittedMessages[0].submitted7d;
    },
    (v: typeof example) => {
      v.dataWarnings = [{ source: "leases" }];
    },
  ]) {
    const value = structuredClone(example);
    mutate(value);
    expect(validate(value)).toBe(false);
  }
});
