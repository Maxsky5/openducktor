// The search of the command palette. Sources: command-palette-match-ranges.ts for the marks, and
// the cmdk scorer that the palette uses to keep a row: every letter of each word of the query
// shows in the row text, in order.

export type MatchedRange = { start: number; end: number };

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

const letterScore = (text: string, from: number, index: number): number => {
  if (index === from) return NEXT_LETTER_SCORE;
  if (!isWordCharacter(text[index - 1])) return WORD_START_SCORE;
  return INSIDE_WORD_SCORE * SKIPPED_LETTER_PENALTY ** (index - from);
};

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

const words = (query: string): string[] => query.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * The parts of `text` that the words of `query` find, in order and without overlap. A word that
 * the text does not contain whole marks its scattered letters, as the cmdk scorer accepts them.
 */
export function matchedRanges(text: string, query: string): MatchedRange[] {
  const lowerText = text.toLowerCase();
  const ranges: MatchedRange[] = [];
  for (const word of words(query)) {
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
}

/** True when each word of `query` shows in one of `texts`, letter by letter and in order. */
export function matchesQuery(texts: readonly string[], query: string): boolean {
  return words(query).every((word) =>
    texts.some((text) => scatteredLetters(text.toLowerCase(), word) !== null),
  );
}

/** A part of a text, marked when the query finds it. */
export type Segment = { text: string; marked: boolean };

/** The text cut into the parts that the query finds and the parts between them. */
export function segments(text: string, query: string): Segment[] {
  const parts: Segment[] = [];
  let from = 0;
  for (const range of matchedRanges(text, query)) {
    if (range.start > from) parts.push({ text: text.slice(from, range.start), marked: false });
    parts.push({ text: text.slice(range.start, range.end), marked: true });
    from = range.end;
  }
  if (from < text.length) parts.push({ text: text.slice(from), marked: false });
  return parts;
}
