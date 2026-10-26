import { describe, expect, test } from "bun:test";
import type { GitFileDiff } from "@openducktor/contracts";
import type { InlineCommentDraft } from "@openducktor/frontend-core/drafts/inline-comment-draft-store";
import { DIFF_HIGHLIGHT_LINE_LIMIT } from "@/rich-content/diff/diff-syntax";
import { buildDiffBody, type DiffBodyRow } from "./diff-body-model";
import { prepareFileDiff } from "./prepared-diff";

const fileDiff = (diff: string, file = "src/parse.ts"): GitFileDiff => ({
  file,
  type: "modified",
  additions: 1,
  deletions: 1,
  diff,
});

const PATCH = [
  "--- a/src/parse.ts",
  "+++ b/src/parse.ts",
  "@@ -1,3 +1,3 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  " const c = 4;",
  "",
].join("\n");

const comment = (overrides: Partial<InlineCommentDraft>): InlineCommentDraft => ({
  id: "comment-1",
  filePath: "src/parse.ts",
  diffScope: "uncommitted",
  startLine: 2,
  endLine: 2,
  side: "new",
  text: "Use a constant.",
  codeContext: [{ lineNumber: 2, text: "const b = 3;", isSelected: true }],
  language: "typescript",
  revision: 1,
  submissionId: null,
  status: "pending",
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const kinds = (rows: readonly DiffBodyRow[]): string[] =>
  rows.map((row) => {
    if (row.kind !== "diff") return row.kind;
    return row.row.kind === "line" ? `${row.row.change}:${row.row.text}` : row.row.kind;
  });

describe("prepared diffs", () => {
  test("parse once for each diff text, without the file row", () => {
    const prepared = prepareFileDiff(fileDiff(PATCH), "unstaged");
    expect(prepareFileDiff(fileDiff(PATCH), "unstaged")).toBe(prepared);
    expect(prepared.rows.some((row) => row.kind === "file")).toBe(false);
    expect(prepared.numberDigits).toBe(3);
    expect(prepared.syntax).not.toBeNull();
    expect(prepareFileDiff(fileDiff(`${PATCH}\n`), "unstaged")).not.toBe(prepared);
  });

  test("keep the diff of each group of a partly staged file", () => {
    const staged = PATCH.replace("+const b = 3;", "+const b = 5;");
    const unstagedFirst = prepareFileDiff(fileDiff(PATCH), "unstaged");
    const stagedFirst = prepareFileDiff(fileDiff(staged), "staged");
    expect(prepareFileDiff(fileDiff(PATCH), "unstaged")).toBe(unstagedFirst);
    expect(prepareFileDiff(fileDiff(staged), "staged")).toBe(stagedFirst);
  });

  test("highlight each line from its side of the diff", () => {
    const prepared = prepareFileDiff(fileDiff(PATCH), "unstaged");
    const lines = prepared.rows.flatMap((row) => (row.kind === "line" ? [row] : []));
    const removed = lines.find((row) => row.change === "delete");
    if (!removed) throw new Error("The patch has a removed line.");
    const tokens = prepared.syntax?.tokensFor(removed) ?? [];
    expect(tokens.map((token) => token.text).join("")).toBe("const b = 2;");
    expect(tokens.find((token) => token.text === "const")?.tone).toBe("keyword");
  });

  test("show plain text over the desktop highlight limit", () => {
    const body = Array.from(
      { length: DIFF_HIGHLIGHT_LINE_LIMIT + 1 },
      (_, index) => `+line ${index}`,
    );
    const big = [
      "--- a/src/big.ts",
      "+++ b/src/big.ts",
      `@@ -0,0 +1,${body.length} @@`,
      ...body,
    ].join("\n");
    expect(prepareFileDiff(fileDiff(big, "src/big.ts"), "unstaged").syntax).toBeNull();
  });
});

describe("diff body", () => {
  test("places a comment under its last line and closes the body", () => {
    const rows = buildDiffBody({
      fileKey: "f",
      path: "src/parse.ts",
      prepared: prepareFileDiff(fileDiff(PATCH), "unstaged"),
      comments: [comment({})],
      rowLimit: null,
      withEnd: true,
    });
    expect(kinds(rows)).toEqual([
      "hunk",
      "context:const a = 1;",
      "delete:const b = 2;",
      "add:const b = 3;",
      "comment",
      "context:const c = 4;",
      "end",
    ]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
    expect(rows.every((row) => row.key.startsWith("f|"))).toBe(true);
  });

  test("shows comments whose lines changed first, under a note", () => {
    const rows = buildDiffBody({
      fileKey: "f",
      path: "src/parse.ts",
      prepared: prepareFileDiff(fileDiff(PATCH), "unstaged"),
      comments: [
        comment({ codeContext: [{ lineNumber: 2, text: "const b = 9;", isSelected: true }] }),
      ],
      rowLimit: null,
      withEnd: false,
    });
    expect(kinds(rows).slice(0, 3)).toEqual(["unplaced", "comment", "hunk"]);
  });

  test("stops a long inline diff with the count of the hidden lines", () => {
    const rows = buildDiffBody({
      fileKey: "f",
      path: "src/parse.ts",
      prepared: prepareFileDiff(fileDiff(PATCH), "unstaged"),
      comments: [],
      rowLimit: 2,
      withEnd: true,
    });
    expect(kinds(rows)).toEqual(["hunk", "context:const a = 1;", "more", "end"]);
    expect(rows[2]).toMatchObject({ kind: "more", hiddenLines: 3 });
  });

  test("says that an added or deleted file is empty", () => {
    const emptyBody = (type: GitFileDiff["type"], header: string) =>
      buildDiffBody({
        fileKey: "f",
        path: "empty.txt",
        prepared: prepareFileDiff(
          { file: "empty.txt", type, additions: 0, deletions: 0, diff: header },
          "unstaged",
        ),
        comments: [],
        rowLimit: null,
        withEnd: false,
      });
    const added = [
      "diff --git a/empty.txt b/empty.txt",
      "new file mode 100644",
      "index 0000000..e69de29",
      "",
    ].join("\n");
    expect(emptyBody("added", added)).toMatchObject([{ message: "The new file is empty." }]);
    const deleted = added.replace("new file", "deleted file");
    expect(emptyBody("deleted", deleted)).toMatchObject([
      { message: "The deleted file was empty." },
    ]);
    const binary = `${added}Binary files /dev/null and b/empty.txt differ\n`;
    expect(kinds(emptyBody("added", binary))).toEqual(["note"]);
  });

  test("explains a change without text lines", () => {
    const rows = buildDiffBody({
      fileKey: "f",
      path: "logo.png",
      prepared: prepareFileDiff(
        { ...fileDiff("", "logo.png"), additions: 0, deletions: 0 },
        "unstaged",
      ),
      comments: [],
      rowLimit: null,
      withEnd: false,
    });
    expect(rows).toEqual([
      {
        kind: "no-text",
        key: "f|no-text",
        fileKey: "f",
        message: "No diff content available for logo.png",
      },
    ]);
  });
});
