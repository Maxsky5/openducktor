import { describe, expect, test } from "bun:test";
import { matchedRanges, matchesQuery } from "../src/replica/palette/match";
import { type PaletteRow, QUERY, SEARCH_ROWS } from "../src/sample/palette";

type Range = { start: number; end: number };
type Searched = { label: string; keywords: readonly string[] };

// The imports are dynamic, so the site type check does not check the product source.
const commandPalette = (file: string): string =>
  new URL(`../../../packages/frontend/src/features/command-palette/${file}`, import.meta.url).href;
// SAFETY: command-palette-match-ranges.ts exports this function, and a missing export fails the test.
const product = (await import(commandPalette("command-palette-match-ranges.ts"))) as {
  matchedRanges: (text: string, query: string) => Range[];
};
// SAFETY: command-palette-search.ts exports this function, and a missing export fails the test.
const search = (await import(commandPalette("command-palette-search.ts"))) as {
  filterActions: <Item extends Searched>(items: readonly Item[], query: string) => Item[];
};

/** The text and the keywords of a row, as command-palette-search.ts gives them to cmdk. */
function searched(row: PaletteRow): Searched {
  if (row.kind === "task") return { label: row.title, keywords: [row.taskId] };
  return { label: row.kind === "chat" ? row.title : row.label, keywords: [] };
}

/** The queries that the scene types, one letter at a time. */
const TYPED = [...QUERY].map((_, index) => QUERY.slice(0, index + 1));
const ROWS = SEARCH_ROWS.map(searched);

describe("the palette search copied from the product", () => {
  test("each typed query finds the rows that the product finds", () => {
    for (const query of TYPED) {
      const found = ROWS.filter((row) => matchesQuery([row.label, ...row.keywords], query));
      expect(found.map((row) => row.label)).toEqual(
        search.filterActions(ROWS, query).map((row) => row.label),
      );
    }
  });

  test("each typed query marks the letters that the product marks", () => {
    for (const query of TYPED) {
      for (const text of ROWS.flatMap((row) => [row.label, ...row.keywords])) {
        expect(matchedRanges(text, query)).toEqual(product.matchedRanges(text, query));
      }
    }
  });
});
