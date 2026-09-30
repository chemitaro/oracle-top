import stringWidth from "string-width";
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function displayWidth(value: string): number {
  return stringWidth(value);
}
export function sanitizeText(value: string): string {
  return value.replace(
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,
    " ",
  );
}
export function truncateText(value: string, columns: number): string {
  if (columns <= 0) return "";
  if (displayWidth(value) <= columns) return value;
  let result = "";
  let used = 0;
  for (const { segment } of segmenter.segment(value)) {
    const width = displayWidth(segment);
    if (used + width > columns - 1) break;
    result += segment;
    used += width;
  }
  return result + "…";
}
