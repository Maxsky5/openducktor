import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  withCapturedConsoleMethods,
  withCapturedOutputStreams,
} from "@/test-utils/console-capture";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";

let pierreViewerModule: typeof import("./pierre-diff-viewer");

beforeEach(async () => {
  await withCapturedOutputStreams(["stdout", "stderr"], async (chunksByStream) => {
    await withCapturedConsoleMethods(
      ["debug", "error", "info", "log", "warn"],
      async (consoleCalls) => {
        mock.module("@pierre/diffs/react", () => ({
          FileDiff: () => null,
          Virtualizer: ({ children }: { children: React.ReactNode }) => children,
          useWorkerPool: () => null,
        }));

        pierreViewerModule = await import("./pierre-diff-viewer");

        for (const calls of Object.values(consoleCalls)) {
          for (const call of calls) {
            expect(call).toEqual([]);
          }
        }
      },
    );

    for (const chunk of [...chunksByStream.stdout, ...chunksByStream.stderr]) {
      expect(chunk).toBe("[]\n");
    }
  });
});

afterEach(async () => {
  await withCapturedOutputStreams(["stdout", "stderr"], async (chunksByStream) => {
    await withCapturedConsoleMethods(
      ["debug", "error", "info", "log", "warn"],
      async (consoleCalls) => {
        await restoreMockedModules([["@pierre/diffs/react", () => import("@pierre/diffs/react")]]);
        for (const calls of Object.values(consoleCalls)) {
          for (const call of calls) {
            expect(call).toEqual([]);
          }
        }
      },
    );

    for (const chunk of [...chunksByStream.stdout, ...chunksByStream.stderr]) {
      expect(chunk).toBe("[]\n");
    }
  });
});

const requireFileDiff = (
  fileDiff: ReturnType<typeof import("./pierre-diff-viewer")["getRenderableFileDiff"]>["fileDiff"],
) => {
  expect(fileDiff).not.toBeNull();
  if (fileDiff == null) {
    throw new Error("Expected parsed file diff metadata");
  }
  return fileDiff;
};

