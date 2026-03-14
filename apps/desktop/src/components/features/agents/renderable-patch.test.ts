import { describe, expect, test } from "bun:test";
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
});

describe("normalizePatchCandidate", () => {
  test("synthesizes file headers for hunk-only diffs", () => {
    expect(normalizePatchCandidate("@@ -1 +1 @@\n-old\n+new\n", "src/app.ts")).toBe(
      "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
    );
  });
});
