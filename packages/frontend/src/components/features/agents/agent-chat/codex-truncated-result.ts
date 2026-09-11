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
  const head = cutAtFirstMatch(fragment, [ESCAPED_LINE_BREAK_PATTERN, TRUNCATION_MARKER]);
  return { kind: "truncated", head: decodeJsonStringFragment(head) };
};

const cutAtFirstMatch = (text: string, patterns: RegExp[]): string => {
  const indexes = patterns.map((pattern) => text.search(pattern)).filter((index) => index >= 0);
  return text.slice(0, Math.min(...indexes, text.length));
};

const decodeJsonStringFragment = (fragment: string): string | null => {
  try {
    return jsonStringSchema.parse(JSON.parse(`"${fragment}"`));
  } catch {
    return null;
  }
};
