import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import {
  withCapturedConsoleMethods,
  withCapturedOutputStreams,
} from "@/test-utils/console-capture";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";

let pierreViewerModule: typeof import("./pierre-diff-viewer");
let pierreViewerModelModule: typeof import("./pierre-diff-viewer-model");
let workerPoolMock: {
  cleanUpTasks?: ReturnType<typeof mock>;
  getDiffResultCache: ReturnType<typeof mock>;
  getFileResultCache?: ReturnType<typeof mock>;
  highlightDiffAST?: ReturnType<typeof mock>;
  highlightFileAST?: ReturnType<typeof mock>;
  isWorkingPool?: ReturnType<typeof mock>;
  primeDiffHighlightCache: ReturnType<typeof mock>;
  primeFileHighlightCache?: ReturnType<typeof mock>;
  subscribeToStatChanges?: ReturnType<typeof mock>;
} | null = null;
let pierreFileMountCount = 0;
let pierreFileDiffMountCount = 0;

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
  pierreFileMountCount = 0;
  pierreFileDiffMountCount = 0;
  await withCapturedOutputStreams(["stdout", "stderr"], async (chunksByStream) => {
    await withCapturedConsoleMethods(
      ["debug", "error", "info", "log", "warn"],
      async (consoleCalls) => {
        mock.module("@pierre/diffs/react", () => ({
          File: (props: {
            file: { name: string; contents: string; cacheKey?: string };
            options?: {
              disableFileHeader?: boolean;
              overflow?: string;
              themeType?: string;
              tokenizeMaxLength?: number;
            };
          }) => {
            const [mountId] = useState(() => {
              pierreFileMountCount += 1;
              return pierreFileMountCount;
            });
            return (
              <div
                data-testid="pierre-file"
                data-cache-key={props.file.cacheKey ?? ""}
                data-disable-file-header={String(props.options?.disableFileHeader ?? "")}
                data-file-contents={props.file.contents}
                data-file-name={props.file.name}
                data-mount-id={String(mountId)}
                data-overflow={String(props.options?.overflow ?? "")}
                data-theme-type={String(props.options?.themeType ?? "")}
                data-tokenize-max-length={String(props.options?.tokenizeMaxLength ?? "")}
              />
            );
          },
          FileDiff: (props: {
            options?: {
              diffIndicators?: string;
              diffStyle?: string;
              hunkSeparators?: string;
              lineDiffType?: string;
              onGutterUtilityClick?: (range: unknown) => void;
              onLineSelectionChange?: (range: unknown) => void;
              onLineSelectionStart?: (range: unknown) => void;
              overflow?: string;
              tokenizeMaxLength?: number;
            };
            selectedLines?: unknown;
          }) => {
            const { options } = props;
            const [mountId] = useState(() => {
              pierreFileDiffMountCount += 1;
              return pierreFileDiffMountCount;
            });
            const selectedLinesText = Object.hasOwn(props, "selectedLines")
              ? JSON.stringify(props.selectedLines)
              : OMITTED_SELECTED_LINES_LABEL;
            return (
              <div
                data-testid="pierre-file-diff"
                data-mount-id={String(mountId)}
                data-diff-indicators={String(options?.diffIndicators ?? "")}
                data-diff-style={String(options?.diffStyle ?? "")}
                data-hunk-separators={String(options?.hunkSeparators ?? "")}
                data-line-diff-type={String(options?.lineDiffType ?? "")}
                data-overflow={String(options?.overflow ?? "")}
                data-tokenize-max-length={String(options?.tokenizeMaxLength ?? "")}
              >
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
  test("keeps a cold diff hidden behind a skeleton until highlighting finishes", async () => {
    const { PierrePreloadedDiffViewer } = pierreViewerModule;
    let cachedHighlight: object | undefined;
    let notifyStatsChanged: (() => void) | undefined;
    const getDiffResultCache = mock(() => cachedHighlight);
    const primeDiffHighlightCache = mock();
    const highlightDiffAST = mock();
    const cleanUpTasks = mock();
    const unsubscribeFromStats = mock();
    const subscribeToStatChanges = mock((callback: () => void) => {
      notifyStatsChanged = callback;
      return unsubscribeFromStats;
    });
    workerPoolMock = {
      cleanUpTasks,
      getDiffResultCache,
      highlightDiffAST,
      isWorkingPool: mock(() => true),
      primeDiffHighlightCache,
      subscribeToStatChanges,
    };

    render(<PierrePreloadedDiffViewer patch={selectionPatch} filePath="src/app.ts" />);

    expect(screen.queryByTestId("pierre-file-diff")).toBeNull();
    expect(screen.getByTestId("pierre-diff-highlight-skeleton")).not.toBeNull();
    expect(highlightDiffAST).toHaveBeenCalledTimes(1);
    expect(primeDiffHighlightCache).not.toHaveBeenCalled();

    cachedHighlight = {};
    const [observer] = highlightDiffAST.mock.calls[0] ?? [];
    observer?.onHighlightSuccess();
    act(() => notifyStatsChanged?.());

    await waitFor(
      () => {
        expect(screen.getByTestId("pierre-file-diff").getAttribute("data-mount-id")).toBe("1");
        expect(screen.queryByTestId("pierre-diff-highlight-skeleton")).toBeNull();
      },
      { timeout: 1000 },
    );
    expect(cleanUpTasks).toHaveBeenCalledWith(observer);
    expect(unsubscribeFromStats).toHaveBeenCalledTimes(1);
    expect(getDiffResultCache.mock.calls.length).toBeGreaterThan(1);
  });

  test("shows an actionable error when diff highlighting fails", async () => {
    const { PierrePreloadedDiffViewer } = pierreViewerModule;
    const highlightDiffAST = mock();
    const cleanUpTasks = mock();
    workerPoolMock = {
      cleanUpTasks,
      getDiffResultCache: mock(() => undefined),
      highlightDiffAST,
      isWorkingPool: mock(() => true),
      primeDiffHighlightCache: mock(),
      subscribeToStatChanges: mock(() => () => undefined),
    };

    render(<PierrePreloadedDiffViewer patch={selectionPatch} filePath="src/app.ts" />);

    const [observer] = highlightDiffAST.mock.calls[0] ?? [];
    act(() => observer?.onHighlightError(new Error("worker failed")));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "Syntax highlighting failed for src/app.ts",
      );
    });
    expect(screen.queryByTestId("pierre-diff-highlight-skeleton")).toBeNull();
    expect(screen.queryByTestId("pierre-file-diff")).toBeNull();
    expect(cleanUpTasks).toHaveBeenCalledWith(observer);
  });

  test("renders a warm cached diff immediately without subscribing", () => {
    const { PierrePreloadedDiffViewer } = pierreViewerModule;
    const subscribeToStatChanges = mock(() => () => undefined);
    const primeDiffHighlightCache = mock();
    workerPoolMock = {
      getDiffResultCache: mock(() => ({})),
      isWorkingPool: mock(() => true),
      primeDiffHighlightCache,
      subscribeToStatChanges,
    };

    render(
      <PierrePreloadedDiffViewer
        patch={selectionPatch}
        filePath="src/app.ts"
        className="rounded-md"
      />,
    );

    expect(screen.getByTestId("pierre-file-diff").closest(".invisible")).toBeNull();
    expect(screen.getByTestId("pierre-file-diff").closest(".grid")?.className).toContain(
      "rounded-md",
    );
    expect(screen.queryByTestId("pierre-diff-highlight-skeleton")).toBeNull();
    expect(subscribeToStatChanges).not.toHaveBeenCalled();
    expect(primeDiffHighlightCache).not.toHaveBeenCalled();
  });

  test("renders oversized diffs as terminal plain content without entering loading", () => {
    const { PierrePreloadedDiffViewer } = pierreViewerModule;
    const subscribeToStatChanges = mock(() => () => undefined);
    const primeDiffHighlightCache = mock();
    workerPoolMock = {
      getDiffResultCache: mock(() => undefined),
      isWorkingPool: mock(() => true),
      primeDiffHighlightCache,
      subscribeToStatChanges,
    };
    const addedLines = Array.from({ length: 1001 }, (_, index) => `+value ${index}`);
    const oversizedPatch = [
      "diff --git a/src/generated.ts b/src/generated.ts",
      "--- /dev/null",
      "+++ b/src/generated.ts",
      "@@ -0,0 +1,1001 @@",
      ...addedLines,
      "",
    ].join("\n");

    render(<PierrePreloadedDiffViewer patch={oversizedPatch} filePath="src/generated.ts" />);

    expect(screen.queryByTestId("pierre-diff-highlight-skeleton")).toBeNull();
    expect(screen.getByTestId("pierre-file-diff").closest(".invisible")).toBeNull();
    expect(subscribeToStatChanges).not.toHaveBeenCalled();
    expect(primeDiffHighlightCache).not.toHaveBeenCalled();
  });

  test("renders plain-text diffs immediately without a worker pool", () => {
    const { PierrePreloadedDiffViewer } = pierreViewerModule;

    render(<PierrePreloadedDiffViewer patch={selectionPatch} filePath="notes.txt" />);

    expect(screen.getByTestId("pierre-file-diff").closest(".invisible")).toBeNull();
    expect(screen.queryByTestId("pierre-diff-highlight-skeleton")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("shows an actionable error when diff highlighting is unavailable", () => {
    const { PierrePreloadedDiffViewer } = pierreViewerModule;
    const subscribeToStatChanges = mock(() => () => undefined);
    workerPoolMock = {
      getDiffResultCache: mock(() => undefined),
      isWorkingPool: mock(() => false),
      primeDiffHighlightCache: mock(),
      subscribeToStatChanges,
    };

    render(<PierrePreloadedDiffViewer patch={selectionPatch} filePath="src/app.ts" />);

    expect(screen.getByRole("alert").textContent).toContain(
      "Syntax highlighting is unavailable for src/app.ts",
    );
    expect(screen.queryByTestId("pierre-diff-highlight-skeleton")).toBeNull();
    expect(screen.queryByTestId("pierre-file-diff")).toBeNull();
    expect(subscribeToStatChanges).not.toHaveBeenCalled();
  });

  test("preloads parsed diffs by priming the worker cache", async () => {
    const { PierreDiffPreloader } = pierreViewerModule;
    const primeDiffHighlightCache = mock();
    workerPoolMock = {
      getDiffResultCache: mock(() => null),
      isWorkingPool: mock(() => true),
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
      isWorkingPool: mock(() => true),
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

  test("skips preloading when the worker pool is unavailable", async () => {
    const { PierreDiffPreloader } = pierreViewerModule;
    const getDiffResultCache = mock(() => null);
    const primeDiffHighlightCache = mock();
    workerPoolMock = {
      getDiffResultCache,
      isWorkingPool: mock(() => false),
      primeDiffHighlightCache,
    };

    render(<PierreDiffPreloader patch={selectionPatch} filePath="src/app.ts" />);

    await waitFor(() => {
      expect(workerPoolMock?.isWorkingPool).toHaveBeenCalledTimes(1);
    });
    expect(getDiffResultCache).not.toHaveBeenCalled();
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
      language: "typescript",
    });
  });

  test("forwards default diff rendering options and keeps the capped scroll container", () => {
    const { PierreDiffViewer } = pierreViewerModule;

    render(<PierreDiffViewer patch={selectionPatch} filePath="src/app.ts" />);

    const diff = screen.getByTestId("pierre-file-diff");
    expect(diff.getAttribute("data-diff-style")).toBe("split");
    expect(diff.getAttribute("data-diff-indicators")).toBe("bars");
    expect(diff.getAttribute("data-hunk-separators")).toBe("line-info");
    expect(diff.getAttribute("data-line-diff-type")).toBe("word-alt");
    expect(diff.getAttribute("data-overflow")).toBe("wrap");
    expect(diff.getAttribute("data-tokenize-max-length")).toBe("1000");
    expect(diff.parentElement?.className).toContain("max-h-[min(50vh,32rem)]");
    expect(diff.parentElement?.className).toContain("overflow-auto");
  });

  test("forwards explicit diff rendering options and supports full-height parsed diffs", () => {
    const { PierreDiffViewer } = pierreViewerModule;

    render(
      <PierreDiffViewer
        patch={selectionPatch}
        filePath="src/app.ts"
        diffStyle="unified"
        diffIndicators="classic"
        hunkSeparators="metadata"
        lineOverflow="scroll"
        heightMode="full"
      />,
    );

    const diff = screen.getByTestId("pierre-file-diff");
    expect(diff.getAttribute("data-diff-style")).toBe("unified");
    expect(diff.getAttribute("data-diff-indicators")).toBe("classic");
    expect(diff.getAttribute("data-hunk-separators")).toBe("metadata");
    expect(diff.getAttribute("data-line-diff-type")).toBe("none");
    expect(diff.getAttribute("data-overflow")).toBe("scroll");
    expect(diff.parentElement?.className).not.toContain("max-h-[min(50vh,32rem)]");
    expect(diff.parentElement?.className).not.toContain("overflow-auto");
  });

  test("renders cached file content immediately with a worker cache key", () => {
    const { PierreFileViewer } = pierreViewerModule;
    const subscribeToStatChanges = mock(() => () => undefined);
    const primeFileHighlightCache = mock();
    workerPoolMock = {
      getDiffResultCache: mock(() => null),
      getFileResultCache: mock(() => ({})),
      isWorkingPool: mock(() => true),
      primeDiffHighlightCache: mock(),
      primeFileHighlightCache,
      subscribeToStatChanges,
    };
    const { rerender } = render(
      <PierreFileViewer filePath="src/AuthContext.test.tsx" content="export const value = 1;" />,
    );

    const file = screen.getByTestId("pierre-file");
    expect(file.getAttribute("data-file-name")).toBe("src/AuthContext.test.tsx");
    expect(file.getAttribute("data-file-contents")).toBe("export const value = 1;");
    expect(file.getAttribute("data-cache-key")).toContain("src/AuthContext.test.tsx:");
    expect(file.getAttribute("data-disable-file-header")).toBe("true");
    expect(file.getAttribute("data-overflow")).toBe("wrap");
    expect(file.getAttribute("data-theme-type")).toBe("light");
    expect(file.getAttribute("data-tokenize-max-length")).toBe("1000");
    expect(screen.queryByTestId("pierre-file-highlight-skeleton")).toBeNull();
    expect(subscribeToStatChanges).not.toHaveBeenCalled();
    expect(primeFileHighlightCache).not.toHaveBeenCalled();
    expect(file.parentElement?.parentElement?.parentElement?.className).toContain(
      "max-h-[min(50vh,32rem)]",
    );

    const firstCacheKey = file.getAttribute("data-cache-key");
    rerender(
      <PierreFileViewer filePath="src/AuthContext.test.tsx" content="export const value = 2;" />,
    );

    expect(screen.getByTestId("pierre-file").getAttribute("data-cache-key")).not.toBe(
      firstCacheKey,
    );
  });

  test("keeps cold file content hidden behind a skeleton until highlighting finishes", async () => {
    const { PierreFileViewer } = pierreViewerModule;
    let cachedHighlight: object | undefined;
    let notifyStatsChanged: (() => void) | undefined;
    const getFileResultCache = mock(() => cachedHighlight);
    const primeFileHighlightCache = mock();
    const highlightFileAST = mock();
    const cleanUpTasks = mock();
    const unsubscribeFromStats = mock();
    const subscribeToStatChanges = mock((callback: () => void) => {
      notifyStatsChanged = callback;
      return unsubscribeFromStats;
    });
    workerPoolMock = {
      cleanUpTasks,
      getDiffResultCache: mock(() => null),
      getFileResultCache,
      highlightFileAST,
      isWorkingPool: mock(() => true),
      primeDiffHighlightCache: mock(),
      primeFileHighlightCache,
      subscribeToStatChanges,
    };

    render(
      <PierreFileViewer filePath="src/AuthContext.test.tsx" content="export const value = 1;" />,
    );

    expect(screen.queryByTestId("pierre-file")).toBeNull();
    expect(screen.getByTestId("pierre-file-highlight-skeleton")).not.toBeNull();
    expect(highlightFileAST).toHaveBeenCalledTimes(1);
    expect(primeFileHighlightCache).not.toHaveBeenCalled();

    cachedHighlight = {};
    const [observer] = highlightFileAST.mock.calls[0] ?? [];
    observer?.onHighlightSuccess();
    act(() => notifyStatsChanged?.());

    await waitFor(
      () => {
        expect(screen.getByTestId("pierre-file").getAttribute("data-mount-id")).toBe("1");
        expect(screen.queryByTestId("pierre-file-highlight-skeleton")).toBeNull();
      },
      { timeout: 1000 },
    );
    expect(cleanUpTasks).toHaveBeenCalledWith(observer);
    expect(unsubscribeFromStats).toHaveBeenCalledTimes(1);
    expect(getFileResultCache.mock.calls.length).toBeGreaterThan(1);
  });

  test("shows an actionable error when file highlighting fails", async () => {
    const { PierreFileViewer } = pierreViewerModule;
    const highlightFileAST = mock();
    const cleanUpTasks = mock();
    workerPoolMock = {
      cleanUpTasks,
      getDiffResultCache: mock(() => null),
      getFileResultCache: mock(() => undefined),
      highlightFileAST,
      isWorkingPool: mock(() => true),
      primeDiffHighlightCache: mock(),
      subscribeToStatChanges: mock(() => () => undefined),
    };

    render(
      <PierreFileViewer filePath="src/AuthContext.test.tsx" content="export const value = 1;" />,
    );

    const [observer] = highlightFileAST.mock.calls[0] ?? [];
    act(() => observer?.onHighlightError(new Error("worker failed")));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "Syntax highlighting failed for src/AuthContext.test.tsx",
      );
    });
    expect(screen.queryByTestId("pierre-file-highlight-skeleton")).toBeNull();
    expect(screen.queryByTestId("pierre-file")).toBeNull();
    expect(cleanUpTasks).toHaveBeenCalledWith(observer);
  });

  test("renders oversized code as terminal plain content without entering loading", () => {
    const { PierreFileViewer } = pierreViewerModule;
    const subscribeToStatChanges = mock(() => () => undefined);
    const primeFileHighlightCache = mock();
    workerPoolMock = {
      getDiffResultCache: mock(() => null),
      getFileResultCache: mock(() => undefined),
      isWorkingPool: mock(() => true),
      primeDiffHighlightCache: mock(),
      primeFileHighlightCache,
      subscribeToStatChanges,
    };
    const oversizedContent = Array.from(
      { length: 1001 },
      (_, index) => `export const value${index} = ${index};`,
    ).join("\n");

    render(<PierreFileViewer filePath="src/generated.ts" content={oversizedContent} />);

    expect(screen.queryByTestId("pierre-file-highlight-skeleton")).toBeNull();
    expect(screen.getByTestId("pierre-file").parentElement?.className).not.toContain("invisible");
    expect(subscribeToStatChanges).not.toHaveBeenCalled();
    expect(primeFileHighlightCache).not.toHaveBeenCalled();
  });

  test("renders plain-text files immediately without a worker pool", () => {
    const { PierreFileViewer } = pierreViewerModule;

    render(<PierreFileViewer filePath="notes.txt" content="No syntax highlighting required." />);

    expect(screen.getByTestId("pierre-file").parentElement?.className).not.toContain("invisible");
    expect(screen.queryByTestId("pierre-file-highlight-skeleton")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("shows an actionable error when the highlight worker pool is unavailable", () => {
    const { PierreFileViewer } = pierreViewerModule;
    const subscribeToStatChanges = mock(() => () => undefined);
    workerPoolMock = {
      getDiffResultCache: mock(() => null),
      getFileResultCache: mock(() => undefined),
      isWorkingPool: mock(() => false),
      primeDiffHighlightCache: mock(),
      subscribeToStatChanges,
    };

    render(
      <PierreFileViewer filePath="src/AuthContext.test.tsx" content="export const value = 1;" />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Syntax highlighting is unavailable for src/AuthContext.test.tsx",
    );
    expect(screen.queryByTestId("pierre-file-highlight-skeleton")).toBeNull();
    expect(screen.queryByTestId("pierre-file")).toBeNull();
    expect(subscribeToStatChanges).not.toHaveBeenCalled();
  });

  test("keeps raw fallback diffs inside the Pierre scroll container", async () => {
    const { PierreDiffViewer } = pierreViewerModule;

    await withCapturedOutputStreams(["stdout", "stderr"], async (chunksByStream) => {
      await withCapturedConsoleMethods(
        ["debug", "error", "info", "log", "warn"],
        async (consoleCalls) => {
          render(
            <PierreDiffViewer
              patch="Index: src/app.ts\n=====\ninvalid diff body"
              filePath="src/app.ts"
            />,
          );
          await new Promise((resolve) => setTimeout(resolve, 0));

          for (const calls of Object.values(consoleCalls)) {
            for (const call of calls) {
              expect(call).toEqual([[]]);
            }
          }
        },
      );

      for (const chunk of [...chunksByStream.stdout, ...chunksByStream.stderr]) {
        expect(chunk).toBe("[]\n");
      }
    });

    const fallback = screen.getByText(/invalid diff body/);
    expect(fallback.parentElement?.className).toContain("overflow-auto");
    expect(fallback.parentElement?.className).toContain("max-h-[min(50vh,32rem)]");
    expect(fallback.className).toContain("whitespace-pre-wrap");
    expect(fallback.className).toContain("break-words");
  });

  test("renders full-height raw fallback diffs with horizontal line scrolling", async () => {
    const { PierreDiffViewer } = pierreViewerModule;

    await withCapturedOutputStreams(["stdout", "stderr"], async (chunksByStream) => {
      await withCapturedConsoleMethods(
        ["debug", "error", "info", "log", "warn"],
        async (consoleCalls) => {
          render(
            <PierreDiffViewer
              patch="Index: src/app.ts\n=====\ninvalid diff body"
              filePath="src/app.ts"
              heightMode="full"
              lineOverflow="scroll"
            />,
          );
          await new Promise((resolve) => setTimeout(resolve, 0));

          for (const calls of Object.values(consoleCalls)) {
            for (const call of calls) {
              expect(call).toEqual([[]]);
            }
          }
        },
      );

      for (const chunk of [...chunksByStream.stdout, ...chunksByStream.stderr]) {
        expect(chunk).toBe("[]\n");
      }
    });

    const fallback = screen.getByText(/invalid diff body/);
    expect(fallback.parentElement?.className).not.toContain("max-h-[min(50vh,32rem)]");
    expect(fallback.parentElement?.className).not.toContain("overflow-auto");
    expect(fallback.className).toContain("whitespace-pre");
    expect(fallback.className).toContain("overflow-x-auto");
    expect(fallback.className).not.toContain("break-words");
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
    const result = getRenderableFileDiff("@@ -1 +1 @@\n-old\n+new\n", "src/hunk.tsx");

    expect(result.normalizedPatch).toBe(
      "--- a/src/hunk.tsx\n+++ b/src/hunk.tsx\n@@ -1 +1 @@\n-old\n+new\n",
    );
    expect(result.fileDiff?.name.endsWith("src/hunk.tsx")).toBe(true);
    expect(result.fileDiff?.lang).toBe("tsx");
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
      language: "typescript",
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
      language: "typescript",
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
