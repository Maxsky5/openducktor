export type TerminalUrlMatch = {
  end: number;
  start: number;
  url: string;
};

const HTTP_URL_CANDIDATE = /https?:\/\/[^\s<>"'`|]+/giu;
const TRAILING_SENTENCE_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?"]);
const CLOSING_BRACKETS = new Map([
  [")", "("],
  ["]", "["],
  ["}", "{"],
]);

const countCharacter = (value: string, character: string): number => {
  let count = 0;
  for (const current of value) {
    if (current === character) count += 1;
  }
  return count;
};

const containsControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127)) return true;
  }
  return false;
};

const trimCandidateEnd = (candidate: string): string => {
  let end = candidate.length;
  while (end > 0) {
    const last = candidate[end - 1];
    if (!last) break;
    if (TRAILING_SENTENCE_PUNCTUATION.has(last)) {
      end -= 1;
      continue;
    }

    const opening = CLOSING_BRACKETS.get(last);
    if (!opening) break;
    const current = candidate.slice(0, end);
    if (countCharacter(current, last) <= countCharacter(current, opening)) break;
    end -= 1;
  }
  return candidate.slice(0, end);
};

export const validateTerminalHttpUrl = (candidate: string): string | null => {
  if (candidate.length === 0 || candidate.trim() !== candidate) return null;
  if (containsControlCharacter(candidate)) return null;
  if (/%(?![\da-f]{2})/iu.test(candidate)) return null;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.hostname.length === 0) return null;
    return candidate;
  } catch {
    return null;
  }
};

export const findTerminalHttpUrls = (text: string): TerminalUrlMatch[] => {
  const matches: TerminalUrlMatch[] = [];
  HTTP_URL_CANDIDATE.lastIndex = 0;
  for (const match of text.matchAll(HTTP_URL_CANDIDATE)) {
    if (match.index === undefined) continue;
    const candidate = trimCandidateEnd(match[0]);
    const url = validateTerminalHttpUrl(candidate);
    if (!url) continue;
    matches.push({ start: match.index, end: match.index + candidate.length, url });
  }
  return matches;
};
