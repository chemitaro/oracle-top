import { expect, test } from "vitest";
import { normalizeSession } from "../src/model/normalize.js";

function sample(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sample",
    mode: "browser",
    model: "gpt-6-astra",
    status: "running",
    cwd: "/workspace/sample-project",
    options: {
      slug: "saved-slug",
      browserConfig: {
        thinkingTime: "high",
        manualLoginProfileDir: "/workspace/profile",
        maxConcurrentTabs: 3,
      },
    },
    ...extra,
  };
}

test("normalizes-browser-gpt-session", () => {
  expect(normalizeSession(sample(), "sample")).toMatchObject({
    kind: "session",
    session: {
      id: "sample",
      status: "running",
      project: "sample-project",
      slug: "saved-slug",
      model: "gpt-6-astra",
      effort: "high",
    },
  });
});

test("excludes-api-despite-browser-remnants", () => {
  expect(
    normalizeSession(
      sample({
        mode: "api",
        browser: { runtime: { tabUrl: "https://chatgpt.com/c/example" } },
      }),
      "sample",
    ),
  ).toEqual({ kind: "excluded", dataWarnings: [] });
});

test("excludes-gemini-models", () => {
  for (const model of ["gemini-3", "Google/Gemini-next"]) {
    expect(normalizeSession(sample({ model }), "sample")).toEqual({
      kind: "excluded",
      dataWarnings: [],
    });
  }
});

test("rejects-unknown-model-without-provider-evidence", () => {
  expect(normalizeSession(sample({ model: "custom-model" }), "sample")).toEqual(
    {
      kind: "excluded",
      dataWarnings: [
        { code: "PROVIDER_UNRESOLVED", source: "session", sessionId: "sample" },
      ],
    },
  );
});

test("includes-unknown-model-with-chatgpt-url", () => {
  expect(
    normalizeSession(
      sample({
        model: " custom-model ",
        browser: { runtime: { tabUrl: "https://chatgpt.com/c/example" } },
      }),
      "sample",
    ),
  ).toMatchObject({ kind: "session", session: { model: "custom-model" } });
});

test("excludes-conflicting-provider-evidence", () => {
  expect(
    normalizeSession(
      sample({ browser: { config: { url: "https://gemini.google.com/app" } } }),
      "sample",
    ),
  ).toEqual({
    kind: "excluded",
    dataWarnings: [
      { code: "PROVIDER_CONFLICT", source: "session", sessionId: "sample" },
    ],
  });
});

test("does-not-infer-browser-mode", () => {
  expect(
    normalizeSession(
      sample({
        mode: undefined,
        browser: { runtime: { tabUrl: "https://chatgpt.com/c/example" } },
      }),
      "sample",
    ),
  ).toEqual({
    kind: "excluded",
    dataWarnings: [
      { code: "MODE_UNRESOLVED", source: "session", sessionId: "sample" },
    ],
  });
});

test("excludes-conflicting-known-modes", () => {
  expect(
    normalizeSession(sample({ options: { mode: "api" } }), "sample"),
  ).toEqual({
    kind: "excluded",
    dataWarnings: [
      { code: "MODE_CONFLICT", source: "session", sessionId: "sample" },
    ],
  });
});

test("preserves-unrecognized-status", () => {
  expect(
    normalizeSession(sample({ status: " saved-new-status " }), "sample"),
  ).toMatchObject({
    kind: "session",
    session: { status: "saved-new-status" },
    dataWarnings: [
      { code: "STATUS_UNRECOGNIZED", source: "session", sessionId: "sample" },
    ],
  });
});

test("resolves-independent-time-fallbacks", () => {
  expect(
    normalizeSession(
      sample({
        status: "completed",
        startedAt: "2026-02-30T00:00:00Z",
        createdAt: "2026-09-30T05:00:00Z",
        completedAt: "2026-09-30T06:00:00Z",
        browser: { runtime: { promptSubmitted: false } },
      }),
      "sample",
    ),
  ).toMatchObject({
    kind: "session",
    session: { startTimeMs: 1790744400000, reliabilityTimeMs: 1790748000000 },
    dataWarnings: [
      { code: "TIME_INVALID", source: "session", sessionId: "sample" },
    ],
  });
});

