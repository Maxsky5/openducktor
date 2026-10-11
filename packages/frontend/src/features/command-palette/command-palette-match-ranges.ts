export type MatchedRange = { start: number; end: number };

/**
 * The parts of `text` that the words of `query` find, in order and without overlap. A word that
 * the text does not contain whole marks its scattered letters, as the cmdk scorer accepts them.
 */
export const matchedRanges = (text: string, query: string): MatchedRange[] => {
  const lowerText = text.toLowerCase();
  const ranges: MatchedRange[] = [];
  for (const word of query.toLowerCase().split(/\s+/)) {
    if (!word) continue;
    const start = findWord(lowerText, word);
    if (start >= 0) ranges.push({ start, end: start + word.length });
    else
      for (const index of scatteredLetters(lowerText, word) ?? [])
        ranges.push({ start: index, end: index + 1 });
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

type ScatteredMatch = { score: number; indexes: number[] };

// The cmdk scorer weights for the place of the next letter.
const NEXT_LETTER_SCORE = 1;
const WORD_START_SCORE = 0.9;
const INSIDE_WORD_SCORE = 0.17;
const SKIPPED_LETTER_PENALTY = 0.999;

/**
 * The places of the letters of `word` in `text`, in order, with the best cmdk score, or null.
 * The score prefers letters that follow each other, then letters at a word start.
 */
const scatteredLetters = (text: string, word: string): number[] | null => {
  const best: (ScatteredMatch | null | undefined)[] = [];
  const bestFrom = (textIndex: number, wordIndex: number): ScatteredMatch | null => {
    if (wordIndex === word.length) return { score: 1, indexes: [] };
    const key = wordIndex * (text.length + 1) + textIndex;
    const known = best[key];
    if (known !== undefined) return known;
    let found: ScatteredMatch | null = null;
    const letter = word.charAt(wordIndex);
    for (
      let index = text.indexOf(letter, textIndex);
      index >= 0;
      index = text.indexOf(letter, index + 1)
    ) {
      const rest = bestFrom(index + 1, wordIndex + 1);
      // A later place leaves fewer letters, so it cannot match the rest either.
      if (!rest) break;
      const score = rest.score * letterScore(text, textIndex, index);
      if (!found || score > found.score) found = { score, indexes: [index, ...rest.indexes] };
    }
    best[key] = found;
    return found;
  };
  return bestFrom(0, 0)?.indexes ?? null;
};

const letterScore = (text: string, from: number, index: number): number => {
  if (index === from) return NEXT_LETTER_SCORE;
  if (!isWordCharacter(text[index - 1])) return WORD_START_SCORE;
  return INSIDE_WORD_SCORE * SKIPPED_LETTER_PENALTY ** (index - from);
};
