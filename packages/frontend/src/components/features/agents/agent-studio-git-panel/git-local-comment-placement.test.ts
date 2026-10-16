import { describe, expect, test } from "bun:test";
import type { GitFileDiff } from "@openducktor/contracts";
import type { InlineCommentDraft } from "@/state/use-inline-comment-draft-store";
import { placeLocalComments } from "./git-local-comment-placement";

const patch = (oldLine: string, newLine: string): string =>
  [
    "diff --git a/src/app.ts b/src/app.ts",
    "index 1111111..2222222 100644",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,3 +1,3 @@",
    " one",
    `-${oldLine}`,
    `+${newLine}`,
    " three",
    "",
  ].join("\n");

const fileDiff = (diff: string): GitFileDiff => ({
  file: "src/app.ts",
  type: "modified",
  additions: 1,
  deletions: 1,
  diff,
});

const draft = (id: string, text: string, scope: InlineCommentDraft["diffScope"] = "uncommitted") =>
  ({
    id,
    filePath: "src/app.ts",
    diffScope: scope,
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
  }) satisfies InlineCommentDraft;

describe("placeLocalComments", () => {
  test("shows a comment in the group whose diff still holds its line", () => {
    const placed = placeLocalComments(
      [draft("staged-line", "staged two")],
      [
        { group: "unstaged", fileDiffs: [fileDiff(patch("staged two", "unstaged two"))] },
        { group: "staged", fileDiffs: [fileDiff(patch("two", "staged two"))] },
      ],
    );

    expect(placed.unstaged.size).toBe(0);
    expect(placed.staged.get("src/app.ts")?.map((comment) => comment.id)).toEqual(["staged-line"]);
  });

  test("keeps a comment whose line changed visible in the first group with the file", () => {
    const placed = placeLocalComments(
      [draft("moved", "line that no longer exists")],
      [
        { group: "unstaged", fileDiffs: [fileDiff(patch("two", "edited two"))] },
        { group: "staged", fileDiffs: [fileDiff(patch("two", "staged two"))] },
      ],
    );

    expect(placed.unstaged.get("src/app.ts")?.map((comment) => comment.id)).toEqual(["moved"]);
    expect(placed.staged.size).toBe(0);
  });

  test("ignores Branch changes comments and files outside the groups", () => {
    const placed = placeLocalComments(
      [draft("target", "staged two", "target"), { ...draft("other", "x"), filePath: "other.ts" }],
      [{ group: "staged", fileDiffs: [fileDiff(patch("two", "staged two"))] }],
    );

    expect(placed.staged.size).toBe(0);
    expect(placed.unstaged.size).toBe(0);
    expect(placed.conflicted.size).toBe(0);
  });
});
