import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { MatchedText, matchedRanges } from "./command-palette-match";

describe("matched text", () => {
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

  test("keeps the full text and marks only the matched parts", () => {
    const { container } = render(<MatchedText text="Add Facebook login" query="FACE login" />);

    expect(container.textContent).toBe("Add Facebook login");
    expect([...container.querySelectorAll("mark")].map((mark) => mark.textContent)).toEqual([
      "Face",
      "login",
    ]);
  });
});
