import { describe, expect, test } from "bun:test";
import { CodexFileDiffParseError, codexApplyPatchFileDiffs, toFileDiffs } from "./codex-file-diffs";

describe("Codex file diffs", () => {
  test("parses Codex file change entries and derives missing counts", () => {
    expect(
      toFileDiffs([
        {
          path: "src/app.ts",
          kind: "update",
          diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n-old\n+new\n+line",
        },
      ]),
    ).toEqual([
      {
        file: "src/app.ts",
        type: "modified",
        additions: 2,
        deletions: 1,
        diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n-old\n+new\n+line\n",
      },
    ]);
  });

  test("derives counts when Codex runtime counts are not finite", () => {
    expect(
      toFileDiffs([
        {
          path: "src/app.ts",
          additions: Number.NaN,
          deletions: Number.POSITIVE_INFINITY,
          diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n-old\n+new\n+line",
        },
      ]),
    ).toEqual([
      {
        file: "src/app.ts",
        type: "modified",
        additions: 2,
        deletions: 1,
        diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n-old\n+new\n+line\n",
      },
    ]);
  });

  test("parses nested Codex turn diff entries", () => {
    expect(
      toFileDiffs({
        data: [
          {
            fileChanges: [
              {
                file: "src/app.ts",
                type: "modified",
                additions: 1,
                deletions: 0,
                diff: "@@\n+new",
              },
            ],
          },
        ],
      }),
    ).toEqual([
      {
        file: "src/app.ts",
        type: "modified",
        additions: 1,
        deletions: 0,
        diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n+new\n",
      },
    ]);
  });

  test("rejects malformed Codex file change entries", () => {
    expect(() => toFileDiffs([{ file: "src/app.ts" }])).toThrow(CodexFileDiffParseError);
    expect(() => toFileDiffs([{ file: "src/app.ts" }])).toThrow(
      "Malformed Codex file change: entry 0 is missing string file/path or diff/patch fields.",
    );
    expect(() => toFileDiffs([{ file: "   ", diff: "@@\n+new" }])).toThrow(
      "Malformed Codex file change: entry 0 has empty file path.",
    );
  });

  test("infers added and deleted file diffs with CRLF headers", () => {
    expect(
      toFileDiffs([
        {
          file: "src/new.ts",
          diff: "--- /dev/null\r\n+++ b/src/new.ts\r\n@@\r\n+new",
        },
        {
          file: "src/old.ts",
          diff: "--- a/src/old.ts\r\n+++ /dev/null\r\n@@\r\n-old",
        },
      ]),
    ).toEqual([
      {
        file: "src/new.ts",
        type: "added",
        additions: 1,
        deletions: 0,
        diff: "--- /dev/null\n+++ b/src/new.ts\n@@\n+new\n",
      },
      {
        file: "src/old.ts",
        type: "deleted",
        additions: 0,
        deletions: 1,
        diff: "--- a/src/old.ts\n+++ /dev/null\n@@\n-old\n",
      },
    ]);
  });

  test("keeps modified Codex full-file text metadata-only instead of failing the tool", () => {
    expect(
      toFileDiffs([
        {
          file: "src/app.ts",
          type: "modified",
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
          file: "src/AuthContext.test.tsx",
          type: "added",
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

  test("uses Codex app-server move targets as the displayed file path", () => {
    expect(
      toFileDiffs([
        {
          path: "src/old.ts",
          kind: { type: "update", movePath: "src/new.ts" },
          diff: "--- a/src/old.ts\n+++ b/src/old.ts\n@@\n-old\n+new\n\nMoved to: src/new.ts",
        },
      ]),
    ).toEqual([
      {
        file: "src/new.ts",
        type: "modified",
        additions: 1,
        deletions: 1,
        diff: "--- a/src/old.ts\n+++ b/src/old.ts\n@@\n-old\n+new\n",
      },
    ]);
  });

  test("strips Codex full-file preambles before hunk-only diffs", () => {
    expect(
      toFileDiffs([
        {
          file: "src/AuthContext.test.tsx",
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
});