test("preserves-valid-future-time-without-fallback", () => {
  expect(
    normalizeSession(
      sample({
        status: "completed",
        startedAt: "2099-01-01T00:00:00Z",
        createdAt: "2026-09-30T06:00:00Z",
        browser: { runtime: { promptSubmitted: false } },
      }),
      "sample",
    ),
  ).toMatchObject({
    kind: "session",
    session: { startTimeMs: 4070908800000, reliabilityTimeMs: 1790748000000 },
    dataWarnings: [],
  });
});

test("counts-first-submission-only-for-boolean-true", () => {
  expect(
    normalizeSession(
      sample({
        status: "saved-new-status",
        browser: { runtime: { promptSubmitted: true } },
      }),
      "sample",
    ),
  ).toMatchObject({ kind: "session", session: { submittedCount: 1 } });
});

test("excludes-gemini-prefix-even-with-slash", () => {
  expect(
    normalizeSession(sample({ model: "Gemini/experimental" }), "sample"),
  ).toEqual({ kind: "excluded", dataWarnings: [] });
});

test("counts-completed-followups-without-retaining-prompts", () => {
  const result = normalizeSession(
    sample({
      status: "completed",
      browser: { runtime: { promptSubmitted: true } },
      options: { browserFollowUps: ["repeat", "repeat"] },
    }),
    "sample",
  );
  expect(result).toMatchObject({
    kind: "session",
    session: { submittedCount: 3 },
  });
  expect(JSON.stringify(result)).not.toContain("repeat");
});

test("rejects-entire-incomplete-followup-array", () => {
  for (const browserFollowUps of [["a", ""], ["a", 1], null]) {
    expect(
      normalizeSession(
        sample({
          status: "completed",
          browser: { runtime: { promptSubmitted: true } },
          options: { browserFollowUps },
        }),
        "sample",
      ),
    ).toMatchObject({
      kind: "session",
      session: { submittedCount: 1 },
      dataWarnings: [
        { code: "FOLLOWUPS_INVALID", source: "session", sessionId: "sample" },
      ],
    });
  }
});

test("reads-followups-from-options", () => {
  expect(
    normalizeSession(
      sample({
        status: "completed",
        browser: { runtime: { promptSubmitted: true } },
        options: { browserFollowUps: ["first", "first"] },
        browserFollowUps: ["unapproved", "root", "field"],
      }),
      "sample",
    ),
  ).toMatchObject({ kind: "session", session: { submittedCount: 3 } });
});

test("warns-unrecorded-terminal-submission", () => {
  expect(
    normalizeSession(sample({ status: "completed" }), "sample"),
  ).toMatchObject({
    kind: "session",
    session: { submittedCount: 0 },
    dataWarnings: [
      { code: "SUBMISSION_UNRECORDED", source: "session", sessionId: "sample" },
    ],
  });
});

test("isolates-invalid-root-without-derived-warnings", () => {
  for (const raw of [null, [], "secret text"]) {
    expect(normalizeSession(raw, "sample")).toEqual({
      kind: "excluded",
      dataWarnings: [
        { code: "INVALID_ROOT", source: "session", sessionId: "sample" },
      ],
    });
  }
});

test("uses-directory-id-on-metadata-mismatch", () => {
  expect(normalizeSession(sample({ id: "other" }), "sample")).toMatchObject({
    kind: "session",
    session: { id: "sample" },
    dataWarnings: [
      { code: "ID_MISMATCH", source: "session", sessionId: "sample" },
    ],
  });
});

test("requested-effort-precedes-browser-config", () => {
  expect(
    normalizeSession(
      sample({
        browser: { thinkingSelection: { requestedLevel: " extra-high " } },
      }),
      "sample",
    ),
  ).toMatchObject({ kind: "session", session: { effort: "extra-high" } });
});

test("project-requires-valid-absolute-cwd", () => {
  for (const cwd of ["relative/project", "/bad\0/project", 42]) {
    expect(normalizeSession(sample({ cwd }), "sample")).toMatchObject({
      kind: "session",
      session: { project: "unknown" },
    });
  }
});

