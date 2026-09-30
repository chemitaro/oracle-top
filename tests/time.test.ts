import { expect, test } from "vitest";
import { parseIsoTimestamp } from "../src/model/time.js";

test("parses-timezone-qualified-iso", () => {
  expect(parseIsoTimestamp("2026-09-30T15:00:00+09:00")).toBe(1790748000000);
});

test("rejects-invalid-iso-and-calendar-dates", () => {
  for (const value of [
    "2026-02-30T00:00:00Z",
    "2026-09-30",
    "2026-09-30T06:00:00",
    "2026-09-30T24:00:00Z",
    "2026-09-30T06:00:60Z",
    "2026-09-30T06:00:00.1234Z",
    "0000-01-01T00:00:00Z",
    "2026-09-30T06:00:00+24:00",
    "2026-09-30T06:00:00+00:60",
    "2026-13-01T00:00:00Z",
    " 2026-09-30T06:00:00Z",
    "2026-09-30T06:00:00z",
    null,
    1790748000000,
  ]) {
    expect(parseIsoTimestamp(value)).toBeNull();
  }
});

test("preserves-early-years-fractions-and-leap-rules", () => {
  for (const value of [
    "0001-01-01T00:00:00.000Z",
    "0099-01-01T00:00:00.000Z",
    "2000-02-29T00:00:00.000Z",
  ]) {
    expect(new Date(parseIsoTimestamp(value)!).toISOString()).toBe(value);
  }
  expect(parseIsoTimestamp("1900-02-29T00:00:00Z")).toBeNull();
  expect(parseIsoTimestamp("2026-09-30T06:00:00.1Z")).toBe(1790748000100);
  expect(parseIsoTimestamp("2026-09-30T06:00:00.12Z")).toBe(1790748000120);
  expect(parseIsoTimestamp("2026-09-30T06:00:00.123Z")).toBe(1790748000123);
  expect(parseIsoTimestamp("2026-09-30T00:00:00+23:59")).toBe(1790640060000);
});
