export type MatchedRange = { start: number; end: number };

/**
 * The parts of `text` that the words of `query` find, in order and without overlap. This only
 * shows why a row matched: the ranking uses the cmdk scorer, which also accepts scattered letters.
 */
export const matchedRanges = (text: string, query: string): MatchedRange[] => {
  const lowerText = text.toLowerCase();
  const ranges: MatchedRange[] = [];
  for (const word of query.toLowerCase().split(/\s+/)) {
    if (!word) continue;
    const start = findWord(lowerText, word);
    if (start >= 0) ranges.push({ start, end: start + word.length });
  }
  ranges.sort((left, right) => left.start - right.start);
  const merged: MatchedRange[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
};

const isWordCharacter = (character: string | undefined): boolean =>
  character !== undefined && /[\p{L}\p{N}]/u.test(character);

/** The first place of `word` in `text` that starts a word, else its first place, else -1. */
const findWord = (text: string, word: string): number => {
  const first = text.indexOf(word);
  for (let index = first; index >= 0; index = text.indexOf(word, index + 1)) {
    if (!isWordCharacter(text[index - 1])) return index;
  }
  return first;
};
