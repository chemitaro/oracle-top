import { basename, isAbsolute, resolve } from "node:path";
import type { DataWarning, DataWarningCode } from "./dashboard.js";
import type { NormalizeResult } from "./session.js";
import { parseIsoTimestamp } from "./time.js";

export function normalizeSession(
  raw: unknown,
  directoryId: string,
): NormalizeResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return {
      kind: "excluded",
      dataWarnings: [
        { code: "INVALID_ROOT", source: "session", sessionId: directoryId },
      ],
    };
  const dataWarnings: DataWarning[] = [];
  const warn = (code: DataWarningCode) => {
    if (!dataWarnings.some((entry) => entry.code === code))
      dataWarnings.push({ code, source: "session", sessionId: directoryId });
  };
  const exclude = (code?: DataWarningCode): NormalizeResult => {
    if (code) warn(code);
    return {
      kind: "excluded",
      dataWarnings: dataWarnings.sort(compareWarnings),
    };
  };
  const options = checkedObject(own(raw, "options"), warn);
  const metaMode = checkedText(own(raw, "mode"), warn);
  const optionMode = checkedText(own(options, "mode"), warn);
  if (
    (metaMode === "browser" || metaMode === "api") &&
    (optionMode === "browser" || optionMode === "api") &&
    metaMode !== optionMode
  )
    return exclude("MODE_CONFLICT");
  const mode = metaMode ?? optionMode;
  if (mode === "api") return exclude();
  if (mode !== "browser") return exclude("MODE_UNRESOLVED");
  const models = [
    checkedText(own(raw, "model"), warn),
    checkedText(own(options, "model"), warn),
  ];
  const geminiModel = models.some(
    (model) =>
      model?.toLowerCase().startsWith("gemini") ||
      model?.toLowerCase().split("/").at(-1)?.startsWith("gemini"),
  );
  const model = models[0] ?? models[1] ?? "unknown";
  const browser = checkedObject(own(raw, "browser"), warn);
  const savedBrowserConfig = checkedObject(own(browser, "config"), warn);
  const browserConfig = checkedObject(own(options, "browserConfig"), warn);
  const runtime = checkedObject(own(browser, "runtime"), warn);
  const thinkingSelection = checkedObject(
    own(browser, "thinkingSelection"),
    warn,
  );
  const hosts = [
    own(runtime, "tabUrl"),
    own(savedBrowserConfig, "url"),
    own(savedBrowserConfig, "chatgptUrl"),
    own(browserConfig, "url"),
    own(browserConfig, "chatgptUrl"),
  ].map((value) => hostname(value, warn));
  const chatgpt =
    model.toLowerCase().startsWith("gpt-") ||
    hosts.some((host) => host === "chatgpt.com" || host === "chat.openai.com");
  const gemini = geminiModel || hosts.includes("gemini.google.com");
  if (gemini && chatgpt) return exclude("PROVIDER_CONFLICT");
  if (gemini) return exclude();
  if (!chatgpt) return exclude("PROVIDER_UNRESOLVED");
  const status = checkedText(own(raw, "status"), warn);
  const metadataId = checkedText(own(raw, "id"), warn);
  if (metadataId !== null && metadataId !== directoryId) warn("ID_MISMATCH");
  if (
    ![
      "pending",
      "running",
      "completed",
      "partial",
      "error",
      "cancelled",
    ].includes(status ?? "")
  )
    dataWarnings.push({
      code: "STATUS_UNRECOGNIZED",
      source: "session",
      sessionId: directoryId,
    });
  const startTimeMs = resolveTime(
    own(raw, "startedAt"),
    own(raw, "createdAt"),
    warn,
  );
  const reliabilityTimeMs = resolveTime(
    own(raw, "completedAt"),
    own(raw, "createdAt"),
    warn,
  );
  const submitted = own(runtime, "promptSubmitted");
  if (
    submitted !== undefined &&
    submitted !== null &&
    typeof submitted !== "boolean"
  )
    warn("INVALID_FIELD");
  let submittedCount = submitted === true ? 1 : 0;
  if (
    (submitted === undefined || submitted === null) &&
    ["completed", "partial", "error", "cancelled"].includes(status ?? "")
  )
    warn("SUBMISSION_UNRECORDED");
  const followUps = own(options, "browserFollowUps");
  const validFollowUps = validFollowUpArray(followUps);
  if (followUps !== undefined && !validFollowUps) warn("FOLLOWUPS_INVALID");
  if (submittedCount === 1 && status === "completed" && validFollowUps)
    submittedCount += followUps.length;
  const effort =
    checkedText(own(thinkingSelection, "requestedLevel"), warn) ??
    checkedText(own(browserConfig, "thinkingTime"), warn) ??
    "unknown";
  const rawCwd = own(raw, "cwd");
  const cwd =
    typeof rawCwd === "string" && isAbsolute(rawCwd) && !rawCwd.includes("\0")
      ? rawCwd
      : null;
  if (rawCwd !== undefined && rawCwd !== null && rawCwd !== "" && cwd === null)
    warn("INVALID_FIELD");
  const optionProfile = savedProfile(
    own(browserConfig, "manualLoginProfileDir"),
    cwd,
    warn,
  );
  const browserProfile = savedProfile(
    own(savedBrowserConfig, "manualLoginProfileDir"),
    cwd,
    warn,
  );
  if (
    optionProfile !== null &&
    browserProfile !== null &&
    optionProfile !== browserProfile
  )
    warn("PROFILE_CONFLICT");
  const profilePath = optionProfile ?? browserProfile;
  if (profilePath === null && (status === "pending" || status === "running"))
    warn("PROFILE_UNRESOLVED");
  const optionMaximum = savedMaximum(
    own(browserConfig, "maxConcurrentTabs"),
    warn,
  );
  const browserMaximum = savedMaximum(
    own(savedBrowserConfig, "maxConcurrentTabs"),
    warn,
  );
  if (
    optionMaximum !== null &&
    browserMaximum !== null &&
    optionMaximum !== browserMaximum
  )
    warn("CAPACITY_CONFLICT");
  const maximum = optionMaximum ?? browserMaximum;
  const session = {
    id: directoryId,
    status,
    project: cwd === null ? "unknown" : basename(cwd) || "unknown",
    slug: checkedText(own(options, "slug"), warn) ?? directoryId,
    model,
    effort,
    startTimeMs,
    reliabilityTimeMs,
    submittedCount,
    profilePath,
    maximum,
  };
  if (
    [
      session.id,
      session.project,
      session.slug,
      session.model,
      session.effort,
    ].some((value) =>
      /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(
        value,
      ),
    )
  )
    warn("DISPLAY_SANITIZED");
  return {
    kind: "session",
    session,
    dataWarnings: dataWarnings.sort(compareWarnings),
  };
}