describe("getRenderableFileDiff", () => {
  test("parses valid git patches", async () => {
    const { getRenderableFileDiff } = pierreViewerModule;
    const patch =
      "diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n";

    const result = getRenderableFileDiff(patch, "src/app.ts");

    expect(result.normalizedPatch).toBe(patch);
    expect(result.fallbackPatch).toBe(patch);
    expect(result.fileDiff?.name.endsWith("src/app.ts")).toBe(true);
  });

  test("normalizes hunk-only patches with the current file path", async () => {
    const { getRenderableFileDiff } = pierreViewerModule;
    const result = getRenderableFileDiff("@@ -1 +1 @@\n-old\n+new\n", "src/hunk.ts");

    expect(result.normalizedPatch).toBe(
      "--- a/src/hunk.ts\n+++ b/src/hunk.ts\n@@ -1 +1 @@\n-old\n+new\n",
    );
    expect(result.fileDiff?.name.endsWith("src/hunk.ts")).toBe(true);
  });

  test("keeps normalized raw diff text when parsing still fails", async () => {
    const { getRenderableFileDiff } = pierreViewerModule;
    const result = await withCapturedOutputStreams(["stdout", "stderr"], async (chunksByStream) => {
      return await withCapturedConsoleMethods(
        ["debug", "error", "info", "log", "warn"],
        async (consoleCalls) => {
          const parseResult = getRenderableFileDiff(
            "Index: src/app.ts\n=====\ninvalid diff body",
            "src/app.ts",
          );
          await new Promise((resolve) => setTimeout(resolve, 0));

          for (const calls of Object.values(consoleCalls)) {
            for (const call of calls) {
              expect(call).toEqual([[]]);
            }
          }
          for (const chunk of [...chunksByStream.stdout, ...chunksByStream.stderr]) {
            expect(chunk).toBe("[]\n");
          }

          return parseResult;
        },
      );
    });

    expect(result.fileDiff).toBeNull();
    expect(result.fallbackPatch).toBe("Index: src/app.ts\n=====\ninvalid diff body\n");
  });

  test("builds hunk reset annotations for the first and subsequent hunks", async () => {
    const { getHunkResetAnnotations, getRenderableFileDiff } = pierreViewerModule;
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
    const annotations = getHunkResetAnnotations(requireFileDiff(fileDiff));

    expect(annotations).toEqual([
      {
        side: "additions",
        lineNumber: 1,
        metadata: { kind: "hunk-reset", hunkIndex: 0 },
      },
      {
        side: "additions",
        lineNumber: 10,
        metadata: { kind: "hunk-reset", hunkIndex: 1 },
      },
    ]);
  });

  test("falls back to deletion lines for delete-only hunks", async () => {
    const { getHunkResetAnnotations, getRenderableFileDiff } = pierreViewerModule;
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

    expect(getHunkResetAnnotations(requireFileDiff(fileDiff))).toEqual([
      {
        side: "deletions",
        lineNumber: 3,
        metadata: { kind: "hunk-reset", hunkIndex: 0 },
      },
    ]);
  });

  test("builds an inline comment selection snapshot for additions with surrounding context", async () => {
    const { buildPierreDiffSelection, getRenderableFileDiff } = pierreViewerModule;
    const patch = [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,4 +1,5 @@",
      " one",
      "-two",
      "+two updated",
      "+two extra",
      " three",
      " four",
      "",
    ].join("\n");
    const { fileDiff } = getRenderableFileDiff(patch, "src/app.ts");

    expect(
      buildPierreDiffSelection(requireFileDiff(fileDiff), {
        start: 2,
        end: 3,
        side: "additions",
        endSide: "additions",
      }),
    ).toEqual({
      selectedLines: {
        start: 2,
        end: 3,
        side: "additions",
        endSide: "additions",
      },
      side: "new",
      startLine: 2,
      endLine: 3,
      codeContext: [
        { lineNumber: 1, text: "one", isSelected: false },
        { lineNumber: 2, text: "two updated", isSelected: true },
        { lineNumber: 3, text: "two extra", isSelected: true },
        { lineNumber: 4, text: "three", isSelected: false },
        { lineNumber: 5, text: "four", isSelected: false },
      ],
      language: null,
    });
  });

  test("builds an inline comment selection snapshot for old-side ranges", async () => {
    const { buildPierreDiffSelection, getRenderableFileDiff } = pierreViewerModule;
    const patch = [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -8,4 +8,2 @@",
      " eight",
      "-nine",
      "-ten",
      " eleven",
      "",
    ].join("\n");
    const { fileDiff } = getRenderableFileDiff(patch, "src/app.ts");

    expect(
      buildPierreDiffSelection(requireFileDiff(fileDiff), {
        start: 9,
        end: 10,
        side: "deletions",
        endSide: "deletions",
      }),
    ).toEqual({
      selectedLines: {
        start: 9,
        end: 10,
        side: "deletions",
        endSide: "deletions",
      },
      side: "old",
      startLine: 9,
      endLine: 10,
      codeContext: [
        { lineNumber: 8, text: "eight", isSelected: false },
        { lineNumber: 9, text: "nine", isSelected: true },
        { lineNumber: 10, text: "ten", isSelected: true },
        { lineNumber: 11, text: "eleven", isSelected: false },
      ],
      language: null,
    });
  });

  test("rejects mixed-side selections for inline comments", async () => {
    const { buildPierreDiffSelection, getRenderableFileDiff } = pierreViewerModule;
    const patch = [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "",
    ].join("\n");
    const { fileDiff } = getRenderableFileDiff(patch, "src/app.ts");

    expect(
      buildPierreDiffSelection(requireFileDiff(fileDiff), {
        start: 1,
        end: 1,
        side: "deletions",
        endSide: "additions",
      }),
    ).toBeNull();
  });
});
