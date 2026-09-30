import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  parseInterval,
  resolveMonitorConfig,
  type MonitorStartup,
} from "../src/config.js";

let root: string;
let startup: MonitorStartup;

beforeEach(async () => {
  await mkdir(join(process.cwd(), ".workbench", "p04"), { recursive: true });
  root = await mkdtemp(join(process.cwd(), ".workbench/p04/fixture-"));
  await mkdir(join(root, "os-home", ".oracle"), { recursive: true });
  await mkdir(join(root, "startup"));
  await writeFile(join(root, "os-home", ".oracle", "config.json"), "{}");
  startup = { cwd: `${root}/startup`, osHome: `${root}/os-home`, env: {} };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("defaults-use-os-home", async () => {
  expect(await resolveMonitorConfig(startup)).toEqual({
    kind: "config",
    config: {
      homePath: `${root}/os-home/.oracle`,
      sessionsPath: `${root}/os-home/.oracle/sessions`,
      profilePath: `${root}/os-home/.oracle/browser-profile`,
      intervalMs: 2000,
      fallbackMaximum: 3,
      fallbackMaximumSource: "default",
    },
    dataWarnings: [],
  });
});

test("home-override-does-not-move-profile", async () => {
  const result = await resolveMonitorConfig({
    ...startup,
    env: { ORACLE_HOME_DIR: `${root}/store` },
  });
  expect(result).toMatchObject({
    kind: "config",
    config: {
      homePath: `${root}/store`,
      sessionsPath: `${root}/store/sessions`,
      profilePath: `${root}/os-home/.oracle/browser-profile`,
    },
  });
});

test("profile-env-overrides-default", async () => {
  expect(
    await resolveMonitorConfig({
      ...startup,
      env: { ORACLE_BROWSER_PROFILE_DIR: "selected-profile" },
    }),
  ).toMatchObject({
    kind: "config",
    config: { profilePath: `${root}/startup/selected-profile` },
  });
});

test("projects-only-whitelisted-json5-config", async () => {
  await writeFile(
    join(root, "os-home", ".oracle", "config.json"),
    '{/* user config */ apiKey: "secret-key", browser: { manualLoginProfileDir: "user-profile", maxConcurrentTabs: 4, cookie: "private-cookie", }, }',
  );
  expect(await resolveMonitorConfig(startup)).toEqual({
    kind: "config",
    config: {
      homePath: `${root}/os-home/.oracle`,
      sessionsPath: `${root}/os-home/.oracle/sessions`,
      profilePath: `${root}/startup/user-profile`,
      intervalMs: 2000,
      fallbackMaximum: 4,
      fallbackMaximumSource: "user-config",
    },
    dataWarnings: [],
  });
});

test("environment-max-overrides-user-config", async () => {
  await writeFile(
    join(root, "os-home", ".oracle", "config.json"),
    "{browser: {maxConcurrentTabs: 8}}",
  );
  expect(
    await resolveMonitorConfig({
      ...startup,
      env: { ORACLE_BROWSER_MAX_CONCURRENT_TABS: "005" },
    }),
  ).toMatchObject({
    kind: "config",
    config: { fallbackMaximum: 5, fallbackMaximumSource: "environment" },
  });
});

test("invalid-config-fields-warn-and-use-fallback", async () => {
  for (const maximum of [
    "Infinity",
    "NaN",
    '"4"',
    "0",
    "-1",
    "1.5",
    "9007199254740992",
  ]) {
    await writeFile(
      join(root, "os-home", ".oracle", "config.json"),
      `{browser: {manualLoginProfileDir: 42, maxConcurrentTabs: ${maximum}}}`,
    );
    expect(await resolveMonitorConfig(startup)).toMatchObject({
      kind: "config",
      config: {
        profilePath: `${root}/os-home/.oracle/browser-profile`,
        fallbackMaximum: 3,
        fallbackMaximumSource: "default",
      },
      dataWarnings: [{ code: "INVALID_FIELD", source: "config" }],
    });
  }
});

test("invalid-environment-max-uses-user-config", async () => {
  await writeFile(
    join(root, "os-home", ".oracle", "config.json"),
    "{browser: {maxConcurrentTabs: 4}}",
  );
  for (const value of [
    "-1",
    "+1",
    "1.5",
    "1e2",
    "０４",
    "0",
    "9007199254740992",
  ]) {
    expect(
      await resolveMonitorConfig({
        ...startup,
        env: { ORACLE_BROWSER_MAX_CONCURRENT_TABS: value },
      }),
    ).toMatchObject({
      kind: "config",
      config: { fallbackMaximum: 4, fallbackMaximumSource: "user-config" },
      dataWarnings: [{ code: "INVALID_FIELD", source: "config" }],
    });
  }
});

test("rejects-nul-environment-path-as-usage-error", async () => {
  for (const key of ["ORACLE_HOME_DIR", "ORACLE_BROWSER_PROFILE_DIR"]) {
    expect(
      await resolveMonitorConfig({ ...startup, env: { [key]: "bad\0path" } }),
    ).toEqual({ kind: "usage-error" });
  }
});

test("invalid-config-profile-falls-back", async () => {
  await writeFile(
    join(root, "os-home", ".oracle", "config.json"),
    '{browser: {manualLoginProfileDir: "bad\\u0000path", maxConcurrentTabs: 4}}',
  );
  expect(await resolveMonitorConfig(startup)).toMatchObject({
    kind: "config",
    config: {
      profilePath: `${root}/os-home/.oracle/browser-profile`,
      fallbackMaximum: 4,
    },
    dataWarnings: [{ code: "INVALID_FIELD", source: "config" }],
  });
});

test("invalid-browser-object-warns", async () => {
  for (const value of ["null", "[]", "42"]) {
    await writeFile(
      join(root, "os-home", ".oracle", "config.json"),
      `{browser: ${value}}`,
    );
    expect(await resolveMonitorConfig(startup)).toMatchObject({
      kind: "config",
      config: { fallbackMaximum: 3 },
      dataWarnings: [{ code: "INVALID_FIELD", source: "config" }],
    });
  }
});

test("interval-defaults-to-two-seconds", () => {
  expect(parseInterval()).toEqual({ kind: "interval", intervalMs: 2000 });
});

test("interval-accepts-ascii-units-and-leading-zeroes", () => {
  for (const [value, intervalMs] of [
    ["1000ms", 1000],
    ["001s", 1000],
    ["60s", 60000],
    ["1m", 60000],
  ] as const) {
    expect(parseInterval([value])).toEqual({ kind: "interval", intervalMs });
  }
});

test("resolver-uses-selected-interval", async () => {
  expect(
    await resolveMonitorConfig({ ...startup, intervalArguments: ["3s"] }),
  ).toMatchObject({ kind: "config", config: { intervalMs: 3000 } });
});

test("interval-rejects-invalid-syntax-range-and-duplicates", async () => {
  for (const value of [
    "2",
    "0s",
    "999ms",
    "60001ms",
    "2m",
    "1.5s",
    "+2s",
    "-2s",
    "1e3ms",
    "２s",
    " 2s",
    "2s\n",
    "2S",
    "999999999999999999999m",
  ]) {
    expect(parseInterval([value])).toEqual({ kind: "usage-error" });
    expect(
      await resolveMonitorConfig({ ...startup, intervalArguments: [value] }),
    ).toEqual({ kind: "usage-error" });
  }
  expect(parseInterval(["2s", "2s"])).toEqual({ kind: "usage-error" });
  expect(
    await resolveMonitorConfig({ ...startup, intervalArguments: ["2s", "2s"] }),
  ).toEqual({ kind: "usage-error" });
});

test("rejects-invalid-startup-paths", async () => {
  for (const invalid of [
    { cwd: "relative" },
    { osHome: "relative" },
    { cwd: "bad\0path" },
    { osHome: "bad\0path" },
  ]) {
    expect(await resolveMonitorConfig({ ...startup, ...invalid })).toEqual({
      kind: "usage-error",
    });
  }
});

test("rereads-user-config-on-each-call", async () => {
  const file = join(root, "os-home", ".oracle", "config.json");
  await writeFile(
    file,
    '{browser: {manualLoginProfileDir: "before", maxConcurrentTabs: 4}}',
  );
  expect(await resolveMonitorConfig(startup)).toMatchObject({
    kind: "config",
    config: { profilePath: `${root}/startup/before`, fallbackMaximum: 4 },
  });
  await writeFile(
    file,
    '{browser: {manualLoginProfileDir: "after", maxConcurrentTabs: 6}}',
  );
  expect(await resolveMonitorConfig(startup)).toMatchObject({
    kind: "config",
    config: { profilePath: `${root}/startup/after`, fallbackMaximum: 6 },
  });
});

test("uses-startup-snapshot-instead-of-live-environment", async () => {
  const fixed = Object.freeze({
    ...startup,
    env: Object.freeze({
      ORACLE_BROWSER_PROFILE_DIR: "captured",
      ORACLE_BROWSER_MAX_CONCURRENT_TABS: "4",
    }),
  });
  const savedHome = process.env.ORACLE_HOME_DIR;
  const savedProfile = process.env.ORACLE_BROWSER_PROFILE_DIR;
  const savedMaximum = process.env.ORACLE_BROWSER_MAX_CONCURRENT_TABS;
  try {
    for (const value of ["first-live", "second-live"]) {
      process.env.ORACLE_HOME_DIR = `${root}/${value}`;
      process.env.ORACLE_BROWSER_PROFILE_DIR = value;
      process.env.ORACLE_BROWSER_MAX_CONCURRENT_TABS = "9";
      expect(await resolveMonitorConfig(fixed)).toMatchObject({
        kind: "config",
        config: {
          homePath: `${root}/os-home/.oracle`,
          profilePath: `${root}/startup/captured`,
          fallbackMaximum: 4,
          fallbackMaximumSource: "environment",
        },
      });
    }
  } finally {
    for (const [key, value] of [
      ["ORACLE_HOME_DIR", savedHome],
      ["ORACLE_BROWSER_PROFILE_DIR", savedProfile],
      ["ORACLE_BROWSER_MAX_CONCURRENT_TABS", savedMaximum],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("paths-use-startup-cwd-without-shell-expansion", async () => {
  expect(
    await resolveMonitorConfig({
      ...startup,
      env: {
        ORACLE_HOME_DIR: "relative-home",
        ORACLE_BROWSER_PROFILE_DIR: "~/$PROFILE",
      },
    }),
  ).toMatchObject({
    kind: "config",
    config: {
      homePath: `${root}/startup/relative-home`,
      sessionsPath: `${root}/startup/relative-home/sessions`,
      profilePath: `${root}/startup/~/$PROFILE`,
    },
  });
});

test("profile-env-overrides-user-config", async () => {
  await writeFile(
    join(root, "os-home", ".oracle", "config.json"),
    '{browser: {manualLoginProfileDir: "saved-profile"}}',
  );
  expect(
    await resolveMonitorConfig({
      ...startup,
      env: { ORACLE_BROWSER_PROFILE_DIR: "env-profile" },
    }),
  ).toMatchObject({
    kind: "config",
    config: { profilePath: `${root}/startup/env-profile` },
  });
});

test("preserves-reader-warning-without-derived-field-warnings", async () => {
  const file = join(root, "os-home", ".oracle", "config.json");
  for (const [content, code] of [
    ["{broken}", "INVALID_JSON5"],
    ["[]", "INVALID_ROOT"],
  ] as const) {
    await writeFile(file, content);
    expect(await resolveMonitorConfig(startup)).toMatchObject({
      kind: "config",
      config: { fallbackMaximum: 3 },
      dataWarnings: [{ code, source: "config" }],
    });
  }
  await rm(file);
  expect(await resolveMonitorConfig(startup)).toMatchObject({
    kind: "config",
    config: { fallbackMaximum: 3 },
    dataWarnings: [{ code: "FILE_MISSING", source: "config" }],
  });
});

test("does-not-read-project-config-or-prototype-values", async () => {
  await writeFile(
    join(root, "startup", "config.json"),
    '{browser: {manualLoginProfileDir: "project", maxConcurrentTabs: 9}, secret: "project-secret"}',
  );
  await writeFile(
    join(root, "os-home", ".oracle", "config.json"),
    '{"__proto__": {browser: {manualLoginProfileDir: "inherited", maxConcurrentTabs: 8}}, browser: {"__proto__": {maxConcurrentTabs: 7}}}',
  );
  expect(await resolveMonitorConfig(startup)).toEqual({
    kind: "config",
    config: {
      homePath: `${root}/os-home/.oracle`,
      sessionsPath: `${root}/os-home/.oracle/sessions`,
      profilePath: `${root}/os-home/.oracle/browser-profile`,
      intervalMs: 2000,
      fallbackMaximum: 3,
      fallbackMaximumSource: "default",
    },
    dataWarnings: [],
  });
});

test("propagates-abort-without-warning", async () => {
  const controller = new AbortController();
  controller.abort();
  expect(
    await resolveMonitorConfig(startup, { signal: controller.signal }),
  ).toEqual({ kind: "aborted" });
});