test("invalid-mode-type-falls-back-with-warning", () => {
  expect(
    normalizeSession(
      sample({
        mode: 42,
        options: {
          mode: "browser",
          browserConfig: { manualLoginProfileDir: "/workspace/profile" },
        },
      }),
      "sample",
    ),
  ).toMatchObject({
    kind: "session",
    session: { model: "gpt-6-astra" },
    dataWarnings: [
      { code: "INVALID_FIELD", source: "session", sessionId: "sample" },
    ],
  });
});

test("invalid-display-fields-use-independent-fallbacks", () => {
  expect(
    normalizeSession(
      sample({
        model: 42,
        options: {
          model: " gpt-5.6-sol ",
          slug: 7,
          browserConfig: {
            thinkingTime: " high ",
            manualLoginProfileDir: "/workspace/profile",
          },
        },
        browser: { thinkingSelection: { requestedLevel: 9 } },
      }),
      "sample",
    ),
  ).toMatchObject({
    kind: "session",
    session: { model: "gpt-5.6-sol", effort: "high", slug: "sample" },
    dataWarnings: [
      { code: "INVALID_FIELD", source: "session", sessionId: "sample" },
    ],
  });
});

test("checks-nested-objects-without-discarding-session", () => {
  const result = normalizeSession(
    sample({
      options: [],
      browser: { config: null, runtime: 42, thinkingSelection: [] },
    }),
    "sample",
  );
  expect(result).toMatchObject({
    kind: "session",
    session: { model: "gpt-6-astra", effort: "unknown", slug: "sample" },
  });
  expect(result.dataWarnings).toContainEqual({
    code: "INVALID_FIELD",
    source: "session",
    sessionId: "sample",
  });
});

test("projects-logical-profile-and-capacity", () => {
  expect(
    normalizeSession(
      sample({
        options: {
          browserConfig: {
            manualLoginProfileDir: "../profile",
            maxConcurrentTabs: 4,
          },
        },
      }),
      "sample",
    ),
  ).toMatchObject({
    kind: "session",
    session: { profilePath: "/workspace/profile", maximum: 4 },
  });
});

test("warns-conflicting-valid-saved-capacity-fields", () => {
  expect(
    normalizeSession(
      sample({
        browser: {
          config: {
            manualLoginProfileDir: "/other-profile",
            maxConcurrentTabs: 9,
          },
        },
      }),
      "sample",
    ),
  ).toMatchObject({
    kind: "session",
    session: { profilePath: "/workspace/profile", maximum: 3 },
    dataWarnings: [
      { code: "CAPACITY_CONFLICT", source: "session", sessionId: "sample" },
      { code: "PROFILE_CONFLICT", source: "session", sessionId: "sample" },
    ],
  });
});

test("cwd-unavailable-leaves-absolute-profile-unresolved", () => {
  expect(
    normalizeSession(
      sample({
        cwd: undefined,
        options: {
          browserConfig: {
            manualLoginProfileDir: "/workspace/profile",
            maxConcurrentTabs: 9,
          },
        },
      }),
      "sample",
    ),
  ).toMatchObject({
    kind: "session",
    session: { profilePath: null, maximum: 9 },
    dataWarnings: [
      { code: "PROFILE_UNRESOLVED", source: "session", sessionId: "sample" },
    ],
  });
});

test("detects-display-controls-without-changing-saved-values", () => {
  expect(
    normalizeSession(
      sample({
        model: "gpt-custom\u0085name",
        options: {
          slug: "slug\u202esaved",
          browserConfig: {
            manualLoginProfileDir: "/workspace/profile",
            thinkingTime: "High",
          },
        },
      }),
      "sample",
    ),
  ).toMatchObject({
    kind: "session",
    session: {
      model: "gpt-custom\u0085name",
      slug: "slug\u202esaved",
      effort: "High",
    },
    dataWarnings: [
      { code: "DISPLAY_SANITIZED", source: "session", sessionId: "sample" },
    ],
  });
});

