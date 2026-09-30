import type { DashboardInputs } from "./io/sessions.js";
import type {
  SubmittedMessageRow,
  DashboardSnapshot,
} from "./model/dashboard.js";
export function buildDashboard(
  inputs: DashboardInputs,
  nowMs: number,
): DashboardSnapshot {
  const dataWarnings = [...inputs.dataWarnings];
  for (const session of inputs.sessions ?? []) {
    const terminal =
      session.status === "completed" ||
      session.status === "partial" ||
      session.status === "error" ||
      session.status === "cancelled";
    const check = (time: number | null) => {
      if (time === null)
        dataWarnings.push({
          source: "session",
          sessionId: session.id,
          code: "TIME_UNAVAILABLE",
        });
      else if (time > nowMs)
        dataWarnings.push({
          source: "session",
          sessionId: session.id,
          code: "TIME_FUTURE",
        });
    };
    if (
      session.status === "pending" ||
      session.status === "running" ||
      session.submittedCount > 0
    )
      check(session.startTimeMs);
    if (terminal) check(session.reliabilityTimeMs);
  }
  const current = (inputs.sessions ?? []).filter(
    (session) => session.status === "pending" || session.status === "running",
  );
  const candidates = current.filter((session) => {
    if (session.profilePath === null) return false;
    if (
      session.profilePath !== inputs.config.profilePath &&
      session.profilePath !== inputs.selectedProfileRealPath
    ) {
      dataWarnings.push({
        source: "session",
        sessionId: session.id,
        code: "PROFILE_DIFFERENT",
      });
      return false;
    }
    return session.maximum !== null;
  });
  candidates.sort((a, b) => {
    const left =
      a.startTimeMs !== null && a.startTimeMs <= nowMs
        ? a.startTimeMs
        : -Infinity;
    const right =
      b.startTimeMs !== null && b.startTimeMs <= nowMs
        ? b.startTimeMs
        : -Infinity;
    return right - left || compare(a.id, b.id);
  });
  const maximum = candidates[0]?.maximum ?? inputs.config.fallbackMaximum;
  for (const candidate of candidates)
    if (candidate.maximum !== maximum)
      dataWarnings.push({
        source: "session",
        sessionId: candidate.id,
        code: "CAPACITY_CONFLICT",
      });
  const maximumSource =
    candidates.length > 0 ? "session" : inputs.config.fallbackMaximumSource;
  const submitted = new Map<string, SubmittedMessageRow>();
  for (const session of inputs.sessions ?? []) {
    const time = session.startTimeMs;
    if (
      time === null ||
      time > nowMs ||
      time < nowMs - 604800000 ||
      session.submittedCount === 0
    )
      continue;
    const key = JSON.stringify([session.model, session.effort]);
    const item = submitted.get(key) ?? {
      model: session.model,
      effort: session.effort,
      submitted24h: 0,
      submitted7d: 0,
    };
    item.submitted7d += session.submittedCount;
    if (time >= nowMs - 86400000) item.submitted24h += session.submittedCount;
    submitted.set(key, item);
  }
  const reliability = {
    completed: 0,
    partial: 0,
    error: 0,
    cancelled: 0,
    evaluated: 0,
    successRate: null as number | null,
  };
  for (const session of inputs.sessions ?? []) {
    if (
      session.reliabilityTimeMs !== null &&
      session.reliabilityTimeMs >= nowMs - 86400000 &&
      session.reliabilityTimeMs <= nowMs
    ) {
      if (
        session.status === "completed" ||
        session.status === "partial" ||
        session.status === "error" ||
        session.status === "cancelled"
      )
        reliability[session.status]++;
    }
  }
  reliability.evaluated =
    reliability.completed + reliability.partial + reliability.error;
  reliability.successRate =
    reliability.evaluated === 0
      ? null
      : reliability.completed / reliability.evaluated;
  return {
    schemaVersion: 1,
    generatedAt: new Date(nowMs).toISOString(),
    browserCapacity: {
      active: inputs.active,
      maximum,
      maximumSource,
      utilization: inputs.active === null ? null : inputs.active / maximum,
    },
    currentSessions:
      inputs.sessions === null
        ? null
        : inputs.sessions
            .filter(
              (session) =>
                session.status === "pending" || session.status === "running",
            )
            .map((session) => ({
              id: session.id,
              status: session.status as "pending" | "running",
              project: session.project,
              slug: session.slug,
              model: session.model,
              effort: session.effort,
              elapsedMs:
                session.startTimeMs === null || session.startTimeMs > nowMs
                  ? null
                  : nowMs - session.startTimeMs,
            }))
            .sort(
              (a, b) =>
                (a.elapsedMs ?? Infinity) - (b.elapsedMs ?? Infinity) ||
                compare(a.id, b.id),
            ),
    reliability24h: inputs.sessions === null ? null : reliability,
    submittedMessages:
      inputs.sessions === null
        ? null
        : [...submitted.values()].sort(
            (a, b) =>
              ordered(a.model, b.model, ["gpt-6-astra", "gpt-5.6-sol"]) ||
              ordered(a.effort, b.effort, [
                "pro",
                "heavy",
                "extra-high",
                "extended",
                "high",
                "standard",
                "light",
                "unknown",
              ]),
          ),
    dataWarnings: [
      ...new Map(
        dataWarnings.map((warning) => [
          JSON.stringify([
            warning.source,
            warning.code,
            "sessionId" in warning ? warning.sessionId : "",
          ]),
          warning,
        ]),
      ).values(),
    ].sort(
      (a, b) =>
        compare(a.source, b.source) ||
        compare(a.code, b.code) ||
        compare(
          "sessionId" in a ? a.sessionId : "",
          "sessionId" in b ? b.sessionId : "",
        ),
    ),
  };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function ordered(a: string, b: string, known: readonly string[]): number {
  const left = known.indexOf(a),
    right = known.indexOf(b);
  return (
    (left < 0 ? known.length : left) - (right < 0 ? known.length : right) ||
    compare(a, b)
  );
}
