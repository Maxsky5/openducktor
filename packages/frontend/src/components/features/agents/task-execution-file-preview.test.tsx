import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { WorkspaceTextFileReadResult } from "@openducktor/contracts";
import { getFiletypeFromFileName } from "@pierre/diffs";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createElement,
  type PropsWithChildren,
  type ReactElement,
  useEffect,
  useState,
} from "react";
import { createQueryClient } from "@/lib/query-client";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import type { TaskExecutionSelectedFile } from "./task-execution-file-explorer-model";
import type { TaskExecutionSelectedFilePreviewModel } from "./task-execution-file-preview";

enableReactActEnvironment();

type PreviewComponent =
  typeof import("./task-execution-file-preview")["TaskExecutionSelectedFilePreview"];

let TaskExecutionSelectedFilePreview: PreviewComponent;
let readTextFileMock: ReturnType<typeof mock>;
let codeViewMountCount = 0;
let codeViewUnmountCount = 0;
let secondFileReadMode: "pending" | "resolve" = "pending";
let previewTheme: "light" | "dark" = "light";
let highlightCompletionMode: "auto" | "manual" = "auto";
let primeFileHighlightCacheMock: ReturnType<typeof mock>;
const highlightedFileCacheKeys = new Set<string>();
const highlightCacheSubscribers = new Set<() => void>();

const completeFileHighlight = (file: { cacheKey?: string }): void => {
  if (file.cacheKey) {
    highlightedFileCacheKeys.add(file.cacheKey);
  }
  for (const subscriber of highlightCacheSubscribers) {
    subscriber();
  }
};

const previewWorkerPool = {
  isWorkingPool: () => false,
  getFileResultCache: (file: { cacheKey?: string }) =>
    file.cacheKey && highlightedFileCacheKeys.has(file.cacheKey) ? {} : undefined,
  primeFileHighlightCache: (file: { cacheKey?: string; name?: string }) => {
    primeFileHighlightCacheMock(file);
    if (getFiletypeFromFileName(file.name ?? "") === "text") {
      return;
    }
    if (highlightCompletionMode === "auto") {
      queueMicrotask(() => completeFileHighlight(file));
    }
  },
  subscribeToStatChanges: (subscriber: () => void) => {
    highlightCacheSubscribers.add(subscriber);
    subscriber();
    return () => highlightCacheSubscribers.delete(subscriber);
  },
};

const actualDiffsReact = await import("@pierre/diffs/react");
const actualThemeProvider = await import("@/components/layout/theme-provider");
const actualHost = await import("@/state/operations/host");

const firstFile: TaskExecutionSelectedFile = {
  rootPath: "/repo",
  relativePath: "src/first.ts",
};
const secondFile: TaskExecutionSelectedFile = {
  rootPath: "/repo",
  relativePath: "src/second.ts",
};
const editorConfigFile: TaskExecutionSelectedFile = {
  rootPath: "/repo",
  relativePath: ".editorconfig",
};

const textFileResult = (
  selectedFile: TaskExecutionSelectedFile,
  contents: string,
): WorkspaceTextFileReadResult => ({
  kind: "text",
  rootPath: selectedFile.rootPath,
  relativePath: selectedFile.relativePath,
  contents,
  size: contents.length,
  mtimeMs: 1_760_000_000_000,
});

