import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  withCapturedConsoleMethods,
  withCapturedOutputStreams,
} from "@/test-utils/console-capture";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";

let pierreViewerModule: typeof import("./pierre-diff-viewer");
let pierreViewerModelModule: typeof import("./pierre-diff-viewer-model");
let workerPoolMock: {
  getDiffResultCache: ReturnType<typeof mock>;
  primeDiffHighlightCache: ReturnType<typeof mock>;
} | null = null;

const OMITTED_SELECTED_LINES_LABEL = "__omitted__";
const mockedGutterSelection = {
  start: 2,
  end: 3,
  side: "additions" as const,
  endSide: "additions" as const,
};
const selectionPatch = [
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

beforeEach(async () => {
  await withCapturedOutputStreams(["stdout", "stderr"], async (chunksByStream) => {
    await withCapturedConsoleMethods(
      ["debug", "error", "info", "log", "warn"],
      async (consoleCalls) => {
        mock.module("@pierre/diffs/react", () => ({
          FileDiff: (props: {
            options?: {
              onGutterUtilityClick?: (range: unknown) => void;
              onLineSelectionChange?: (range: unknown) => void;
              onLineSelectionStart?: (range: unknown) => void;
            };
            selectedLines?: unknown;
          }) => {
            const { options } = props;
            const selectedLinesText = Object.hasOwn(props, "selectedLines")
              ? JSON.stringify(props.selectedLines)
              : OMITTED_SELECTED_LINES_LABEL;
            return (
              <div>
                <output data-testid="pierre-selected-lines">{selectedLinesText}</output>
                <button
                  type="button"
                  data-testid="pierre-selection-start"
                  onClick={() => options?.onLineSelectionStart?.(mockedGutterSelection)}
                >
                  Selection start
                </button>
                <button
                  type="button"
                  data-testid="pierre-selection-change"
                  onClick={() => options?.onLineSelectionChange?.(mockedGutterSelection)}
                >
                  Selection change
                </button>
                <button
                  type="button"
                  data-testid="pierre-gutter-utility"
                  onClick={() => options?.onGutterUtilityClick?.(mockedGutterSelection)}
                >
                  Gutter utility
                </button>
              </div>
            );
          },
          Virtualizer: ({ children }: { children: React.ReactNode }) => children,
          useWorkerPool: () => workerPoolMock,
        }));
        mock.module("@/components/layout/theme-provider", () => ({
          useTheme: () => ({ theme: "light", setTheme: () => undefined }),
        }));

        pierreViewerModule = await import("./pierre-diff-viewer");
        pierreViewerModelModule = await import("./pierre-diff-viewer-model");

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
  cleanup();
  workerPoolMock = null;

  await withCapturedOutputStreams(["stdout", "stderr"], async (chunksByStream) => {
    await withCapturedConsoleMethods(
      ["debug", "error", "info", "log", "warn"],
      async (consoleCalls) => {
        await restoreMockedModules([
          ["@pierre/diffs/react", () => import("@pierre/diffs/react")],
          [
            "@/components/layout/theme-provider",
            () => import("@/components/layout/theme-provider"),
          ],
        ]);
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

describe("PierreDiffViewer", () => {
  test("preloads parsed diffs by priming the worker cache", async () => {
    const { PierreDiffPreloader } = pierreViewerModule;
    const primeDiffHighlightCache = mock();
    workerPoolMock = {
      getDiffResultCache: mock(() => null),
      primeDiffHighlightCache,
    };

    render(<PierreDiffPreloader patch={selectionPatch} filePath="src/app.ts" />);

    await waitFor(
      () => {
        expect(primeDiffHighlightCache).toHaveBeenCalledTimes(1);
      },
      { timeout: 1000 },
    );
    const [fileDiff] = primeDiffHighlightCache.mock.calls[0] ?? [];
    expect(fileDiff).toBeDefined();
    expect(fileDiff?.cacheKey).toBeString();
    expect(workerPoolMock.getDiffResultCache).toHaveBeenCalledWith(fileDiff);
  });

  test("skips preloading when the worker already cached the parsed diff", async () => {
    const { PierreDiffPreloader } = pierreViewerModule;
    const cachedHighlightResult = {};
    const getDiffResultCache = mock(() => cachedHighlightResult);
    const primeDiffHighlightCache = mock();
    workerPoolMock = {
      getDiffResultCache,
      primeDiffHighlightCache,
    };

    render(<PierreDiffPreloader patch={selectionPatch} filePath="src/app.ts" />);

    await waitFor(
      () => {
        expect(getDiffResultCache).toHaveBeenCalledTimes(1);
      },
      { timeout: 1000 },
    );
    expect(primeDiffHighlightCache).not.toHaveBeenCalled();
  });

  test("keeps controlled selected lines in sync while dragging from the gutter utility", () => {
    const { PierreDiffViewer } = pierreViewerModule;

    render(
      <PierreDiffViewer
        patch={selectionPatch}
        filePath="src/app.ts"
        enableLineSelection
        enableGutterUtility
        selectedLines={null}
        onLineSelectionEnd={mock()}
      />,
    );

    expect(screen.getByTestId("pierre-selected-lines").textContent).toBe("null");

    fireEvent.click(screen.getByTestId("pierre-selection-start"));

    expect(screen.getByTestId("pierre-selected-lines").textContent).toBe(
      JSON.stringify(mockedGutterSelection),
    );
  });

  test("leaves selected lines uncontrolled when the caller omits selectedLines", () => {
    const { PierreDiffViewer } = pierreViewerModule;

    render(
      <PierreDiffViewer
        patch={selectionPatch}
        filePath="src/app.ts"
        enableLineSelection
        onLineSelectionEnd={mock()}
      />,
    );

    expect(screen.getByTestId("pierre-selected-lines").textContent).toBe(
      OMITTED_SELECTED_LINES_LABEL,
    );

    fireEvent.click(screen.getByTestId("pierre-selection-change"));

    expect(screen.getByTestId("pierre-selected-lines").textContent).toBe(
      OMITTED_SELECTED_LINES_LABEL,
    );
  });

  test("does not mirror controlled selected lines without a completion handler", () => {
    const { PierreDiffViewer } = pierreViewerModule;

    render(
      <PierreDiffViewer
        patch={selectionPatch}
        filePath="src/app.ts"
        enableLineSelection
        selectedLines={null}
      />,
    );

    expect(screen.getByTestId("pierre-selected-lines").textContent).toBe("null");

    fireEvent.click(screen.getByTestId("pierre-selection-start"));

    expect(screen.getByTestId("pierre-selected-lines").textContent).toBe("null");
  });

  test("opens inline comment selection from the gutter utility", () => {
    const { PierreDiffViewer } = pierreViewerModule;
    const onLineSelectionEnd = mock();

    render(
      <PierreDiffViewer
        patch={selectionPatch}
        filePath="src/app.ts"
        enableGutterUtility
        onLineSelectionEnd={onLineSelectionEnd}
      />,
    );

    fireEvent.click(screen.getByTestId("pierre-gutter-utility"));

    expect(onLineSelectionEnd).toHaveBeenCalledWith({
      selectedLines: mockedGutterSelection,
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
});

const requireFileDiff = (
  fileDiff: ReturnType<
    typeof import("./pierre-diff-viewer-model")["getRenderableFileDiff"]
  >["fileDiff"],
) => {
  expect(fileDiff).not.toBeNull();
  if (fileDiff == null) {
    throw new Error("Expected parsed file diff metadata");
  }
  return fileDiff;
};

describe("getRenderableFileDiff", () => {
  test("parses valid git patches", async () => {
    const { getRenderableFileDiff } = pierreViewerModelModule;
    const patch =
      "diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n";

    const result = getRenderableFileDiff(patch, "src/app.ts");

    expect(result.normalizedPatch).toBe(patch);
    expect(result.fallbackPatch).toBe(patch);
    expect(result.fileDiff?.name.endsWith("src/app.ts")).toBe(true);
  });

  test("normalizes hunk-only patches with the current file path", async () => {
    const { getRenderableFileDiff } = pierreViewerModelModule;
    const result = getRenderableFileDiff("@@ -1 +1 @@\n-old\n+new\n", "src/hunk.ts");

    expect(result.normalizedPatch).toBe(
      "--- a/src/hunk.ts\n+++ b/src/hunk.ts\n@@ -1 +1 @@\n-old\n+new\n",
    );
    expect(result.fileDiff?.name.endsWith("src/hunk.ts")).toBe(true);
  });

  test("assigns stable cache keys to parsed diffs for worker preloading", async () => {
    const { getRenderableFileDiff } = pierreViewerModelModule;
    const patch =
      "diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n";

    const firstResult = getRenderableFileDiff(patch, "src/app.ts");
    const secondResult = getRenderableFileDiff(patch, "src/app.ts");
    const renamedResult = getRenderableFileDiff(patch, "src/other.ts");

    expect(firstResult.fileDiff?.cacheKey).toBeString();
    expect(firstResult.fileDiff?.cacheKey).toBe(secondResult.fileDiff?.cacheKey);
    expect(firstResult.fileDiff?.cacheKey).not.toBe(renamedResult.fileDiff?.cacheKey);
  });

  test("keeps worker cache keys compact for large parsed diffs", async () => {
    const { getRenderableFileDiff } = pierreViewerModelModule;
    const addedLines = Array.from({ length: 200 }, (_, index) => `+new-${index}`).join("\n");
    const patch = `diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -0,0 +1,200 @@\n${addedLines}\n`;
    const changedPatch = patch.replace("+new-199", "+changed");

    const result = getRenderableFileDiff(patch, "src/app.ts");
    const changedResult = getRenderableFileDiff(changedPatch, "src/app.ts");
    const cacheKey = result.fileDiff?.cacheKey;

    expect(cacheKey).toBeString();
    expect(cacheKey?.length).toBeLessThan(120);
    expect(cacheKey).not.toContain("new-199");
    expect(cacheKey).not.toBe(changedResult.fileDiff?.cacheKey);
  });

  test("keeps worker cache keys stable after renderable diff cache eviction", async () => {
    const { getRenderableFileDiff } = pierreViewerModelModule;
    const originalPatch =
      "diff --git a/src/stable.ts b/src/stable.ts\n--- a/src/stable.ts\n+++ b/src/stable.ts\n@@ -1 +1 @@\n-old\n+new\n";

    const firstResult = getRenderableFileDiff(originalPatch, "src/stable.ts");
    for (let index = 0; index < 80; index += 1) {
      const filePath = `src/evict-${index}.ts`;
      getRenderableFileDiff(
        `diff --git a/${filePath} b/${filePath}\n--- a/${filePath}\n+++ b/${filePath}\n@@ -1 +1 @@\n-old-${index}\n+new-${index}\n`,
        filePath,
      );
    }
    const reloadedResult = getRenderableFileDiff(originalPatch, "src/stable.ts");

    expect(firstResult).not.toBe(reloadedResult);
    expect(firstResult.fileDiff?.cacheKey).toBe(reloadedResult.fileDiff?.cacheKey);
  });

  test("keeps normalized raw diff text when parsing still fails", async () => {
    const { getRenderableFileDiff } = pierreViewerModelModule;
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
    const { getHunkResetAnnotations, getRenderableFileDiff } = pierreViewerModelModule;
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
    const { getHunkResetAnnotations, getRenderableFileDiff } = pierreViewerModelModule;
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
    const { buildPierreDiffSelection, getRenderableFileDiff } = pierreViewerModelModule;
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
    const { buildPierreDiffSelection, getRenderableFileDiff } = pierreViewerModelModule;
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
    const { buildPierreDiffSelection, getRenderableFileDiff } = pierreViewerModelModule;
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
