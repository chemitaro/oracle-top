import { isAbsolute, join, resolve } from "node:path";
import { readJsonFile, type ReadOnlyFileSystem } from "./io/json-reader.js";
import type { DataWarning, MaximumSource } from "./model/dashboard.js";

export interface MonitorStartup {
  readonly cwd: string;
  readonly osHome: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly intervalArguments?: readonly string[];
}

export interface MonitorConfig {
  homePath: string;
  sessionsPath: string;
  profilePath: string;
  intervalMs: number;
  fallbackMaximum: number;
  fallbackMaximumSource: Exclude<MaximumSource, "session">;
}

export interface MonitorConfigDependencies {
  io?: ReadOnlyFileSystem;
  signal?: AbortSignal;
}

export type IntervalResult =
  { kind: "interval"; intervalMs: number } | { kind: "usage-error" };

export type MonitorConfigResult =
  | { kind: "config"; config: MonitorConfig; dataWarnings: DataWarning[] }
  | { kind: "usage-error" }
  | { kind: "aborted" };

export function parseInterval(values: readonly string[] = []): IntervalResult {
  if (values.length === 0) return { kind: "interval", intervalMs: 2000 };
  if (values.length !== 1) return { kind: "usage-error" };
  const match = /^([0-9]+)(ms|s|m)$/.exec(values[0]!);
  if (!match) return { kind: "usage-error" };
  const intervalMs =
    Number(match[1]) *
    (match[2] === "ms" ? 1 : match[2] === "s" ? 1000 : 60000);
  return Number.isSafeInteger(intervalMs) &&
    intervalMs >= 1000 &&
    intervalMs <= 60000
    ? { kind: "interval", intervalMs }
    : { kind: "usage-error" };
}

export async function resolveMonitorConfig(
  startup: MonitorStartup,
  dependencies: MonitorConfigDependencies = {},
): Promise<MonitorConfigResult> {
  if (
    !isAbsolute(startup.cwd) ||
    !isAbsolute(startup.osHome) ||
    startup.cwd.includes("\0") ||
    startup.osHome.includes("\0")
  )
    return { kind: "usage-error" };
  if (
    [startup.env.ORACLE_HOME_DIR, startup.env.ORACLE_BROWSER_PROFILE_DIR].some(
      (value) => value?.includes("\0"),
    )
  )
    return { kind: "usage-error" };
  const interval = parseInterval(startup.intervalArguments);
  if (interval.kind === "usage-error") return interval;
  const homePath = startup.env.ORACLE_HOME_DIR
    ? resolve(startup.cwd, startup.env.ORACLE_HOME_DIR)
    : join(startup.osHome, ".oracle");
  const document = await readJsonFile({
    rootPath: homePath,
    pathSegments: ["config.json"],
    format: "json5",
    context: { source: "config" },
    ...dependencies,
  });
  if (document.kind === "aborted") return document;
  const browser =
    document.kind === "value" ? own(document.value, "browser") : undefined;
  const savedProfile = own(browser, "manualLoginProfileDir");
  const validProfile =
    typeof savedProfile === "string" &&
    savedProfile.length > 0 &&
    !savedProfile.includes("\0");
  const savedMaximum = own(browser, "maxConcurrentTabs");
  const dataWarnings: DataWarning[] =
    document.kind === "warning" ? [document.warning] : [];
  const profilePath = startup.env.ORACLE_BROWSER_PROFILE_DIR
    ? resolve(startup.cwd, startup.env.ORACLE_BROWSER_PROFILE_DIR)
    : validProfile
      ? resolve(startup.cwd, savedProfile)
      : join(startup.osHome, ".oracle", "browser-profile");
  const validMaximum =
    typeof savedMaximum === "number" &&
    Number.isSafeInteger(savedMaximum) &&
    savedMaximum > 0;
  if (
    (browser !== undefined &&
      (typeof browser !== "object" ||
        browser === null ||
        Array.isArray(browser))) ||
    (savedProfile !== undefined && !validProfile) ||
    (savedMaximum !== undefined && !validMaximum)
  )
    dataWarnings.push({ code: "INVALID_FIELD", source: "config" });
  const rawEnvironmentMaximum = startup.env.ORACLE_BROWSER_MAX_CONCURRENT_TABS;
  const environmentMaximum =
    rawEnvironmentMaximum && /^[0-9]+$/.test(rawEnvironmentMaximum)
      ? Number(rawEnvironmentMaximum)
      : NaN;
  const validEnvironmentMaximum =
    Number.isSafeInteger(environmentMaximum) && environmentMaximum > 0;
  if (
    rawEnvironmentMaximum &&
    !validEnvironmentMaximum &&
    !dataWarnings.some((entry) => entry.code === "INVALID_FIELD")
  )
    dataWarnings.push({ code: "INVALID_FIELD", source: "config" });
  return {
    kind: "config",
    config: {
      homePath,
      sessionsPath: join(homePath, "sessions"),
      profilePath,
      intervalMs: interval.intervalMs,
      fallbackMaximum: validEnvironmentMaximum
        ? environmentMaximum
        : validMaximum
          ? savedMaximum
          : 3,
      fallbackMaximumSource: validEnvironmentMaximum
        ? "environment"
        : validMaximum
          ? "user-config"
          : "default",
    },
    dataWarnings,
  };
}

function own(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}
