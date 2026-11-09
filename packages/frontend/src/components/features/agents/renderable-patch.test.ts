import { describe, expect, test } from "bun:test";
import { processPatch } from "@pierre/diffs";
import { normalizePatchCandidate, selectRenderableDiff } from "./renderable-patch";

describe("selectRenderableDiff", () => {
  test("chooses the matching file section from a multi-file patch", () => {
    const diff =
      "diff --git a/src/first.ts b/src/first.ts\n--- a/src/first.ts\n+++ b/src/first.ts\n@@ -1 +1 @@\n-old\n+new\n" +
      "diff --git a/src/second.ts b/src/second.ts\n--- a/src/second.ts\n+++ b/src/second.ts\n@@ -1 +1,2 @@\n-old\n+new\n+line\n";

    expect(selectRenderableDiff(diff, "src/second.ts")).toBe(
      "diff --git a/src/second.ts b/src/second.ts\n--- a/src/second.ts\n+++ b/src/second.ts\n@@ -1 +1,2 @@\n-old\n+new\n+line\n",
    );
  });

  test("normalizes classic diff sections for the current file", () => {
    const diff =
      "Index: src/first.ts\n==================================================\n--- src/first.ts\n+++ src/first.ts\n@@ -1 +1 @@\n-old\n+new\n" +
      "Index: src/second.ts\n==================================================\n--- src/second.ts\n+++ src/second.ts\n@@ -1 +1,2 @@\n-old\n+new\n+line\n";

    expect(selectRenderableDiff(diff, "src/second.ts")).toBe(
      "--- src/second.ts\n+++ src/second.ts\n@@ -1 +1,2 @@\n-old\n+new\n+line\n",
    );
  });

  test("ignores file path mentions inside hunk bodies when matching sections", () => {
    const diff =
      'diff --git a/src/first.ts b/src/first.ts\n--- a/src/first.ts\n+++ b/src/first.ts\n@@ -1 +1 @@\n-import "./old"\n+import "src/target.ts"\n' +
      "diff --git a/src/target.ts b/src/target.ts\n--- a/src/target.ts\n+++ b/src/target.ts\n@@ -1 +1 @@\n-old\n+new\n";

    expect(selectRenderableDiff(diff, "src/target.ts")).toBe(
      "diff --git a/src/target.ts b/src/target.ts\n--- a/src/target.ts\n+++ b/src/target.ts\n@@ -1 +1 @@\n-old\n+new\n",
    );
  });
  test("keeps an empty context line at the end of the last hunk", () => {
    // Git writes an empty context line as one space.
    const hunk = "@@ -1,3 +1,4 @@\n+// header\n import a;\n import b;\n \n";
    const diff =
      "diff --git a/src/first.ts b/src/first.ts\n--- a/src/first.ts\n+++ b/src/first.ts\n@@ -1 +1 @@\n-old\n+new\n" +
      `diff --git a/src/target.ts b/src/target.ts\n--- a/src/target.ts\n+++ b/src/target.ts\n${hunk}`;

    const patch = selectRenderableDiff(diff, "src/target.ts");

    expect(patch).toBe(
      `diff --git a/src/target.ts b/src/target.ts\n--- a/src/target.ts\n+++ b/src/target.ts\n${hunk}`,
    );
    // A strict parse fails when a hunk has fewer lines than its header declares.
    expect(() => processPatch(patch ?? "", undefined, true)).not.toThrow();
  });
});

describe("normalizePatchCandidate", () => {
  test("synthesizes file headers for hunk-only diffs", () => {
    expect(normalizePatchCandidate("@@ -1 +1 @@\n-old\n+new\n", "src/app.ts")).toBe(
      "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
    );
  });
});
