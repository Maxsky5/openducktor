import { describe, expect, test } from "bun:test";
import {
  countRenderableFileDiffLines,
  normalizeRenderableFileDiffCandidate,
  selectRenderableFileDiff,
  splitFileDiffCandidates,
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

  test("does not choose an unrelated section from a multi-file patch", () => {
    const diff =
      "diff --git a/src/first.ts b/src/first.ts\n--- a/src/first.ts\n+++ b/src/first.ts\n@@ -1 +1 @@\n-old\n+new\n" +
      "diff --git a/src/second.ts b/src/second.ts\n--- a/src/second.ts\n+++ b/src/second.ts\n@@ -1 +1 @@\n-old\n+new\n";

    expect(selectRenderableFileDiff(diff, "src/missing.ts")).toBeNull();
  });

  test("selects the exact file when standard diff paths contain spaces", () => {
    const first = "--- src/first file.ts\n+++ src/first file.ts\n@@ -1 +1 @@\n-old\n+first\n";
    const second = "--- src/second file.ts\n+++ src/second file.ts\n@@ -1 +1 @@\n-old\n+second\n";

    expect(selectRenderableFileDiff(first + second, "src/second file.ts")).toBe(second);
    expect(selectRenderableFileDiff(first + second, "src/missing file.ts")).toBeNull();
  });

  test("keeps header-looking deletion and addition lines inside their hunk", () => {
    const first =
      "--- src/first file.ts\n+++ src/first file.ts\n@@ -1 +1 @@\n" +
      "--- a/src/target file.ts\n+++ b/src/target file.ts\n";
    const target = "--- src/target file.ts\n+++ src/target file.ts\n@@ -1 +1 @@\n-old\n+new\n";
    const patch = first + target;

    expect(splitFileDiffCandidates(patch)).toEqual([first.trimEnd(), target.trimEnd()]);
    expect(selectRenderableFileDiff(patch, "src/first file.ts")).toBe(first);
    expect(selectRenderableFileDiff(patch, "src/target file.ts")).toBe(target);
    expect(selectRenderableFileDiff(patch, "src/missing file.ts")).toBeNull();
    expect(countRenderableFileDiffLines(first)).toEqual({ additions: 1, deletions: 1 });
  });

  test("matches quoted Git and unified headers with spaces", () => {
    const diff =
      'diff --git "a/src/my file.ts" "b/src/my file.ts"\n' +
      '--- "a/src/my file.ts"\n+++ "b/src/my file.ts"\n@@ -1 +1 @@\n-old\n+new\n';

    expect(selectRenderableFileDiff(diff, "src/my file.ts")).toBe(diff);
  });

  test("selects a Git-quoted path with an escaped quote from a multi-file patch", () => {
    const quoted =
      'diff --git "a/src/quote\\" file.ts" "b/src/quote\\" file.ts"\n' +
      '--- "a/src/quote\\" file.ts"\n+++ "b/src/quote\\" file.ts"\n@@ -1 +1 @@\n-old\n+quoted\n';
    const plain =
      "diff --git a/src/quote file.ts b/src/quote file.ts\n" +
      "--- a/src/quote file.ts\n+++ b/src/quote file.ts\n@@ -1 +1 @@\n-old\n+plain\n";

    expect(selectRenderableFileDiff(plain + quoted, 'src/quote" file.ts')).toBe(quoted);
    expect(selectRenderableFileDiff(plain + quoted, "src/quote file.ts")).toBe(plain);
  });

  test("decodes UTF-8 octal escapes in Git-quoted file paths", () => {
    const diff =
      'diff --git "a/src/\\302\\265 file.ts" "b/src/\\302\\265 file.ts"\n' +
      '--- "a/src/\\302\\265 file.ts"\n+++ "b/src/\\302\\265 file.ts"\n@@ -1 +1 @@\n-old\n+new\n';

    expect(selectRenderableFileDiff(diff, "src/µ file.ts")).toBe(diff);
    expect(selectRenderableFileDiff(diff, "src/302265 file.ts")).toBeNull();
  });

  test("keeps literal quotes at the ends of requested file names", () => {
    const diff =
      'diff --git "a/src/\\"name file.ts\\"" "b/src/\\"name file.ts\\""\n' +
      '--- "a/src/\\"name file.ts\\""\n+++ "b/src/\\"name file.ts\\""\n@@ -1 +1 @@\n-old\n+new\n';

    expect(selectRenderableFileDiff(diff, 'src/"name file.ts"')).toBe(diff);
    expect(selectRenderableFileDiff(diff, "src/name file.ts")).toBeNull();
  });

  test("ignores timestamps after tab-separated unified paths", () => {
    const diff =
      "--- src/my file.ts\t2026-09-27 12:34:56 +0200\n" +
      "+++ src/my file.ts\t2026-09-27 12:35:00 +0200\n" +
      "@@ -1 +1 @@\n-old\n+new\n";

    expect(selectRenderableFileDiff(diff, "src/my file.ts")).toBe(diff);
    expect(selectRenderableFileDiff(diff, "src/my file.ts 2026-09-27")).toBeNull();
  });

  test("matches unquoted Git headers with spaces when no unified headers exist", () => {
    const first = "diff --git a/src/other file.ts b/src/other file.ts\nBinary files differ\n";
    const second = "diff --git a/src/my file.ts b/src/my file.ts\nBinary files differ\n";

    expect(selectRenderableFileDiff(first + second, "src/my file.ts")).toBe(second);
    expect(selectRenderableFileDiff(first + second, "src/missing file.ts")).toBeNull();
  });

  test("uses unified headers when a Git path contains a second path separator", () => {
    const first =
      "diff --git a/src/my b/file.ts b/src/my b/file.ts\n" +
      "--- a/src/my b/file.ts\n+++ b/src/my b/file.ts\n@@ -1 +1 @@\n-old\n+first\n";
    const second =
      "diff --git a/file.ts b/file.ts\n" +
      "--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+second\n";

    expect(selectRenderableFileDiff(first + second, "src/my b/file.ts")).toBe(first);
    expect(selectRenderableFileDiff(first + second, "file.ts")).toBe(second);
  });

  test("selects Git-only patches with embedded path separators exactly", () => {
    const first = "diff --git a/src/my b/file.ts b/src/my b/file.ts\nBinary files differ\n";
    const second = "diff --git a/file.ts b/file.ts\nBinary files differ\n";

    expect(selectRenderableFileDiff(first + second, "src/my b/file.ts")).toBe(first);
    expect(selectRenderableFileDiff(first + second, "file.ts")).toBe(second);
    expect(
      selectRenderableFileDiff(
        "diff --git a/src/old b/file.ts b/src/new b/file.ts\nBinary files differ\n",
        "file.ts",
      ),
    ).toBeNull();
  });

  test("uses rename metadata before an ambiguous Git-only header", () => {
    const rename =
      "diff --git a/foo b/bar b/foo b/bar\n" +
      "similarity index 100%\nrename from foo\nrename to bar b/foo b/bar\n";
    const binary = "diff --git a/foo b/bar b/foo b/bar\nBinary files differ\n";

    expect(selectRenderableFileDiff(rename + binary, "foo b/bar")).toBe(binary);
    expect(selectRenderableFileDiff(rename + binary, "foo")).toBe(rename);
    expect(selectRenderableFileDiff(rename + binary, "bar b/foo b/bar")).toBe(rename);
    expect(selectRenderableFileDiff(rename + binary, "missing")).toBeNull();
  });

  test("keeps directory prefixes in copy metadata paths", () => {
    const copy =
      "diff --git a/a/foo b/bar b/a/foo b/bar\n" +
      "similarity index 100%\ncopy from a/foo\ncopy to bar b/a/foo b/bar\n";
    const binary = "diff --git a/a/foo b/bar b/a/foo b/bar\nBinary files differ\n";

    expect(selectRenderableFileDiff(copy + binary, "a/foo")).toBe(copy);
    expect(selectRenderableFileDiff(copy + binary, "bar b/a/foo b/bar")).toBe(copy);
    expect(selectRenderableFileDiff(copy + binary, "a/foo b/bar")).toBe(binary);
  });

  test("matches repo-relative diff headers to absolute runtime file paths", () => {
    const diff = "--- src/app.ts\n+++ src/app.ts\n@@\n-old\n+new\n";

    expect(selectRenderableFileDiff(diff, "/repo/src/app.ts")).toBe(diff);
  });

  test("selects a standalone Git-style modified patch", () => {
    const diff = "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n";

    expect(selectRenderableFileDiff(diff, "src/app.ts", { changeType: "modified" })).toBe(diff);
    expect(selectRenderableFileDiff(diff, "src/other.ts", { changeType: "modified" })).toBeNull();
  });

  test("prefers a literal file path over a standalone Git-style path", () => {
    const git = "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+git\n";
    const literal = "--- src/app.ts\n+++ src/app.ts\n@@ -1 +1 @@\n-old\n+literal\n";

    expect(selectRenderableFileDiff(git + literal, "src/app.ts", { changeType: "modified" })).toBe(
      literal,
    );
  });

  test("selects standalone Git-style add and delete patches for absolute paths", () => {
    const added = "--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1 @@\n+new\n";
    const deleted = "--- a/src/old.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n";

    expect(selectRenderableFileDiff(added, "/repo/src/new.ts", { changeType: "added" })).toBe(
      added,
    );
    expect(selectRenderableFileDiff(deleted, "/repo/src/old.ts", { changeType: "deleted" })).toBe(
      deleted,
    );
    expect(
      selectRenderableFileDiff(added, "/repo/src/other.ts", { changeType: "added" }),
    ).toBeNull();
  });

  test("prefers the most specific path for an absolute request", () => {
    const first = "--- src/target file.ts\n+++ src/target file.ts\n@@ -1 +1 @@\n-old\n+first\n";
    const second =
      "--- other/src/target file.ts\n+++ other/src/target file.ts\n@@ -1 +1 @@\n-old\n+second\n";

    expect(selectRenderableFileDiff(first + second, "/repo/other/src/target file.ts")).toBe(second);
    expect(selectRenderableFileDiff(first + second, "/repo/src/target file.ts")).toBe(first);
  });

  test("does not choose between equally specific file sections", () => {
    const first = "--- a/src/file.ts\n+++ b/src/file.ts\n@@ -1 +1 @@\n-old\n+first\n";
    const second = "--- a/src/file.ts\n+++ b/src/file.ts\n@@ -1 +1 @@\n-old\n+second\n";

    expect(selectRenderableFileDiff(first + second, "/repo/src/file.ts")).toBeNull();
  });

  test("normalizes classic diff sections for the current file", () => {
    const diff =
      "Index: src/first.ts\n==================================================\n--- src/first.ts\n+++ src/first.ts\n@@ -1 +1 @@\n-old\n+new\n" +
      "Index: src/second file.ts\n==================================================\n--- src/second file.ts\n+++ src/second file.ts\n@@ -1 +1,2 @@\n-old\n+new\n+line\n";

    expect(selectRenderableFileDiff(diff, "src/second file.ts")).toBe(
      "--- src/second file.ts\n+++ src/second file.ts\n@@ -1 +1,2 @@\n-old\n+new\n+line\n",
    );
  });

  test("keeps real a/ directories in standard patches generated by diff", () => {
    const directory =
      "Index: a/my file.ts\n===================================================================\n" +
      "--- a/my file.ts\n+++ a/my file.ts\n@@ -1,1 +1,1 @@\n-old\n+directory\n";
    const root =
      "Index: my file.ts\n===================================================================\n" +
      "--- my file.ts\n+++ my file.ts\n@@ -1,1 +1,1 @@\n-old\n+root\n";

    expect(selectRenderableFileDiff(directory, "a/my file.ts")).toBe(
      directory.slice(directory.indexOf("--- ")),
    );
    expect(selectRenderableFileDiff(directory, "my file.ts")).toBeNull();
    expect(selectRenderableFileDiff(directory + root, "a/my file.ts")).toBe(
      directory.slice(directory.indexOf("--- ")),
    );
    expect(selectRenderableFileDiff(directory + root, "my file.ts")).toBe(
      root.slice(root.indexOf("--- ")),
    );
  });

  test("keeps literal a/ and b/ directories in a standard two-file patch", () => {
    const patch =
      "===================================================================\n" +
      "--- a/my file.ts\n+++ b/my file.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n";
    const renderable = patch.slice(patch.indexOf("--- "));

    expect(selectRenderableFileDiff(patch, "a/my file.ts")).toBe(renderable);
    expect(selectRenderableFileDiff(patch, "b/my file.ts")).toBe(renderable);
    expect(selectRenderableFileDiff(patch, "my file.ts")).toBeNull();
  });

  test("strips Git a/ and b/ markers without losing a real a/ directory", () => {
    const diff =
      "diff --git a/a/my file.ts b/a/my file.ts\n" +
      "--- a/a/my file.ts\n+++ b/a/my file.ts\n@@ -1 +1 @@\n-old\n+new\n";

    expect(selectRenderableFileDiff(diff, "a/my file.ts")).toBe(diff);
    expect(selectRenderableFileDiff(diff, "my file.ts")).toBeNull();
  });

  test("keeps a/ directories in standalone unified and apply_patch headers", () => {
    const unified = "--- a/my file.ts\n+++ a/my file.ts\n@@ -1 +1 @@\n-old\n+new\n";
    const custom = "*** Add File: a/my file.ts\n+new";

    expect(selectRenderableFileDiff(unified, "a/my file.ts")).toBe(unified);
    expect(selectRenderableFileDiff(unified, "my file.ts")).toBeNull();
    expect(selectRenderableFileDiff(custom, "a/my file.ts")).toBe(
      "--- /dev/null\n+++ b/a/my file.ts\n@@ -0,0 +1,1 @@\n+new\n",
    );
    expect(selectRenderableFileDiff(custom, "my file.ts")).toBeNull();
  });

  test("keeps trailing spaces distinct in classic file paths", () => {
    const spaced =
      "Index: src/file \n===================================================================\n" +
      "--- src/file \n+++ src/file \n@@ -1 +1 @@\n-old\n+spaced\n";
    const plain =
      "Index: src/file\n===================================================================\n" +
      "--- src/file\n+++ src/file\n@@ -1 +1 @@\n-old\n+plain\n";

    expect(selectRenderableFileDiff(spaced + plain, "src/file ")).toBe(
      spaced.slice(spaced.indexOf("--- ")),
    );
    expect(selectRenderableFileDiff(spaced + plain, "src/file")).toBe(
      plain.slice(plain.indexOf("--- ")),
    );
  });

  test("preserves a trailing space in the last Git rename header", () => {
    const rename =
      "diff --git a/src/old b/src/new \n" +
      "similarity index 100%\nrename from src/old\nrename to src/new \n";

    expect(selectRenderableFileDiff(rename, "src/new ")).toBe(rename);
    expect(selectRenderableFileDiff(rename, "src/new")).toBeNull();
  });

  test("selects added and deleted unified patches with space paths", () => {
    const added = "--- /dev/null\n+++ src/new file.ts\n@@ -0,0 +1 @@\n+new\n";
    const deleted = "--- src/old file.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n";

    expect(selectRenderableFileDiff(added, "src/new file.ts", { changeType: "added" })).toBe(added);
    expect(selectRenderableFileDiff(deleted, "src/old file.ts", { changeType: "deleted" })).toBe(
      deleted,
    );
  });

  test("matches standalone Git add and delete paths and keeps literal paths", () => {
    const added = "--- /dev/null\n+++ b/src/new file.ts\n@@ -0,0 +1 @@\n+new\n";
    const deleted = "--- a/src/old file.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n";

    expect(selectRenderableFileDiff(added, "b/src/new file.ts", { changeType: "added" })).toBe(
      added,
    );
    expect(selectRenderableFileDiff(deleted, "a/src/old file.ts", { changeType: "deleted" })).toBe(
      deleted,
    );
    expect(selectRenderableFileDiff(added, "src/new file.ts", { changeType: "added" })).toBe(added);
    expect(selectRenderableFileDiff(deleted, "src/old file.ts", { changeType: "deleted" })).toBe(
      deleted,
    );
    expect(
      selectRenderableFileDiff(added, "src/missing file.ts", { changeType: "added" }),
    ).toBeNull();
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
    expect(selectRenderableFileDiff("*** Add File: src/new \n+created", "src/new ")).toBe(
      "--- /dev/null\n+++ b/src/new \n@@ -0,0 +1,1 @@\n+created\n",
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

  test("converts full file text to an added-file diff when the adapter marks it added", () => {
    expect(
      selectRenderableFileDiff(
        'import { render } from "@testing-library/react";\nfunction AuthConsumer() {}\n',
        "src/AuthContext.test.tsx",
        { changeType: "added" },
      ),
    ).toBe(
      '--- /dev/null\n+++ b/src/AuthContext.test.tsx\n@@ -0,0 +1,2 @@\n+import { render } from "@testing-library/react";\n+function AuthConsumer() {}\n',
    );
  });

  test("converts full file text to a deleted-file diff when the adapter marks it deleted", () => {
    expect(
      selectRenderableFileDiff("old\ncontent\n", "src/old.ts", { changeType: "deleted" }),
    ).toBe("--- a/src/old.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-old\n-content\n");
  });

  test("does not turn an unrelated explicit patch into an added-file diff", () => {
    const diff = "--- /dev/null\n+++ b/src/other file.ts\n@@ -0,0 +1 @@\n+other\n";

    expect(
      selectRenderableFileDiff(diff, "src/target file.ts", { changeType: "added" }),
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