test("deduplicates-and-orders-warning-codes", () => {
  const result = normalizeSession(
    sample({
      id: "other",
      mode: 42,
      status: "new",
      startedAt: "invalid",
      completedAt: "invalid",
      createdAt: "invalid",
      options: {
        mode: "browser",
        model: "gpt-6-astra",
        browserConfig: {
          manualLoginProfileDir: "/workspace/profile",
          maxConcurrentTabs: 3,
        },
      },
      browser: {
        config: {
          manualLoginProfileDir: "/other-profile",
          maxConcurrentTabs: 4,
        },
      },
    }),
    "sample",
  );
  expect(result.dataWarnings.map((warning) => warning.code)).toEqual([
    "CAPACITY_CONFLICT",
    "ID_MISMATCH",
    "INVALID_FIELD",
    "PROFILE_CONFLICT",
    "STATUS_UNRECOGNIZED",
    "TIME_INVALID",
  ]);
});

test("invalid-submission-type-does-not-coerce", () => {
  for (const promptSubmitted of ["true", 1]) {
    const result = normalizeSession(
      sample({ browser: { runtime: { promptSubmitted } } }),
      "sample",
    );
    expect(result).toMatchObject({
      kind: "session",
      session: { submittedCount: 0 },
      dataWarnings: [
        { code: "INVALID_FIELD", source: "session", sessionId: "sample" },
      ],
    });
  }
});

test("invalid-cwd-warns-and-keeps-profile-unresolved", () => {
  expect(
    normalizeSession(sample({ cwd: "relative/project" }), "sample"),
  ).toMatchObject({
    kind: "session",
    session: { project: "unknown", profilePath: null },
    dataWarnings: [
      { code: "INVALID_FIELD", source: "session", sessionId: "sample" },
      { code: "PROFILE_UNRESOLVED", source: "session", sessionId: "sample" },
    ],
  });
});

test("invalid-url-field-does-not-discard-gpt-session", () => {
  for (const tabUrl of [42, "not a url"]) {
    expect(
      normalizeSession(sample({ browser: { runtime: { tabUrl } } }), "sample"),
    ).toMatchObject({
      kind: "session",
      dataWarnings: [
        { code: "INVALID_FIELD", source: "session", sessionId: "sample" },
      ],
    });
  }
});

test("rejects-sparse-followup-array", () => {
  const browserFollowUps = new Array<unknown>(2);
  browserFollowUps[0] = "a";
  expect(
    normalizeSession(
      sample({
        status: "completed",
        options: { browserFollowUps },
        browser: { runtime: { promptSubmitted: true } },
      }),
      "sample",
    ),
  ).toMatchObject({
    kind: "session",
    session: { submittedCount: 1 },
    dataWarnings: [
      { code: "FOLLOWUPS_INVALID", source: "session", sessionId: "sample" },
    ],
  });
});

test("accepts-only-allowed-url-fields-and-exact-hosts", () => {
  for (const extra of [
    { browser: { runtime: { tabUrl: "https://chat.openai.com/c/example" } } },
    { browser: { config: { url: "https://chatgpt.com/c/example" } } },
    { browser: { config: { chatgptUrl: "https://chatgpt.com/c/example" } } },
    { options: { browserConfig: { url: "https://chatgpt.com/c/example" } } },
    {
      options: {
        browserConfig: { chatgptUrl: "https://chatgpt.com/c/example" },
      },
    },
  ]) {
    expect(
      normalizeSession(sample({ model: "custom-model", ...extra }), "sample"),
    ).toMatchObject({ kind: "session", session: { model: "custom-model" } });
  }
  for (const tabUrl of [
    "https://chatgpt.com.evil.example/c/x",
    "https://chatgpt.com@evil.example/c/x",
    "https://evil.example/?next=https://chatgpt.com",
  ]) {
    expect(
      normalizeSession(
        sample({ model: "custom-model", browser: { runtime: { tabUrl } } }),
        "sample",
      ),
    ).toEqual({
      kind: "excluded",
      dataWarnings: [
        { code: "PROVIDER_UNRESOLVED", source: "session", sessionId: "sample" },
      ],
    });
  }
  expect(
    normalizeSession(
      sample({ model: "custom-model", url: "https://chatgpt.com/c/x" }),
      "sample",
    ),
  ).toEqual({
    kind: "excluded",
    dataWarnings: [
      { code: "PROVIDER_UNRESOLVED", source: "session", sessionId: "sample" },
    ],
  });
});

