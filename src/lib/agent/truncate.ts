/**
 * R169 (AGENT-L6): marked string truncation for tool results fed to the LLM.
 *
 * The previous `JSON.stringify(x).slice(0, N)` cut arbitrarily mid-JSON (and
 * could split a surrogate pair) with NO truncation marker — the model received
 * unparseable JSON and had no signal that data was cut. Every LLM-visible
 * truncation now appends an explicit marker.
 */

export function truncateMarked(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  // Avoid splitting a UTF-16 surrogate pair at the boundary.
  const boundaryChar = s.charCodeAt(maxLen - 1);
  const cut =
    boundaryChar >= 0xd800 && boundaryChar <= 0xdbff ? maxLen - 1 : maxLen;
  return s.slice(0, Math.max(cut, 0)) + "…(truncated)";
}
