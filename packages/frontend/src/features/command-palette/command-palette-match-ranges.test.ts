import { describe, expect, test } from "bun:test";
import { matchedRanges } from "./command-palette-match-ranges";

describe("matchedRanges", () => {
  test("marks each query word, at a word start before any other place", () => {
    expect(matchedRanges("Add Facebook login", "face")).toEqual([{ start: 4, end: 8 }]);
    expect(matchedRanges("Reload data, load tasks", "load")).toEqual([{ start: 13, end: 17 }]);
    expect(matchedRanges("Reload data", "load")).toEqual([{ start: 2, end: 6 }]);
    expect(matchedRanges("Import chat from an external runtime", "runtime import")).toEqual([
      { start: 0, end: 6 },
      { start: 29, end: 36 },
    ]);
  });

  test("joins overlapping words and ignores words that are not in the text", () => {
    expect(matchedRanges("Settings: Kanban", "set settings zzz")).toEqual([{ start: 0, end: 8 }]);
    expect(matchedRanges("New task", "  ")).toEqual([]);
    expect(matchedRanges("New task", "nt")).toEqual([]);
  });
});
