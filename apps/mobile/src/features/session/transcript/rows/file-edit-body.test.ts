import { describe, expect, test } from "bun:test";
import { fileEditBody } from "./file-edit-body";

const lines = (body: ReturnType<typeof fileEditBody>) =>
  body?.kind === "diff"
    ? body.rows.flatMap((row) => (row.kind === "line" ? [[row.change, row.text]] : []))
    : null;

describe("file edit card body", () => {
  test("shows a Claude Write call as its write input", () => {
    expect(
      fileEditBody({
        kind: "write-input",
        filePath: "src/a.ts",
        content: "export const a = 1;\n",
        additions: 0,
        deletions: 0,
      }),
    ).toEqual({ kind: "content", label: "Write input", content: "export const a = 1;\n" });
  });

  test("shows a Claude Edit call as an edit fragment of removed and added lines", () => {
    const body = fileEditBody({
      kind: "replacement",
      filePath: "src/a.ts",
      oldContent: "const a = 1;",
      newContent: "const a = 2;",
      changeType: "modified",
      additions: 0,
      deletions: 0,
    });
    expect(body?.label).toBe("Edit fragment");
    expect(lines(body)).toEqual([
      ["delete", "const a = 1;"],
      ["add", "const a = 2;"],
    ]);
  });

  test("shows a diff as its rows and a path-only edit as no body", () => {
    const body = fileEditBody({
      kind: "diff",
      filePath: "a.txt",
      diff: "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n",
      additions: 1,
      deletions: 1,
    });
    expect(body?.label).toBeNull();
    expect(lines(body)).toEqual([
      ["delete", "old"],
      ["add", "new"],
    ]);
    expect(
      fileEditBody({ kind: "path", filePath: "a.txt", additions: 0, deletions: 0 }),
    ).toBeNull();
  });
});
