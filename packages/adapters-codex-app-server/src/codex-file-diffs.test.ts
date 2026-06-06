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
        type: "update",
        additions: 2,
        deletions: 1,
        diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n-old\n+new\n+line",
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
        diff: "@@\n+new",
      },
    ]);
  });

  test("rejects malformed Codex file change entries", () => {
    expect(() => toFileDiffs([{ file: "src/app.ts" }])).toThrow(CodexFileDiffParseError);
    expect(() => toFileDiffs([{ file: "src/app.ts" }])).toThrow(
      "Malformed Codex file change: entry 0 is missing string file/path or diff/patch fields.",
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
        diff: "--- /dev/null\r\n+++ b/src/new.ts\r\n@@\r\n+new",
      },
      {
        file: "src/old.ts",
        type: "deleted",
        additions: 0,
        deletions: 1,
        diff: "--- a/src/old.ts\r\n+++ /dev/null\r\n@@\r\n-old",
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
        diff: "*** Update File: src/app.ts\n@@\n-old\n+new",
      },
      {
        file: "src/new.ts",
        type: "added",
        additions: 1,
        deletions: 0,
        diff: "*** Add File: src/new.ts\n+created",
      },
    ]);
  });
});
