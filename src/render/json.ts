import type { DashboardSnapshot } from "../model/dashboard.js";
export function serializeJson(snapshot: DashboardSnapshot): string {
  return JSON.stringify(snapshot).replace(
    /[\u007f-\u009f\u2028\u2029\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
