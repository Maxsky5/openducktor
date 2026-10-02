import type { FileDiff } from "@openducktor/contracts";

/** A highlighted span of text. `end` is exclusive. */
export type HighlightRange = { start: number; end: number };

export type FileSearchMatch = {
  diff: FileDiff;
  /** Matched characters as ranges of `diff.file`. */
  ranges: readonly HighlightRange[];
};

export const NO_HIGHLIGHTS: readonly HighlightRange[] = [];

const WHITESPACE = /\s/u;

/** Removes whitespace and letter case. An empty query means that no search is active. */
export function toSearchQuery(text: string): string {
  let query = "";
  for (const character of text) {
    if (!WHITESPACE.test(character)) {
      query += character.toLowerCase();
    }
  }
  return query;
}

/** Keeps the files whose path matches the query, in their input order. */
export function searchFiles(fileDiffs: readonly FileDiff[], query: string): FileSearchMatch[] {
  if (query.length === 0) {
    return fileDiffs.map((diff) => ({ diff, ranges: NO_HIGHLIGHTS }));
  }
  const matches: FileSearchMatch[] = [];
  for (const diff of fileDiffs) {
    const ranges = matchPath(diff.file, query);
    if (ranges) {
      matches.push({ diff, ranges });
    }
  }
  return matches;
}

/** Clips the ranges to `[start, end)` of the source text and makes them relative to `start`. */
export function sliceRanges(
  ranges: readonly HighlightRange[],
  start: number,
  end: number,
): readonly HighlightRange[] {
  let sliced: HighlightRange[] | null = null;
  for (const range of ranges) {
    const clippedStart = Math.max(range.start, start);
    const clippedEnd = Math.min(range.end, end);
    if (clippedStart < clippedEnd) {
      sliced ??= [];
      sliced.push({ start: clippedStart - start, end: clippedEnd - start });
    }
  }
  return sliced ?? NO_HIGHLIGHTS;
}

/**
 * Finds the query characters in the path, in order, with a greedy leftmost scan.
 * Files under the same directory get the same ranges inside the directory path.
 */
function matchPath(path: string, query: string): readonly HighlightRange[] | null {
  const ranges: HighlightRange[] = [];
  let queryIndex = 0;
  let pathIndex = 0;
  for (const character of path) {
    if (queryIndex === query.length) {
      break;
    }
    const folded = character.toLowerCase();
    if (query.startsWith(folded, queryIndex)) {
      queryIndex += folded.length;
      const end = pathIndex + character.length;
      const previous = ranges.at(-1);
      if (previous?.end === pathIndex) {
        previous.end = end;
      } else {
        ranges.push({ start: pathIndex, end });
      }
    }
    pathIndex += character.length;
  }
  return queryIndex === query.length ? ranges : null;
}
