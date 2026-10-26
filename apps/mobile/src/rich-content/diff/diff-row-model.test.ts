import { describe, expect, test } from "bun:test";
import {
  buildDiffRows,
  buildFileDiffRows,
  buildReplacementDiffRows,
  type DiffRow,
  diffLineTarget,
  diffNumberDigits,
  diffRowType,
} from "./diff-row-model";

const GIT_DIFF = [
  "diff --git a/src/app.ts b/src/app.ts",
  "index 1111111..2222222 100644",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,4 +1,5 @@ export function main() {",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " return a;",
  " }",
  "@@ -20,2 +21,2 @@",
  "-old();",
  "+next();",
  " end();",
  "diff --git a/README.md b/README.md",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/README.md",
  "@@ -0,0 +1 @@",
  "+# Title",
  "\\ No newline at end of file",
].join("\n");

const lineCells = (rows: DiffRow[]): Array<[string, string, number | null, number | null]> =>
  rows.flatMap((row) =>
    row.kind === "line" ? [[row.change, row.text, row.oldLine, row.newLine]] : [],
  );

describe("buildDiffRows", () => {
  test("numbers context, added, and deleted lines across hunks", () => {
    const rows = buildDiffRows(GIT_DIFF).filter((row) => row.fileIndex === 0);
    expect(rows[0]).toMatchObject({
      kind: "file",
      path: "src/app.ts",
      oldPath: "src/app.ts",
      newPath: "src/app.ts",
      status: "modified",
      additions: 3,
      deletions: 2,
    });
    expect(rows.filter((row) => row.kind === "hunk")).toMatchObject([
      { hunkIndex: 0, section: "export function main() {" },
      { hunkIndex: 1, section: "" },
    ]);
    expect(lineCells(rows)).toEqual([
      ["context", "const a = 1;", 1, 1],
      ["delete", "const b = 2;", 2, null],
      ["add", "const b = 3;", null, 2],
      ["add", "const c = 4;", null, 3],
      ["context", "return a;", 3, 4],
      ["context", "}", 4, 5],
      ["delete", "old();", 20, null],
      ["add", "next();", null, 21],
      ["context", "end();", 21, 22],
    ]);
  });

  test("reads each file of a multi-file diff with its status and notes", () => {
    const rows = buildDiffRows(GIT_DIFF);
    const readme = rows.filter((row) => row.fileIndex === 1);
    expect(readme[0]).toMatchObject({
      kind: "file",
      path: "README.md",
      oldPath: null,
      status: "added",
      additions: 1,
    });
    expect(lineCells(readme)).toEqual([["add", "# Title", null, 1]]);
    expect(readme.at(-1)).toMatchObject({ kind: "note", text: "\\ No newline at end of file" });
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });

  test("reads renames, deletions, and binary files", () => {
    const rows = buildDiffRows(
      [
        "diff --git a/old.ts b/new.ts",
        "similarity index 90%",
        "rename from old.ts",
        "rename to new.ts",
        "diff --git a/gone.ts b/gone.ts",
        "deleted file mode 100644",
        "--- a/gone.ts",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-bye",
        "diff --git a/logo.png b/logo.png",
        "Binary files a/logo.png and b/logo.png differ",
      ].join("\n"),
    );
    expect(rows.filter((row) => row.kind === "file")).toMatchObject([
      { path: "new.ts", status: "renamed" },
      { path: "gone.ts", newPath: null, status: "deleted", deletions: 1 },
      { path: "logo.png", status: "modified" },
    ]);
    expect(rows.at(-1)).toMatchObject({
      kind: "note",
      text: "Binary files a/logo.png and b/logo.png differ",
    });
  });

  test("keeps a deleted line that looks like a file header inside its hunk", () => {
    const rows = buildDiffRows("--- a/x.sql\n+++ b/x.sql\n@@ -1,2 +1,1 @@\n--- comment\n keep");
    expect(lineCells(rows)).toEqual([
      ["delete", "-- comment", 1, null],
      ["context", "keep", 2, 1],
    ]);
  });

  test("reads an apply-patch update without line numbers", () => {
    const rows = buildDiffRows(
      "*** Begin Patch\n*** Update File: lib/a.rs\n@@ fn main\n-a\n+b\n*** End Patch",
    );
    expect(rows[0]).toMatchObject({ kind: "file", path: "lib/a.rs" });
    expect(lineCells(rows)).toEqual([
      ["delete", "a", null, null],
      ["add", "b", null, null],
    ]);
  });

  test("shows a note for text without diff markers", () => {
    expect(buildDiffRows("just words")).toEqual([
      { kind: "note", key: "0:0", fileIndex: 0, text: "This text has no diff changes to show." },
    ]);
  });
});

describe("diffRowType", () => {
  test("gives line rows of each change their own recycled views", () => {
    const types = new Set(buildDiffRows(GIT_DIFF).map(diffRowType));
    expect([...types].toSorted()).toEqual([
      "file",
      "hunk",
      "line:add",
      "line:context",
      "line:delete",
      "note",
    ]);
  });
});

describe("buildFileDiffRows", () => {
  test("selects the rows of one file", () => {
    const rows = buildFileDiffRows(GIT_DIFF, "README.md");
    expect(rows?.[0]).toMatchObject({ kind: "file", path: "README.md", fileIndex: 0 });
    expect(buildFileDiffRows(GIT_DIFF, "missing.ts")).toBeNull();
  });
});

describe("diffLineTarget", () => {
  test("uses the old side for deleted lines and the new side for others", () => {
    const lines = buildDiffRows(GIT_DIFF).flatMap((row) => (row.kind === "line" ? [row] : []));
    expect(lines.slice(0, 3).map(diffLineTarget)).toEqual([
      { side: "new", line: 1 },
      { side: "old", line: 2 },
      { side: "new", line: 2 },
    ]);
  });
});

describe("desktop diff details", () => {
  test("counts the unchanged lines that each hunk skips", () => {
    const rows = buildDiffRows(GIT_DIFF);
    expect(
      rows.flatMap((row) => (row.kind === "hunk" ? [[row.fileIndex, row.hiddenBefore]] : [])),
    ).toEqual([
      [0, 0],
      [0, 15],
      [1, 0],
    ]);
    const apply = buildDiffRows("*** Begin Patch\n*** Update File: a.rs\n@@ fn main\n-a\n+b\n");
    expect(apply.find((row) => row.kind === "hunk")).toMatchObject({ hiddenBefore: null });
  });

  test("marks the changed words of a removed line and the added line that replaces it", () => {
    const rows = buildDiffRows(GIT_DIFF).flatMap((row) => (row.kind === "line" ? [row] : []));
    const emphasis = rows.map((row) => [row.change, row.text, row.emphasis]);
    expect(emphasis.slice(1, 4)).toEqual([
      ["delete", "const b = 2;", { start: 10, end: 11 }],
      ["add", "const b = 3;", { start: 10, end: 11 }],
      // The second added line has no removed line to pair with.
      ["add", "const c = 4;", null],
    ]);
    // Each hunk pairs its own lines.
    expect(emphasis.slice(6, 8)).toEqual([
      ["delete", "old();", { start: 0, end: 3 }],
      ["add", "next();", { start: 0, end: 4 }],
    ]);
  });

  test("gives the gutter room for the largest line number", () => {
    expect(diffNumberDigits(buildDiffRows(GIT_DIFF))).toBe(3);
    expect(diffNumberDigits(buildDiffRows("--- a/x\n+++ b/x\n@@ -1200,1 +1200,1 @@\n-a\n+b"))).toBe(
      4,
    );
  });
});

describe("buildReplacementDiffRows", () => {
  test("shows an edit fragment as removed and added lines between the shared lines", () => {
    const rows = buildReplacementDiffRows(
      "function a() {\n  return 1;\n}\n",
      "function a() {\n  return 2;\n  // two\n}\n",
      "src/a.ts",
    );
    expect(rows[0]).toMatchObject({ kind: "file", path: "src/a.ts", additions: 2, deletions: 1 });
    expect(lineCells(rows)).toEqual([
      ["context", "function a() {", null, null],
      ["delete", "  return 1;", null, null],
      ["add", "  return 2;", null, null],
      ["add", "  // two", null, null],
      ["context", "}", null, null],
    ]);
    expect(rows.find((row) => row.kind === "line" && row.change === "add")).toMatchObject({
      emphasis: { start: 9, end: 10 },
    });
  });

  test("shows an insertion with no removed text as added lines only", () => {
    expect(lineCells(buildReplacementDiffRows("", "one\ntwo", "a.txt"))).toEqual([
      ["add", "one", null, null],
      ["add", "two", null, null],
    ]);
  });
});
