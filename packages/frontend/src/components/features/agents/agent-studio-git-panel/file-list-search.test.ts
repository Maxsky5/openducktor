import { describe, expect, test } from "bun:test";
import type { FileDiff } from "@openducktor/contracts";
import { NO_HIGHLIGHTS, searchFiles, sliceRanges, toSearchQuery } from "./file-list-search";

const fileDiff = (file: string): FileDiff => ({
  file,
  type: "modified",
  additions: 1,
  deletions: 1,
  diff: "@@ -1 +1 @@\n-old\n+new\n",
});

const rangesFor = (path: string, query: string) =>
  searchFiles([fileDiff(path)], query)[0]?.ranges ?? null;

describe("toSearchQuery", () => {
  test("removes whitespace and letter case", () => {
    expect(toSearchQuery("  Next Config\t")).toBe("nextconfig");
  });

  test("returns an empty query for blank text", () => {
    expect(toSearchQuery("   ")).toBe("");
  });
});

describe("searchFiles", () => {
  test("matches query characters in order with other characters between them", () => {
    expect(rangesFor("apps/storefront/next.config.ts", "sfcfg")).toEqual([
      { start: 3, end: 4 },
      { start: 10, end: 11 },
      { start: 21, end: 22 },
      { start: 24, end: 25 },
      { start: 26, end: 27 },
    ]);
  });

  test("ignores letter case and merges adjacent characters", () => {
    expect(rangesFor("docs/README.md", "readme")).toEqual([{ start: 5, end: 11 }]);
  });

  test("drops a file when a character is missing or out of order", () => {
    expect(rangesFor("src/main.ts", "mainz")).toBeNull();
    expect(rangesFor("src/main.ts", "tsmain")).toBeNull();
  });

  test("keeps ranges on whole characters outside the basic plane", () => {
    expect(rangesFor("docs/🦆-notes.md", "🦆n")).toEqual([
      { start: 5, end: 7 },
      { start: 8, end: 9 },
    ]);
  });

  test("keeps every file with no highlight when the query is empty", () => {
    const fileDiffs = [fileDiff("b.ts"), fileDiff("a.ts")];
    const matches = searchFiles(fileDiffs, "");

    expect(matches.map((match) => match.diff)).toEqual(fileDiffs);
    expect(matches.every((match) => match.ranges === NO_HIGHLIGHTS)).toBe(true);
  });

  test("keeps the input order of the matching files", () => {
    const matches = searchFiles(
      [fileDiff("src/zeta.ts"), fileDiff("docs/guide.md"), fileDiff("src/alpha.ts")],
      "srcts",
    );

    expect(matches.map((match) => match.diff.file)).toEqual(["src/zeta.ts", "src/alpha.ts"]);
  });
});

describe("sliceRanges", () => {
  test("clips ranges to the shown text and makes them relative to it", () => {
    expect(
      sliceRanges(
        [
          { start: 0, end: 2 },
          { start: 3, end: 6 },
          { start: 8, end: 9 },
        ],
        4,
        8,
      ),
    ).toEqual([{ start: 0, end: 2 }]);
  });

  test("returns the shared empty array when no range is in the shown text", () => {
    expect(sliceRanges([{ start: 0, end: 2 }], 2, 5)).toBe(NO_HIGHLIGHTS);
  });
});
