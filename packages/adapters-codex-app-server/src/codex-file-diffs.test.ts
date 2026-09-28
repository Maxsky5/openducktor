import { describe, expect, test } from "bun:test";
import {
  CodexFileDiffParseError,
  codexApplyPatchFileDiffs,
  fileDiffsFromUnifiedDiff,
  toFileDiffs,
} from "./codex-file-diffs";

describe("Codex file diffs", () => {
  test("parses streamed unified diffs for file paths with spaces", () => {
    const diff =
      "diff --git a/src/my file.ts b/src/my file.ts\n--- a/src/my file.ts\n+++ b/src/my file.ts\n@@ -1 +1 @@\n-old\n+new";

    expect(fileDiffsFromUnifiedDiff(diff)).toEqual([
      {
        file: "src/my file.ts",
        type: "modified",
        additions: 1,
        deletions: 1,
        diff: `${diff}\n`,
      },
    ]);
  });

  test("preserves trailing spaces in streamed unified diff paths", () => {
    const diff = "--- a/src/file \n+++ b/src/file \n@@ -1 +1 @@\n-old\n+new";
    expect(fileDiffsFromUnifiedDiff(diff)).toEqual([
      {
        file: "src/file ",
        type: "modified",
        additions: 1,
        deletions: 1,
        diff: `${diff}\n`,
      },
    ]);
  });

  test("parses Codex file change entries and derives missing counts", () => {
    expect(
      toFileDiffs([
        {
          path: "src/app.ts",
          kind: { type: "update", move_path: null },
          diff: "--- src/app.ts\n+++ src/app.ts\n@@\n-old\n+new\n+line",
        },
      ]),
    ).toEqual([
      {
        file: "src/app.ts",
        type: "modified",
        additions: 2,
        deletions: 1,
        diff: "--- src/app.ts\n+++ src/app.ts\n@@\n-old\n+new\n+line\n",
      },
    ]);
  });

  test("keeps a standalone Git-style modified file change visible", () => {
    const diff = "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n";

    expect(
      toFileDiffs([{ path: "src/app.ts", kind: { type: "update", move_path: null }, diff }]),
    ).toEqual([{ file: "src/app.ts", type: "modified", additions: 1, deletions: 1, diff }]);
  });

  test("preserves trailing spaces in Codex file change and move paths", () => {
    const file = "src/file ";
    const movedFile = "src/moved ";
    expect(
      toFileDiffs([
        {
          path: file,
          kind: { type: "update", move_path: movedFile },
          diff: `--- ${file}\n+++ ${file}\n@@ -1 +1 @@\n-old\n+new\n\nMoved to: ${movedFile}`,
        },
      ]),
    ).toEqual([
      {
        file: movedFile,
        type: "modified",
        additions: 1,
        deletions: 1,
        diff: `--- ${file}\n+++ ${file}\n@@ -1 +1 @@\n-old\n+new\n`,
      },
    ]);
  });

  test("rejects an empty Codex file path", () => {
    expect(() =>
      toFileDiffs([
        {
          path: "   ",
          kind: { type: "update", move_path: null },
          diff: "@@\n+new",
        },
      ]),
    ).toThrow(CodexFileDiffParseError);
    expect(() =>
      toFileDiffs([
        {
          path: "   ",
          kind: { type: "update", move_path: null },
          diff: "@@\n+new",
        },
      ]),
    ).toThrow("Malformed Codex file change: entry 0 has empty file path.");
  });

  test("keeps modified Codex full-file text metadata-only instead of failing the tool", () => {
    expect(
      toFileDiffs([
        {
          path: "src/app.ts",
          kind: { type: "update", move_path: null },
          diff: 'import { render } from "@testing-library/react";\nfunction AuthConsumer() {}\n',
        },
      ]),
    ).toEqual([
      {
        file: "src/app.ts",
        type: "modified",
        additions: 0,
        deletions: 0,
        diff: "",
      },
    ]);
  });

  test("renders added Codex full-file text as an added-file diff", () => {
    expect(
      toFileDiffs([
        {
          path: "src/AuthContext.test.tsx",
          kind: { type: "add" },
          diff: 'import { render } from "@testing-library/react";\nfunction AuthConsumer() {}\n',
        },
      ]),
    ).toEqual([
      {
        file: "src/AuthContext.test.tsx",
        type: "added",
        additions: 2,
        deletions: 0,
        diff: '--- /dev/null\n+++ b/src/AuthContext.test.tsx\n@@ -0,0 +1,2 @@\n+import { render } from "@testing-library/react";\n+function AuthConsumer() {}\n',
      },
    ]);
  });

  test("renders Codex app-server object-kind added file content as an added-file diff", () => {
    expect(
      toFileDiffs([
        {
          path: "src/new.ts",
          kind: { type: "add" },
          diff: "created\n",
        },
      ]),
    ).toEqual([
      {
        file: "src/new.ts",
        type: "added",
        additions: 1,
        deletions: 0,
        diff: "--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1,1 @@\n+created\n",
      },
    ]);
  });

  test("renders Codex app-server object-kind deleted file content as a deleted-file diff", () => {
    expect(
      toFileDiffs([
        {
          path: "src/old.ts",
          kind: { type: "delete" },
          diff: "removed\n",
        },
      ]),
    ).toEqual([
      {
        file: "src/old.ts",
        type: "deleted",
        additions: 0,
        deletions: 1,
        diff: "--- a/src/old.ts\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-removed\n",
      },
    ]);
  });

  test("keeps patch text in Codex added and deleted file content", () => {
    const content =
      "intro\ndiff --git a/other.ts b/other.ts\nindex 111..222 100644\n--- a/other.ts\n+++ b/other.ts\n@@ -1 +1 @@\n-old\n+new\n";

    expect(
      toFileDiffs([
        { path: "docs/new guide.md", kind: { type: "add" }, diff: content },
        { path: "docs/old guide.md", kind: { type: "delete" }, diff: content },
      ]).map(({ diff }) => diff),
    ).toEqual([
      "--- /dev/null\n+++ b/docs/new guide.md\n@@ -0,0 +1,8 @@\n+intro\n+diff --git a/other.ts b/other.ts\n+index 111..222 100644\n+--- a/other.ts\n++++ b/other.ts\n+@@ -1 +1 @@\n+-old\n++new\n",
      "--- a/docs/old guide.md\n+++ /dev/null\n@@ -1,8 +0,0 @@\n-intro\n-diff --git a/other.ts b/other.ts\n-index 111..222 100644\n---- a/other.ts\n-+++ b/other.ts\n-@@ -1 +1 @@\n--old\n-+new\n",
    ]);
  });

  test("uses Codex app-server move targets as the displayed file path", () => {
    expect(
      toFileDiffs([
        {
          path: "src/old.ts",
          kind: { type: "update", move_path: "src/new.ts" },
          diff: "--- src/old.ts\n+++ src/old.ts\n@@\n-old\n+new\n\nMoved to: src/new.ts",
        },
      ]),
    ).toEqual([
      {
        file: "src/new.ts",
        type: "modified",
        additions: 1,
        deletions: 1,
        diff: "--- src/old.ts\n+++ src/old.ts\n@@\n-old\n+new\n",
      },
    ]);
  });

  test("strips Codex full-file preambles before hunk-only diffs", () => {
    expect(
      toFileDiffs([
        {
          path: "src/AuthContext.test.tsx",
          kind: { type: "update", move_path: null },
          diff: `import { render } from "@testing-library/react";
function AuthConsumer() {}

@@ -1,2 +1,3 @@
 import { render } from "@testing-library/react";
+import userEvent from "@testing-library/user-event";
 function AuthConsumer() {}`,
        },
      ]),
    ).toEqual([
      {
        file: "src/AuthContext.test.tsx",
        type: "modified",
        additions: 1,
        deletions: 0,
        diff: '--- a/src/AuthContext.test.tsx\n+++ b/src/AuthContext.test.tsx\n@@ -1,2 +1,3 @@\n import { render } from "@testing-library/react";\n+import userEvent from "@testing-library/user-event";\n function AuthConsumer() {}\n',
      },
    ]);
  });

  test("parses Codex apply_patch input into structured file diffs", () => {
    expect(
      codexApplyPatchFileDiffs(`*** Begin Patch
*** Update File: src/app.ts
@@
-old
+new
*** Add File: src/new.ts
+created
*** End Patch`),
    ).toEqual([
      {
        file: "src/app.ts",
        type: "modified",
        additions: 1,
        deletions: 1,
        diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n-old\n+new\n",
      },
      {
        file: "src/new.ts",
        type: "added",
        additions: 1,
        deletions: 0,
        diff: "--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1,1 @@\n+created\n",
      },
    ]);
  });

  test("keeps apply_patch file entries path-only when the body has no renderable diff", () => {
    expect(
      codexApplyPatchFileDiffs(`*** Begin Patch
*** Update File: src/app.ts
import { render } from "@testing-library/react";
function AuthConsumer() {}
*** End Patch`),
    ).toEqual([
      {
        file: "src/app.ts",
        type: "modified",
        additions: 0,
        deletions: 0,
        diff: "",
      },
    ]);
  });

  test("parses Codex apply_patch move targets into structured file diffs", () => {
    expect(
      codexApplyPatchFileDiffs(`*** Begin Patch
*** Update File: src/old.ts
*** Move to: src/new.ts
@@
-old
+new
*** End Patch`),
    ).toEqual([
      {
        file: "src/new.ts",
        type: "modified",
        additions: 1,
        deletions: 1,
        diff: "--- a/src/new.ts\n+++ b/src/new.ts\n@@\n-old\n+new\n",
      },
    ]);
  });

  test("preserves trailing spaces in Codex apply_patch file and move paths", () => {
    expect(
      codexApplyPatchFileDiffs(
        "*** Begin Patch\n*** Update File: src/old \n*** Move to: src/new \n@@\n-old\n+new\n*** End Patch",
      ),
    ).toEqual([
      {
        file: "src/new ",
        type: "modified",
        additions: 1,
        deletions: 1,
        diff: "--- a/src/new \n+++ b/src/new \n@@\n-old\n+new\n",
      },
    ]);
  });
});
