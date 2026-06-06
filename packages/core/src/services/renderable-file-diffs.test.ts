import { describe, expect, test } from "bun:test";
import {
  countRenderableFileDiffLines,
  normalizeRenderableFileDiffCandidate,
  selectRenderableFileDiff,
} from "./renderable-file-diffs";

describe("renderable file diffs", () => {
  test("chooses the matching file section from a multi-file git patch", () => {
    const diff =
      "diff --git a/src/first.ts b/src/first.ts\n--- a/src/first.ts\n+++ b/src/first.ts\n@@ -1 +1 @@\n-old\n+new\n" +
      "diff --git a/src/second.ts b/src/second.ts\n--- a/src/second.ts\n+++ b/src/second.ts\n@@ -1 +1,2 @@\n-old\n+new\n+line\n";

    expect(selectRenderableFileDiff(diff, "src/second.ts")).toBe(
      "diff --git a/src/second.ts b/src/second.ts\n--- a/src/second.ts\n+++ b/src/second.ts\n@@ -1 +1,2 @@\n-old\n+new\n+line\n",
    );
  });

  test("normalizes classic diff sections for the current file", () => {
    const diff =
      "Index: src/first.ts\n==================================================\n--- src/first.ts\n+++ src/first.ts\n@@ -1 +1 @@\n-old\n+new\n" +
      "Index: src/second.ts\n==================================================\n--- src/second.ts\n+++ src/second.ts\n@@ -1 +1,2 @@\n-old\n+new\n+line\n";

    expect(selectRenderableFileDiff(diff, "src/second.ts")).toBe(
      "--- src/second.ts\n+++ src/second.ts\n@@ -1 +1,2 @@\n-old\n+new\n+line\n",
    );
  });

  test("ignores file path mentions inside hunk bodies when matching sections", () => {
    const diff =
      'diff --git a/src/first.ts b/src/first.ts\n--- a/src/first.ts\n+++ b/src/first.ts\n@@ -1 +1 @@\n-import "./old"\n+import "src/target.ts"\n' +
      "diff --git a/src/target.ts b/src/target.ts\n--- a/src/target.ts\n+++ b/src/target.ts\n@@ -1 +1 @@\n-old\n+new\n";

    expect(selectRenderableFileDiff(diff, "src/target.ts")).toBe(
      "diff --git a/src/target.ts b/src/target.ts\n--- a/src/target.ts\n+++ b/src/target.ts\n@@ -1 +1 @@\n-old\n+new\n",
    );
  });

  test("synthesizes file headers for hunk-only diffs", () => {
    expect(normalizeRenderableFileDiffCandidate("@@ -1 +1 @@\n-old\n+new\n", "src/app.ts")).toBe(
      "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
    );
  });

  test("drops full-file preambles before hunk-only diffs", () => {
    const diff = `import { render } from "@testing-library/react";
function AuthConsumer() {}

@@ -1,2 +1,3 @@
 import { render } from "@testing-library/react";
+import userEvent from "@testing-library/user-event";
 function AuthConsumer() {}`;

    expect(selectRenderableFileDiff(diff, "src/AuthContext.test.tsx")).toBe(
      '--- a/src/AuthContext.test.tsx\n+++ b/src/AuthContext.test.tsx\n@@ -1,2 +1,3 @@\n import { render } from "@testing-library/react";\n+import userEvent from "@testing-library/user-event";\n function AuthConsumer() {}\n',
    );
  });

  test("converts apply-patch add and delete sections to unified diffs", () => {
    expect(selectRenderableFileDiff("*** Add File: src/new.ts\n+created", "src/new.ts")).toBe(
      "--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1,1 @@\n+created\n",
    );
    expect(selectRenderableFileDiff("*** Delete File: src/old.ts\n-removed", "src/old.ts")).toBe(
      "--- a/src/old.ts\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-removed\n",
    );
  });

  test("rejects full file text without diff markers", () => {
    expect(
      selectRenderableFileDiff(
        'import { render } from "@testing-library/react";\nfunction AuthConsumer() {}\n',
        "src/AuthContext.test.tsx",
      ),
    ).toBeNull();
  });

  test("counts changed lines without counting file headers", () => {
    expect(
      countRenderableFileDiffLines("--- a/src/app.ts\n+++ b/src/app.ts\n@@\n-old\n+new\n+line\n"),
    ).toEqual({
      additions: 2,
      deletions: 1,
    });
  });
});
