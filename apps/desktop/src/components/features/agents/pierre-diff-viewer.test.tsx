import { describe, expect, test } from "bun:test";
import { getRenderableFileDiff } from "./pierre-diff-viewer";

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
});
