"use client";

/**
 * Chart data export utilities — download analysis results as CSV or JSON files.
 */

/** Download any text content as a file. */
export function downloadFile(content: string, filename: string, mimeType: string = "text/plain") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Convert an array of objects to CSV. */
export function objectsToCSV(data: Record<string, unknown>[]): string {
  if (!data || data.length === 0) return "";
  const headers = Object.keys(data[0]);
  const escapeCell = (val: unknown): string => {
    if (val == null) return "";
    const s = typeof val === "object" ? JSON.stringify(val) : String(val);
    // Escape quotes and wrap in quotes if contains comma/quote/newline
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [
    headers.join(","),
    ...data.map((row) => headers.map((h) => escapeCell(row[h])).join(",")),
  ];
  return lines.join("\n");
}

/** Export chart data as JSON. */
export function exportJSON(data: unknown, chartName: string, pdbId?: string) {
  const filename = `${chartName}-${pdbId ?? "data"}-${Date.now()}.json`;
  const content = JSON.stringify(data, null, 2);
  downloadFile(content, filename, "application/json");
}

/** Export chart data as CSV (array of objects). */
export function exportCSV(
  data: Record<string, unknown>[],
  chartName: string,
  pdbId?: string
) {
  const filename = `${chartName}-${pdbId ?? "data"}-${Date.now()}.csv`;
  const content = objectsToCSV(data);
  downloadFile(content, filename, "text/csv");
}

/** Flatten a nested object into a single-level object for CSV export. */
export function flattenObject(
  obj: Record<string, unknown>,
  prefix: string = ""
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, newKey));
    } else if (Array.isArray(value)) {
      result[newKey] = value.join("; ");
    } else {
      result[newKey] = value;
    }
  }
  return result;
}
