import { HTTP_URL, URL_BARE_END_MARKS, URL_BRACKETS, URL_END_MARKS } from "./constants";

export type UrlMatch = {
  end: number;
  start: number;
  url: string;
};

export const checkHttpUrl = (text: string): string | null => {
  if (text.length === 0 || text.trim() !== text) return null;
  if (hasControlChar(text)) return null;
  if (/%(?![\da-f]{2})/iu.test(text)) return null;

  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.hostname.length === 0) return null;
    return text;
  } catch {
    return null;
  }
};

export const findHttpUrls = (text: string): UrlMatch[] => {
  const matches: UrlMatch[] = [];
  for (const match of text.matchAll(HTTP_URL)) {
    if (match.index === undefined) continue;
    const urlText = trimUrlEnd(match[0]);
    const url = checkHttpUrl(urlText);
    if (!url) continue;
    matches.push({ start: match.index, end: match.index + urlText.length, url });
  }
  return matches;
};

function countChar(value: string, char: string): number {
  let count = 0;
  for (const item of value) {
    if (item === char) count += 1;
  }
  return count;
}

function hasControlChar(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code !== undefined && (code <= 31 || code === 127)) return true;
  }
  return false;
}

function trimUrlEnd(text: string): string {
  let end = text.length;
  while (end > 0) {
    const last = text[end - 1];
    if (!last) break;
    if (URL_END_MARKS.has(last) || (URL_BARE_END_MARKS.has(last) && !hasUrlBody(text, end))) {
      end -= 1;
      continue;
    }

    const open = URL_BRACKETS.get(last);
    if (!open) break;
    const url = text.slice(0, end);
    if (countChar(url, last) <= countChar(url, open)) break;
    end -= 1;
  }
  return text.slice(0, end);
}

function hasUrlBody(text: string, end: number): boolean {
  const schemeEnd = text.indexOf("://") + 3;
  return /[/?#]/u.test(text.slice(schemeEnd, end - 1));
}