function own(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function checkedText(
  value: unknown,
  warn: (code: DataWarningCode) => void,
): string | null {
  if (value !== undefined && value !== null && typeof value !== "string")
    warn("INVALID_FIELD");
  return text(value);
}

function checkedObject(
  value: unknown,
  warn: (code: DataWarningCode) => void,
): unknown {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    warn("INVALID_FIELD");
    return undefined;
  }
  return value;
}

function hostname(
  value: unknown,
  warn: (code: DataWarningCode) => void,
): string | null {
  const url = checkedText(value, warn);
  if (url === null) return null;
  try {
    return new URL(url).hostname;
  } catch {
    warn("INVALID_FIELD");
    return null;
  }
}

function resolveTime(
  primary: unknown,
  created: unknown,
  warn: (code: DataWarningCode) => void,
): number | null {
  for (const value of [primary, created]) {
    if (
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "")
    )
      continue;
    const parsed = parseIsoTimestamp(value);
    if (parsed !== null) return parsed;
    warn("TIME_INVALID");
  }
  return null;
}

function savedProfile(
  value: unknown,
  cwd: string | null,
  warn: (code: DataWarningCode) => void,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.includes("\0")) {
    warn("INVALID_FIELD");
    return null;
  }
  return cwd === null ? null : resolve(cwd, value);
}

function savedMaximum(
  value: unknown,
  warn: (code: DataWarningCode) => void,
): number | null {
  if (value === undefined) return null;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
    return value;
  warn("INVALID_FIELD");
  return null;
}

function compareWarnings(left: DataWarning, right: DataWarning): number {
  return left.code < right.code ? -1 : left.code > right.code ? 1 : 0;
}

function validFollowUpArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index++) {
    if (
      text(Object.getOwnPropertyDescriptor(value, String(index))?.value) ===
      null
    )
      return false;
  }
  return true;
}
