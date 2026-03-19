import { describe, expect, test } from "bun:test";
import { getHunkResetAnnotations, getRenderableFileDiff } from "./pierre-diff-viewer";

describe("getRenderableFileDiff", () => {
  test("parses valid git patches", () => {
    const patch =
      "diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n";

    const result = getRenderableFileDiff(patch, "src/app.ts");

    expect(result.normalizedPatch).toBe(patch);
    expect(result.fallbackPatch).toBe(patch);
    expect(result.fileDiff?.name.endsWith("src/app.ts")).toBe(true);
  });

  test("normalizes hunk-only patches with the current file path", () => {
    const result = getRenderableFileDiff("@@ -1 +1 @@\n-old\n+new\n", "src/hunk.ts");

    expect(result.normalizedPatch).toBe(
      "--- a/src/hunk.ts\n+++ b/src/hunk.ts\n@@ -1 +1 @@\n-old\n+new\n",
    );
    expect(result.fileDiff?.name.endsWith("src/hunk.ts")).toBe(true);
  });

  test("keeps normalized raw diff text when parsing still fails", () => {
    const result = getRenderableFileDiff(
      "Index: src/app.ts\n=====\ninvalid diff body",
      "src/app.ts",
    );

    expect(result.fileDiff).toBeNull();
    expect(result.fallbackPatch).toBe("Index: src/app.ts\n=====\ninvalid diff body\n");
  });

  test("builds hunk reset annotations for the first and subsequent hunks", () => {
    const patch = [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,3 +1,3 @@",
      "-one",
      "+one updated",
      " two",
      " three",
      "@@ -8,3 +8,4 @@",
      " eight",
      "-nine",
      "+nine updated",
      "+ten added",
      " eleven",
      "",
    ].join("\n");
    const { fileDiff } = getRenderableFileDiff(patch, "src/app.ts");

    expect(fileDiff).not.toBeNull();
    const annotations = getHunkResetAnnotations(fileDiff!);

    expect(annotations).toEqual([
      {
        side: "additions",
        lineNumber: 1,
        metadata: { hunkIndex: 0 },
      },
      {
        side: "additions",
        lineNumber: 10,
        metadata: { hunkIndex: 1 },
      },
    ]);
  });

  test("falls back to deletion lines for delete-only hunks", () => {
    const patch = [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -2,2 +2,0 @@",
      "-removed one",
      "-removed two",
      "",
    ].join("\n");
    const { fileDiff } = getRenderableFileDiff(patch, "src/app.ts");

    expect(fileDiff).not.toBeNull();
    expect(getHunkResetAnnotations(fileDiff!)).toEqual([
      {
        side: "deletions",
        lineNumber: 3,
        metadata: { hunkIndex: 0 },
      },
    ]);
  });
});