test("gemini-options-and-url-always-exclude", () => {
  expect(
    normalizeSession(
      sample({ options: { model: "provider/GEMINI-next" } }),
      "sample",
    ),
  ).toEqual({
    kind: "excluded",
    dataWarnings: [
      { code: "PROVIDER_CONFLICT", source: "session", sessionId: "sample" },
    ],
  });
  expect(
    normalizeSession(
      sample({
        model: "custom",
        browser: { config: { url: "https://gemini.google.com/app" } },
      }),
      "sample",
    ),
  ).toEqual({ kind: "excluded", dataWarnings: [] });
  expect(
    normalizeSession(
      sample({
        model: "Gemini-next",
        browser: { runtime: { tabUrl: "https://chatgpt.com/c/x" } },
      }),
      "sample",
    ),
  ).toEqual({
    kind: "excluded",
    dataWarnings: [
      { code: "PROVIDER_CONFLICT", source: "session", sessionId: "sample" },
    ],
  });
});

test("unknown-mode-does-not-fall-back-but-missing-mode-does", () => {
  expect(
    normalizeSession(
      sample({ mode: "future-mode", options: { mode: "browser" } }),
      "sample",
    ),
  ).toEqual({
    kind: "excluded",
    dataWarnings: [
      { code: "MODE_UNRESOLVED", source: "session", sessionId: "sample" },
    ],
  });
  for (const mode of [undefined, null, ""]) {
    expect(
      normalizeSession(
        sample({ mode, options: { mode: "browser" } }),
        "sample",
      ),
    ).toMatchObject({ kind: "session" });
  }
});

test("preserves-model-effort-case-and-unknown-values", () => {
  expect(
    normalizeSession(
      sample({
        model: " GPT-Custom  Alias ",
        options: { browserConfig: { thinkingTime: " High " } },
      }),
      "sample",
    ),
  ).toMatchObject({
    kind: "session",
    session: { model: "GPT-Custom  Alias", effort: "High" },
  });
  expect(
    normalizeSession(
      sample({
        model: undefined,
        options: {},
        browser: { runtime: { tabUrl: "https://chatgpt.com/c/x" } },
      }),
      "sample",
    ),
  ).toMatchObject({
    kind: "session",
    session: { model: "unknown", effort: "unknown", slug: "sample" },
  });
  expect(
    normalizeSession(
      sample({ model: "custom", options: { model: "gpt-6-astra" } }),
      "sample",
    ),
  ).toEqual({
    kind: "excluded",
    dataWarnings: [
      { code: "PROVIDER_UNRESOLVED", source: "session", sessionId: "sample" },
    ],
  });
});

test("followups-require-completed-and-first-true", () => {
  for (const [status, promptSubmitted, count] of [
    ["error", true, 1],
    ["pending", true, 1],
    ["new", true, 1],
    ["completed", false, 0],
    ["completed", true, 3],
  ] as const) {
    expect(
      normalizeSession(
        sample({
          status,
          options: { browserFollowUps: ["a", "a"] },
          browser: { runtime: { promptSubmitted, submittedPromptHash: null } },
        }),
        "sample",
      ),
    ).toMatchObject({ kind: "session", session: { submittedCount: count } });
  }
  expect(
    normalizeSession(
      sample({
        status: "completed",
        options: { browserFollowUps: [] },
        browser: { runtime: { promptSubmitted: true } },
      }),
      "sample",
    ),
  ).toMatchObject({
    kind: "session",
    session: { submittedCount: 1 },
    dataWarnings: [],
  });
});

test("invalid-profile-and-max-fall-back-independently", () => {
  expect(
    normalizeSession(
      sample({
        options: {
          browserConfig: {
            manualLoginProfileDir: "bad\0path",
            maxConcurrentTabs: "9",
          },
        },
        browser: {
          config: {
            manualLoginProfileDir: "/other-profile",
            maxConcurrentTabs: 4,
          },
        },
      }),
      "sample",
    ),
  ).toMatchObject({
    kind: "session",
    session: { profilePath: "/other-profile", maximum: 4 },
    dataWarnings: [
      { code: "INVALID_FIELD", source: "session", sessionId: "sample" },
    ],
  });
  expect(
    normalizeSession(
      sample({
        browser: {
          config: { manualLoginProfileDir: "../profile", maxConcurrentTabs: 3 },
        },
      }),
      "sample",
    ),
  ).toMatchObject({
    kind: "session",
    session: { profilePath: "/workspace/profile", maximum: 3 },
    dataWarnings: [],
  });
});

