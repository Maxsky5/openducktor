import { z } from "zod";

const TRUNCATED_RESULT_PREFIX = '{"content":[{"type":"text","text":"';
const TRUNCATION_MARKER = /…\d+ chars truncated…/;
const ESCAPED_LINE_BREAK_PATTERN = /\\[nr]/;
const jsonStringSchema = z.string();

export type CodexTruncatedResult =
  | { kind: "not_truncated" }
  | { kind: "truncated"; head: string | null };

export const readCodexTruncatedResult = (text: string): CodexTruncatedResult => {
  if (!text.startsWith(TRUNCATED_RESULT_PREFIX) || !TRUNCATION_MARKER.test(text)) {
    return { kind: "not_truncated" };
  }
  const fragment = text.slice(TRUNCATED_RESULT_PREFIX.length);
  const headEnd = firstMatchIndex(fragment, [ESCAPED_LINE_BREAK_PATTERN, TRUNCATION_MARKER]);
  const head = headEnd === -1 ? fragment : fragment.slice(0, headEnd);
  return { kind: "truncated", head: decodeJsonStringFragment(head) };
};

const firstMatchIndex = (text: string, patterns: RegExp[]): number => {
  let earliest = -1;
  for (const pattern of patterns) {
    const index = text.search(pattern);
    if (index >= 0 && (earliest === -1 || index < earliest)) {
      earliest = index;
    }
  }
  return earliest;
};

const decodeJsonStringFragment = (fragment: string): string | null => {
  try {
    return jsonStringSchema.parse(JSON.parse(`"${fragment}"`));
  } catch {
    return null;
  }
};
