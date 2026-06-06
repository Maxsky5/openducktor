import { describe, expect, test } from "bun:test";
import { CodexFileDiffParseError, toFileDiffs } from "./codex-file-diffs";

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
});