test("returns-only-limited-projection", () => {
  const raw = sample({
    status: "completed",
    startedAt: "2026-09-30T05:00:00Z",
    createdAt: "2026-09-30T04:00:00Z",
    completedAt: "2026-09-30T06:00:00Z",
    secret: "private-secret",
    prompt: "private-prompt",
    history: [{ content: "private-history" }],
    options: {
      slug: "saved-slug",
      browserFollowUps: ["private-followup", "private-followup"],
      browserConfig: {
        thinkingTime: "high",
        manualLoginProfileDir: "/workspace/profile",
        maxConcurrentTabs: 3,
        cookie: "private-cookie",
      },
    },
    browser: {
      runtime: {
        promptSubmitted: true,
        tabUrl: "https://chatgpt.com/c/private",
        pid: 1,
      },
      thinkingSelection: {
        requestedLevel: "high",
        actualLevel: "private-actual",
      },
    },
  });
  expect(normalizeSession(raw, "sample")).toEqual({
    kind: "session",
    session: {
      id: "sample",
      status: "completed",
      project: "sample-project",
      slug: "saved-slug",
      model: "gpt-6-astra",
      effort: "high",
      startTimeMs: 1790744400000,
      reliabilityTimeMs: 1790748000000,
      submittedCount: 3,
      profilePath: "/workspace/profile",
      maximum: 3,
    },
    dataWarnings: [],
  });
});

test("ignores-inherited-fields-and-unknown-keys", () => {
  expect(
    normalizeSession(
      Object.assign(Object.create({ mode: "browser", model: "gpt-6-astra" }), {
        secret: "private",
      }),
      "sample",
    ),
  ).toEqual({
    kind: "excluded",
    dataWarnings: [
      { code: "MODE_UNRESOLVED", source: "session", sessionId: "sample" },
    ],
  });
  const options = Object.assign(
    Object.create({ model: "gpt-6-astra", slug: "private-inherited" }),
    { browserConfig: { manualLoginProfileDir: "/workspace/profile" } },
  );
  expect(
    normalizeSession(
      sample({
        model: undefined,
        options,
        browser: { runtime: { tabUrl: "https://chatgpt.com/c/x" } },
        browserFollowUps: null,
      }),
      "sample",
    ),
  ).toMatchObject({
    kind: "session",
    session: { model: "unknown", slug: "sample" },
    dataWarnings: [],
  });
});

test("missing-and-invalid-time-fields-remain-explicit", () => {
  expect(
    normalizeSession(
      sample({ startedAt: null, completedAt: "", createdAt: 123 }),
      "sample",
    ),
  ).toMatchObject({
    kind: "session",
    session: { startTimeMs: null, reliabilityTimeMs: null },
    dataWarnings: [
      { code: "TIME_INVALID", source: "session", sessionId: "sample" },
    ],
  });
  expect(
    normalizeSession(
      sample({ startedAt: "", createdAt: "2026-09-30T06:00:00Z" }),
      "sample",
    ),
  ).toMatchObject({
    kind: "session",
    session: { startTimeMs: 1790748000000, reliabilityTimeMs: 1790748000000 },
    dataWarnings: [],
  });
});

test("capacity-accepts-only-positive-safe-numbers", () => {
  for (const maxConcurrentTabs of [
    0,
    -1,
    1.5,
    Infinity,
    NaN,
    9007199254740992,
    "3",
  ]) {
    expect(
      normalizeSession(
        sample({
          options: {
            browserConfig: {
              manualLoginProfileDir: "/workspace/profile",
              maxConcurrentTabs,
            },
          },
        }),
        "sample",
      ),
    ).toMatchObject({
      kind: "session",
      session: { maximum: null },
      dataWarnings: [
        { code: "INVALID_FIELD", source: "session", sessionId: "sample" },
      ],
    });
  }
  expect(
    normalizeSession(
      sample({
        options: {
          browserConfig: {
            maxConcurrentTabs: 9007199254740991,
            manualLoginProfileDir: "/workspace/profile",
          },
        },
      }),
      "sample",
    ),
  ).toMatchObject({
    kind: "session",
    session: { maximum: 9007199254740991 },
    dataWarnings: [],
  });
});
