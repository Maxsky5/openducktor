import { describe, expect, test } from "bun:test";
import type { GitFileDiff } from "@openducktor/contracts";
import type { InlineCommentDraft } from "./inline-comment-draft-store";
import {
  buildInlineCommentContext,
  inlineCommentMatchesLines,
  placeLocalComments,
} from "./inline-comment-placement";

const sideLines = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    lineNumber: index + 1,
    text: `line ${index + 1}`,
  }));

const draft = (
  id: string,
  text: string,
  overrides: Partial<InlineCommentDraft> = {},
): InlineCommentDraft => ({
  id,
  filePath: "src/app.ts",
  diffScope: "uncommitted",
  startLine: 2,
  endLine: 2,
  side: "new",
  text: "Check this",
  codeContext: [{ lineNumber: 2, text, isSelected: true }],
  language: "typescript",
  revision: 1,
  submissionId: null,
  createdAt: 1,
  updatedAt: 1,
  status: "pending",
  ...overrides,
});

describe("buildInlineCommentContext", () => {
  test("keeps two lines of context on each side of the selected lines", () => {
    expect(buildInlineCommentContext(sideLines(8), 4, 5)).toEqual([
      { lineNumber: 2, text: "line 2", isSelected: false },
      { lineNumber: 3, text: "line 3", isSelected: false },
      { lineNumber: 4, text: "line 4", isSelected: true },
      { lineNumber: 5, text: "line 5", isSelected: true },
      { lineNumber: 6, text: "line 6", isSelected: false },
      { lineNumber: 7, text: "line 7", isSelected: false },
    ]);
  });

  test("stops the context at the ends of the side", () => {
    expect(buildInlineCommentContext(sideLines(2), 1, 1)?.map((line) => line.lineNumber)).toEqual([
      1, 2,
    ]);
  });

  test("returns null when the side does not show a selected line", () => {
    expect(buildInlineCommentContext(sideLines(3), 2, 9)).toBeNull();
    expect(buildInlineCommentContext([], 1, 1)).toBeNull();
  });
});

describe("inlineCommentMatchesLines", () => {
  const textByLine = new Map([
    [1, "one"],
    [2, "two"],
  ]);

  test("matches only while the selected lines hold the captured text", () => {
    expect(inlineCommentMatchesLines(textByLine, draft("same", "two"))).toBe(true);
    expect(inlineCommentMatchesLines(textByLine, draft("changed", "edited two"))).toBe(false);
  });

  test("matches a comment without selected lines when both of its ends exist", () => {
    const comment = { startLine: 1, endLine: 2, codeContext: [] };
    expect(inlineCommentMatchesLines(textByLine, comment)).toBe(true);
    expect(inlineCommentMatchesLines(textByLine, { ...comment, endLine: 3 })).toBe(false);
  });
});

const fileDiff = (diff: string, file = "src/app.ts"): GitFileDiff => ({
  file,
  type: "modified",
  additions: 1,
  deletions: 1,
  diff,
});

/** A diff holds a comment when its text holds each selected line. */
const holdsText = (diff: GitFileDiff, comment: InlineCommentDraft): boolean =>
  comment.codeContext.every((line) => !line.isSelected || diff.diff.includes(`+${line.text}\n`));

describe("placeLocalComments", () => {
  test("shows a comment of a partly staged file once, in the group that holds its line", () => {
    const placed = placeLocalComments(
      [draft("staged-line", "staged two")],
      [
        { group: "unstaged", fileDiffs: [fileDiff("+unstaged two\n")] },
        { group: "staged", fileDiffs: [fileDiff("+staged two\n")] },
      ],
      holdsText,
    );

    expect(placed.unstaged.size).toBe(0);
    expect(placed.staged.get("src/app.ts")?.map((comment) => comment.id)).toEqual(["staged-line"]);
  });

  test("keeps a comment whose line changed in the first group with the file", () => {
    const placed = placeLocalComments(
      [draft("moved", "line that no longer exists")],
      [
        { group: "unstaged", fileDiffs: [fileDiff("+edited two\n")] },
        { group: "staged", fileDiffs: [fileDiff("+staged two\n")] },
      ],
      holdsText,
    );

    expect(placed.unstaged.get("src/app.ts")?.map((comment) => comment.id)).toEqual(["moved"]);
    expect(placed.staged.size).toBe(0);
  });

  test("gives a file in one group its comments without a text check", () => {
    const placed = placeLocalComments(
      [draft("only", "two")],
      [{ group: "unstaged", fileDiffs: [fileDiff("+two\n")] }],
      () => {
        throw new Error("A file in one group needs no text check.");
      },
    );

    expect(placed.unstaged.get("src/app.ts")?.map((comment) => comment.id)).toEqual(["only"]);
  });

  test("ignores Branch changes comments and files outside the groups", () => {
    const placed = placeLocalComments(
      [
        draft("target", "staged two", { diffScope: "target" }),
        draft("other", "x", { filePath: "other.ts" }),
      ],
      [{ group: "staged", fileDiffs: [fileDiff("+staged two\n")] }],
      holdsText,
    );

    expect(placed.staged.size).toBe(0);
    expect(placed.unstaged.size).toBe(0);
    expect(placed.conflicted.size).toBe(0);
  });
});
