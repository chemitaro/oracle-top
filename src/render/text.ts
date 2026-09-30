import type { DashboardSnapshot } from "../model/dashboard.js";
import { displayWidth, truncateText, sanitizeText } from "./width.js";
export interface Viewport {
  columns: number;
  rows: number;
}
const currentHeader = [
  "STATUS",
  "ELAPSED",
  "PROJECT",
  "SESSION / SLUG",
  "MODEL",
  "EFFORT",
];
const usageHeader = ["MODEL", "EFFORT", "24H", "7D"];
export function renderText(
  snapshot: DashboardSnapshot,
  viewport?: Viewport,
): string {
  if (viewport && (viewport.columns <= 1 || viewport.rows <= 1)) return "";
  const capacity = snapshot.browserCapacity;
  const reliability = snapshot.reliability24h;
  const currentValues = (snapshot.currentSessions ?? []).map((row) =>
    [
      row.status,
      elapsed(row.elapsedMs),
      row.project,
      row.slug,
      row.model,
      row.effort,
    ].map(sanitizeText),
  );
  const usageValues = (snapshot.submittedMessages ?? []).map((row) =>
    [
      row.model,
      row.effort,
      String(row.submitted24h),
      String(row.submitted7d),
    ].map(sanitizeText),
  );
  const currentWidths = widths(currentHeader, currentValues);
  const usageWidths = widths(usageHeader, usageValues);
  const needed =
    currentWidths[0]! +
    currentWidths[1]! +
    1 +
    1 +
    currentWidths[4]! +
    currentWidths[5]! +
    15;
  const requiredColumns = Math.max(
    80,
    needed + 1,
    usageWidths.reduce((a, b) => a + b, 0) + 10,
  );
  if (viewport) {
    const available = Math.max(0, viewport.columns - 1);
    if (available === 0) return "";
    if (viewport.columns < requiredColumns)
      return sizeMessage(
        `Terminal too narrow: need ${requiredColumns} columns. Use oracle-top snapshot.`,
        available,
      );
    const flexible = available - (needed - 2);
    let project = Math.min(currentWidths[2]!, Math.ceil(flexible / 2));
    const slug = Math.min(currentWidths[3]!, flexible - project);
    project = Math.min(currentWidths[2]!, flexible - slug);
    currentWidths[2] = project;
    currentWidths[3] = slug;
  }
  const currents =
    snapshot.currentSessions === null
      ? ["Current sessions unavailable"]
      : currentValues.length === 0
        ? ["No current sessions"]
        : currentValues;
  const submitted =
    snapshot.submittedMessages === null
      ? ["Submitted messages unavailable"]
      : usageValues.length === 0
        ? ["No submitted messages"]
        : usageValues;
  let top = [
    `ORACLE TOP   ${localClock(snapshot.generatedAt)}`,
    `Browser slots (stored): ${capacity.active ?? "N/A"} / ${capacity.maximum}  ${percent(capacity.utilization)}     Current sessions: ${snapshot.currentSessions?.length ?? "N/A"}`,
    "",
    "CURRENT SESSIONS",
    tableLine(currentHeader, currentWidths),
  ];
  let middle = [
    "",
    "RELIABILITY — ROLLING 24 HOURS",
    `completed ${reliability?.completed ?? "N/A"}   partial ${reliability?.partial ?? "N/A"}   error ${reliability?.error ?? "N/A"}   cancelled ${reliability?.cancelled ?? "N/A"}   evaluated ${reliability?.evaluated ?? "N/A"}`,
    `success ${percent(reliability?.successRate ?? null)}`,
    "",
    "SUBMITTED MESSAGES BY MODEL / EFFORT",
    tableLine(usageHeader, usageWidths),
  ];
  let bottom = [
    "",
    "Oracle-only submission-operation counts; direct ChatGPT usage is excluded.",
    "Requested model/effort. Slots: selected profile; sessions: selected home.",
    ...(snapshot.dataWarnings.length > 0
      ? [
          "Values from readable records only",
          ...(viewport
            ? [
                `Warnings (${snapshot.dataWarnings.length}): use oracle-top snapshot`,
              ]
            : snapshot.dataWarnings.map(
                (warning) =>
                  `${warning.source} ${warning.code}${"sessionId" in warning ? ` ${warning.sessionId}` : ""}`,
              )),
        ]
      : []),
  ];
  if (!viewport)
    return [
      ...top,
      ...currents.map((row) =>
        typeof row === "string" ? row : tableLine(row, currentWidths),
      ),
      ...middle,
      ...submitted.map((row) =>
        typeof row === "string" ? row : tableLine(row, usageWidths),
      ),
      ...bottom,
    ]
      .map(sanitizeText)
      .join("\n");
  const columns = viewport.columns - 1;
  top = top.flatMap((line) => wrapLine(line, columns));
  middle = middle.flatMap((line) => wrapLine(line, columns));
  bottom = bottom.flatMap((line) => wrapLine(line, columns));
  const fixed = top.length + middle.length + bottom.length;
  const availableRows = Math.max(0, viewport.rows - 1);
  if (availableRows === 0) return "";
  const body = availableRows - fixed;
  if (body < 2)
    return sizeMessage(
      `Terminal too short: need ${fixed + 3} rows. Use oracle-top snapshot.`,
      viewport.columns - 1,
    );
  let currentBudget = Math.min(currents.length, Math.ceil(body / 2));
  let usageBudget = Math.min(submitted.length, Math.floor(body / 2));
  let unused = body - currentBudget - usageBudget;
  const extraCurrent = Math.min(unused, currents.length - currentBudget);
  currentBudget += extraCurrent;
  unused -= extraCurrent;
  usageBudget += Math.min(unused, submitted.length - usageBudget);
  return [
    ...top,
    ...limited(currents, currentBudget).map((row) =>
      typeof row === "string" ? row : tableLine(row, currentWidths),
    ),
    ...middle,
    ...limited(submitted, usageBudget).map((row) =>
      typeof row === "string" ? row : tableLine(row, usageWidths),
    ),
    ...bottom,
  ]
    .map(sanitizeText)
    .join("\n");
}
function widths(header: readonly string[], rows: string[][]): number[] {
  return header.map((value, index) => {
    let width = displayWidth(value);
    for (const row of rows) width = Math.max(width, displayWidth(row[index]!));
    return width;
  });
}
function tableLine(values: readonly string[], sizes: number[]): string {
  return values
    .map((value, index) => {
      const text = truncateText(value, sizes[index]!);
      return text + " ".repeat(sizes[index]! - displayWidth(text));
    })
    .join(" | ");
}
function sizeMessage(message: string, available: number): string {
  return displayWidth(message) <= available ? message : "!";
}
function percent(ratio: number | null): string {
  return ratio === null ? "N/A" : `${(ratio * 100).toFixed(1)}%`;
}
function elapsed(ms: number | null): string {
  if (ms === null) return "N/A";
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function limited(
  rows: (string | string[])[],
  budget: number,
): (string | string[])[] {
  return rows.length <= budget
    ? rows
    : [
        ...rows.slice(0, Math.max(0, budget - 1)),
        `... ${rows.length - Math.max(0, budget - 1)} more; use oracle-top snapshot`,
      ];
}

function wrapLine(value: string, columns: number): string[] {
  if (displayWidth(value) <= columns) return [value];
  const result: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/u)) {
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (displayWidth(candidate) > columns) {
      if (line) result.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) result.push(line);
  return result;
}

function localClock(value: string): string {
  const date = new Date(value);
  const pad = (number: number) => String(number).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const absolute = Math.abs(offset);
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} GMT${offset >= 0 ? "+" : "-"}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}