function PreviewTestProviders({ children }: PropsWithChildren): ReactElement {
  const [queryClient] = useState(createQueryClient);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const renderPreview = (
  model: Omit<
    TaskExecutionSelectedFilePreviewModel,
    "previewSessionKey" | "preservePreviousSnapshot"
  > & {
    previewSessionKey?: number;
    preservePreviousSnapshot?: boolean;
  },
  theme: "light" | "dark" = "light",
) => {
  const fullModel: TaskExecutionSelectedFilePreviewModel = {
    previewSessionKey: 0,
    preservePreviousSnapshot: false,
    ...model,
  };
  previewTheme = theme;

  return (
    <PreviewTestProviders>
      <TaskExecutionSelectedFilePreview model={fullModel} />
    </PreviewTestProviders>
  );
};

beforeEach(async () => {
  codeViewMountCount = 0;
  codeViewUnmountCount = 0;
  secondFileReadMode = "pending";
  previewTheme = "light";
  highlightCompletionMode = "auto";
  highlightedFileCacheKeys.clear();
  highlightCacheSubscribers.clear();
  primeFileHighlightCacheMock = mock();

  readTextFileMock = mock((input: { rootPath: string; relativePath: string }) => {
    if (input.relativePath === secondFile.relativePath) {
      if (secondFileReadMode === "resolve") {
        return Promise.resolve(textFileResult(secondFile, "const second = true;"));
      }
      return new Promise<WorkspaceTextFileReadResult>(() => {});
    }
    if (input.relativePath === editorConfigFile.relativePath) {
      return Promise.resolve(textFileResult(editorConfigFile, "root = true"));
    }
    return Promise.resolve(textFileResult(firstFile, "const first = true;"));
  });

  mock.module("@/state/operations/host", () => ({
    host: {
      filesystemReadTextFile: readTextFileMock,
    },
  }));

  mock.module("@/components/layout/theme-provider", () => ({
    ...actualThemeProvider,
    useTheme: () => ({
      theme: previewTheme,
      setTheme: () => {},
    }),
  }));

  mock.module("@pierre/diffs/react", () => ({
    useWorkerPool: () => previewWorkerPool,
    CodeView: ({ items }: { items: Array<{ file: { contents: string } }> }): ReactElement => {
      useEffect(() => {
        codeViewMountCount += 1;
        return () => {
          codeViewUnmountCount += 1;
        };
      }, []);
      return createElement(
        "pre",
        { "data-testid": "mock-code-view" },
        items[0]?.file.contents ?? "",
      );
    },
  }));

  ({ TaskExecutionSelectedFilePreview } = await import("./task-execution-file-preview"));
});

afterEach(async () => {
  document.documentElement.classList.remove("dark", "light");
  await restoreMockedModules([
    ["@pierre/diffs/react", async () => actualDiffsReact],
    ["@/components/layout/theme-provider", async () => actualThemeProvider],
    ["@/state/operations/host", async () => actualHost],
  ]);
});

describe("TaskExecutionSelectedFilePreview", () => {
  test("displays files that Pierre treats as plain text without waiting for a worker cache entry", async () => {
    const onClose = mock(() => {});

    render(renderPreview({ selectedFile: editorConfigFile, onClose }));

    await screen.findByText("root = true");
  });

  test("waits for the worker highlight result before displaying a newly opened file", async () => {
    highlightCompletionMode = "manual";
    const onClose = mock(() => {});

    render(renderPreview({ selectedFile: firstFile, onClose }));

    await waitFor(() => expect(primeFileHighlightCacheMock).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Loading file...")).toBeTruthy();
    expect(screen.queryByTestId("mock-code-view")).toBeNull();

    const [file] = primeFileHighlightCacheMock.mock.calls[0] ?? [];
    expect(file?.name).toBe(firstFile.relativePath);
    act(() => completeFileHighlight(file));

    await screen.findByText("const first = true;");
  });

  test("keeps the previous file visible while the next file is being highlighted", async () => {
    secondFileReadMode = "resolve";
    const onClose = mock(() => {});
    const view = render(
      renderPreview({ selectedFile: firstFile, preservePreviousSnapshot: true, onClose }),
    );

    await screen.findByText("const first = true;");
    highlightCompletionMode = "manual";

    view.rerender(
      renderPreview({ selectedFile: secondFile, preservePreviousSnapshot: true, onClose }),
    );

    await waitFor(() => expect(primeFileHighlightCacheMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText("const first = true;")).toBeTruthy();
    expect(screen.getByText("Loading...")).toBeTruthy();

    const [file] = primeFileHighlightCacheMock.mock.calls[1] ?? [];
    act(() => completeFileHighlight(file));

    await screen.findByText("const second = true;");
    expect(screen.queryByText("const first = true;")).toBeNull();
  });

  test("keeps the previous file visible while the next selected file is loading", async () => {
    const onClose = mock(() => {});
    const view = render(renderPreview({ selectedFile: firstFile, onClose }));

    await screen.findByText("const first = true;");

    view.rerender(
      renderPreview({ selectedFile: secondFile, preservePreviousSnapshot: true, onClose }),
    );

    await waitFor(() => expect(readTextFileMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText("src/first.ts")).toBeTruthy();
    expect(screen.getByText("const first = true;")).toBeTruthy();
    expect(screen.getByText("Loading...")).toBeTruthy();
    expect(screen.queryByText("Loading file...")).toBeNull();
  });

  test("does not reuse a closed preview snapshot when reopening another file", async () => {
    const onClose = mock(() => {});
    const view = render(renderPreview({ selectedFile: firstFile, onClose, previewSessionKey: 0 }));

    await screen.findByText("const first = true;");

    view.rerender(renderPreview({ selectedFile: secondFile, onClose, previewSessionKey: 1 }));

    await waitFor(() => expect(readTextFileMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("src/first.ts")).toBeNull();
    expect(screen.queryByText("const first = true;")).toBeNull();
    expect(screen.getByText("src/second.ts")).toBeTruthy();
    expect(screen.getByText("Loading file...")).toBeTruthy();
    expect(screen.queryByText("Loading...")).toBeNull();
  });

  test("does not reuse a previous snapshot when a fresh open keeps the same render key", async () => {
    const onClose = mock(() => {});
    const view = render(renderPreview({ selectedFile: firstFile, onClose, previewSessionKey: 0 }));

    await screen.findByText("const first = true;");

    view.rerender(renderPreview({ selectedFile: secondFile, onClose, previewSessionKey: 0 }));

    await waitFor(() => expect(readTextFileMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("src/first.ts")).toBeNull();
    expect(screen.queryByText("const first = true;")).toBeNull();
    expect(screen.getByText("src/second.ts")).toBeTruthy();
    expect(screen.getByText("Loading file...")).toBeTruthy();
    expect(screen.queryByText("Loading...")).toBeNull();
  });

  test("remounts CodeView when the preview session changes", async () => {
    const onClose = mock(() => {});
    const view = render(renderPreview({ selectedFile: firstFile, onClose, previewSessionKey: 0 }));

    await screen.findByText("const first = true;");
    expect(codeViewMountCount).toBe(1);

    view.rerender(renderPreview({ selectedFile: firstFile, onClose, previewSessionKey: 1 }));

    await screen.findByText("const first = true;");
    expect(codeViewMountCount).toBe(2);
    expect(codeViewUnmountCount).toBe(1);
  });

  test("remounts CodeView when the loaded file changes so scroll starts at the top", async () => {
    secondFileReadMode = "resolve";
    const onClose = mock(() => {});
    const view = render(renderPreview({ selectedFile: firstFile, onClose }));

    await screen.findByText("const first = true;");
    expect(codeViewMountCount).toBe(1);

    view.rerender(renderPreview({ selectedFile: secondFile, onClose }));

    await screen.findByText("const second = true;");
    expect(codeViewMountCount).toBe(2);
    expect(codeViewUnmountCount).toBe(1);
  });

  test("closes the preview when Escape is pressed", async () => {
    const onClose = mock(() => {});

    render(renderPreview({ selectedFile: firstFile, onClose }));

    await screen.findByText("const first = true;");
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
