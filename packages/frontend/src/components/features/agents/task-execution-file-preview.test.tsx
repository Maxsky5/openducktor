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
let writeTextFileMock: ReturnType<typeof mock>;
let codeViewMountCount = 0;
let codeViewUnmountCount = 0;
let latestCodeViewProps: {
  editorOptions?: unknown;
  items: Array<{
    edit?: boolean;
    file: { cacheKey?: string; contents: string; name: string };
    id: string;
    version?: number;
  }>;
  onItemEditChange?: (item: unknown, file: unknown) => void;
} | null = null;
const editProviderFactories: unknown[] = [];
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
  revision: `revision:${contents}`,
});

function PreviewTestProviders({ children }: PropsWithChildren): ReactElement {
  const [queryClient] = useState(createQueryClient);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const renderPreview = (
  model: Pick<TaskExecutionSelectedFilePreviewModel, "selectedFile" | "onClose"> &
    Partial<Omit<TaskExecutionSelectedFilePreviewModel, "selectedFile" | "onClose">>,
  theme: "light" | "dark" = "light",
) => {
  const fullModel: TaskExecutionSelectedFilePreviewModel = {
    selectedFile: model.selectedFile,
    onClose: model.onClose,
    previewSessionKey: model.previewSessionKey ?? 0,
    preservePreviousSnapshot: model.preservePreviousSnapshot ?? false,
    hasPendingDiscard: model.hasPendingDiscard ?? false,
    onEditStateChange: model.onEditStateChange ?? (() => {}),
    onKeepEditing: model.onKeepEditing ?? (() => {}),
    onDiscard: model.onDiscard ?? (() => {}),
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
  latestCodeViewProps = null;
  editProviderFactories.length = 0;
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
  writeTextFileMock = mock(
    async (input: {
      rootPath: string;
      relativePath: string;
      contents: string;
      revision: string;
    }) => ({
      kind: "text" as const,
      rootPath: input.rootPath,
      relativePath: input.relativePath,
      contents: input.contents,
      size: input.contents.length,
      mtimeMs: 1_760_000_000_001,
      revision: `${input.revision}:saved`,
    }),
  );

  mock.module("@/state/operations/host", () => ({
    host: {
      filesystemReadTextFile: readTextFileMock,
      filesystemWriteTextFile: writeTextFileMock,
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
    EditProvider: ({ children, createEditor }: PropsWithChildren<{ createEditor: unknown }>) => {
      editProviderFactories.push(createEditor);
      return children;
    },
    CodeView: (props: NonNullable<typeof latestCodeViewProps>): ReactElement => {
      latestCodeViewProps = props;
      useEffect(() => {
        codeViewMountCount += 1;
        return () => {
          codeViewUnmountCount += 1;
        };
      }, []);
      return createElement(
        "pre",
        { "data-testid": "mock-code-view" },
        props.items[0]?.file.contents ?? "",
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
    expect(latestCodeViewProps?.items[0]?.edit).toBe(false);
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

  test("does not close when an editor surface already handled Escape", async () => {
    const onClose = mock(() => {});
    render(renderPreview({ selectedFile: firstFile, onClose }));
    await screen.findByText("const first = true;");
    const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    event.preventDefault();

    window.dispatchEvent(event);

    expect(onClose).not.toHaveBeenCalled();
  });

  test("keeps unsupported files read-only and shows the host message", async () => {
    readTextFileMock.mockImplementationOnce(async () => ({
      kind: "unsupported",
      rootPath: "/repo",
      relativePath: "src/first.ts",
      reason: "binary",
      message: "Binary files cannot be previewed as text.",
      size: 3,
      mtimeMs: 1,
    }));
    const onClose = mock(() => {});

    render(renderPreview({ selectedFile: firstFile, onClose }));

    await screen.findByText("Binary files cannot be previewed as text.");
    expect(latestCodeViewProps).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  test("keeps failed reads out of the editor", async () => {
    readTextFileMock.mockImplementationOnce(async () => {
      throw new Error("Unable to read file 'src/first.ts'.");
    });
    const onClose = mock(() => {});

    render(renderPreview({ selectedFile: firstFile, onClose }));

    await screen.findByText("Unable to read file 'src/first.ts'.");
    expect(latestCodeViewProps).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  test("opens in edit mode and saves the exact draft without remounting the editor", async () => {
    const onClose = mock(() => {});
    const onEditStateChange = mock(() => {});

    render(renderPreview({ selectedFile: firstFile, onClose, onEditStateChange }));

    await screen.findByText("const first = true;");
    await waitFor(() => expect(latestCodeViewProps?.items[0]?.edit).toBe(true));
    const firstItem = latestCodeViewProps?.items[0];
    expect(firstItem?.version).toBe(0);
    expect(firstItem?.file.cacheKey).toBe(
      `${firstFile.rootPath}:${firstFile.relativePath}:revision:const first = true;`,
    );
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();

    act(() => {
      latestCodeViewProps?.onItemEditChange?.(firstItem, {
        ...firstItem?.file,
        contents: "const first = false;\n",
      });
    });
    await screen.findByText("Unsaved");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(writeTextFileMock).toHaveBeenCalledTimes(1));
    expect(writeTextFileMock).toHaveBeenCalledWith({
      rootPath: "/repo",
      relativePath: "src/first.ts",
      contents: "const first = false;\n",
      revision: "revision:const first = true;",
    });
    await screen.findByText("Saved");
    expect(latestCodeViewProps?.items[0]).toMatchObject({ edit: true, version: 1 });
    expect(latestCodeViewProps?.items[0]?.file.cacheKey).toContain(":saved");
    expect(codeViewMountCount).toBe(1);
    expect(onEditStateChange).toHaveBeenCalledWith({ isDirty: false, isSaving: false });
  });

  test("uses the saved revision for a second edit and Cmd/Ctrl+S", async () => {
    const onClose = mock(() => {});
    render(renderPreview({ selectedFile: firstFile, onClose }));
    await screen.findByText("const first = true;");
    await waitFor(() => expect(latestCodeViewProps?.items[0]?.edit).toBe(true));

    const editAndSave = async (contents: string) => {
      const expectedWriteCount = writeTextFileMock.mock.calls.length + 1;
      const item = latestCodeViewProps?.items[0];
      act(() => {
        latestCodeViewProps?.onItemEditChange?.(item, { ...item?.file, contents });
      });
      await screen.findByText("Unsaved");
      fireEvent.keyDown(window, { key: "s", code: "KeyS", ctrlKey: true });
      await waitFor(() => expect(writeTextFileMock).toHaveBeenCalledTimes(expectedWriteCount));
      await screen.findByText("Saved");
    };

    await editAndSave("first save");
    await editAndSave("second save");

    expect(writeTextFileMock).toHaveBeenCalledTimes(2);
    expect(writeTextFileMock.mock.calls[1]?.[0]).toMatchObject({
      contents: "second save",
      revision: "revision:const first = true;:saved",
    });
  });

  test("keeps a failed draft dirty and shows the save error", async () => {
    writeTextFileMock.mockImplementationOnce(async () => {
      throw new Error("Permission denied while saving this file.");
    });
    const onClose = mock(() => {});
    render(renderPreview({ selectedFile: firstFile, onClose }));
    await screen.findByText("const first = true;");
    await waitFor(() => expect(latestCodeViewProps?.items[0]?.edit).toBe(true));
    const item = latestCodeViewProps?.items[0];

    act(() => {
      latestCodeViewProps?.onItemEditChange?.(item, { ...item?.file, contents: "draft" });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("Permission denied");
    expect(screen.getByText("Unsaved")).toBeTruthy();
    expect(latestCodeViewProps?.items[0]).toMatchObject({ edit: true, version: 0 });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writeTextFileMock).toHaveBeenCalledTimes(2));
    await screen.findByText("Saved");
    expect(writeTextFileMock.mock.calls[1]?.[0]).toMatchObject({ contents: "draft" });
  });

  test("clears dirty state when the draft returns to the saved baseline", async () => {
    const onClose = mock(() => {});
    render(renderPreview({ selectedFile: firstFile, onClose }));
    await screen.findByText("const first = true;");
    await waitFor(() => expect(latestCodeViewProps?.items[0]?.edit).toBe(true));
    const item = latestCodeViewProps?.items[0];

    act(() => {
      latestCodeViewProps?.onItemEditChange?.(item, { ...item?.file, contents: "changed" });
    });
    await screen.findByText("Unsaved");
    act(() => {
      latestCodeViewProps?.onItemEditChange?.(item, {
        ...item?.file,
        contents: "const first = true;",
      });
    });

    await screen.findByText("Saved");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(true);
    expect(writeTextFileMock).not.toHaveBeenCalled();
  });

  test("suppresses duplicate Save input while one write is pending", async () => {
    let resolveWrite!: (value: Awaited<ReturnType<typeof writeTextFileMock>>) => void;
    const pendingWrite = new Promise<Awaited<ReturnType<typeof writeTextFileMock>>>((resolve) => {
      resolveWrite = resolve;
    });
    writeTextFileMock.mockImplementationOnce(() => pendingWrite);
    const onClose = mock(() => {});
    render(renderPreview({ selectedFile: firstFile, onClose }));
    await screen.findByText("const first = true;");
    await waitFor(() => expect(latestCodeViewProps?.items[0]?.edit).toBe(true));
    const item = latestCodeViewProps?.items[0];
    act(() => {
      latestCodeViewProps?.onItemEditChange?.(item, { ...item?.file, contents: "draft" });
    });
    const saveButton = await screen.findByRole("button", { name: "Save" });

    fireEvent.click(saveButton);
    fireEvent.keyDown(window, { key: "s", metaKey: true });

    await waitFor(() => expect(writeTextFileMock).toHaveBeenCalledTimes(1));
    await screen.findByText("Saving...");
    await act(async () => {
      resolveWrite({
        kind: "text",
        rootPath: "/repo",
        relativePath: "src/first.ts",
        contents: "draft",
        size: 5,
        mtimeMs: 1_760_000_000_001,
        revision: "revision-2",
      });
      await pendingWrite;
    });
    await screen.findByText("Saved");
  });

  test("keeps text entered during Save dirty against the returned revision", async () => {
    let resolveWrite!: (value: Awaited<ReturnType<typeof writeTextFileMock>>) => void;
    const pendingWrite = new Promise<Awaited<ReturnType<typeof writeTextFileMock>>>((resolve) => {
      resolveWrite = resolve;
    });
    writeTextFileMock.mockImplementationOnce(() => pendingWrite);
    const onClose = mock(() => {});
    render(renderPreview({ selectedFile: firstFile, onClose }));
    await screen.findByText("const first = true;");
    await waitFor(() => expect(latestCodeViewProps?.items[0]?.edit).toBe(true));
    const item = latestCodeViewProps?.items[0];
    act(() => {
      latestCodeViewProps?.onItemEditChange?.(item, { ...item?.file, contents: "first draft" });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(writeTextFileMock).toHaveBeenCalledTimes(1));

    act(() => {
      latestCodeViewProps?.onItemEditChange?.(item, { ...item?.file, contents: "newer draft" });
    });
    await act(async () => {
      resolveWrite({
        kind: "text",
        rootPath: "/repo",
        relativePath: "src/first.ts",
        contents: "first draft",
        size: 11,
        mtimeMs: 1_760_000_000_001,
        revision: "revision-2",
      });
      await pendingWrite;
    });

    await screen.findByText("Unsaved");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writeTextFileMock).toHaveBeenCalledTimes(2));
    await screen.findByText("Saved");
    expect(writeTextFileMock.mock.calls[1]?.[0]).toMatchObject({
      contents: "newer draft",
      revision: "revision-2",
    });
  });

  test("keeps the provider factory, editor options, and CodeView session stable across theme changes", async () => {
    const onClose = mock(() => {});
    const view = render(renderPreview({ selectedFile: firstFile, onClose }, "light"));
    await screen.findByText("const first = true;");
    await waitFor(() => expect(latestCodeViewProps?.items[0]?.edit).toBe(true));
    const factory = editProviderFactories.at(-1);
    const options = latestCodeViewProps?.editorOptions;

    view.rerender(renderPreview({ selectedFile: firstFile, onClose }, "dark"));
    await waitFor(() => expect(editProviderFactories.length).toBeGreaterThan(1));

    expect(editProviderFactories.at(-1)).toBe(factory);
    expect(latestCodeViewProps?.editorOptions).toBe(options);
    expect(latestCodeViewProps?.items[0]?.edit).toBe(true);
    expect(codeViewMountCount).toBe(1);
  });

  test("renders the discard guard and routes both decisions", async () => {
    const onClose = mock(() => {});
    const onKeepEditing = mock(() => {});
    const onDiscard = mock(() => {});
    render(
      renderPreview({
        selectedFile: firstFile,
        onClose,
        hasPendingDiscard: true,
        onKeepEditing,
        onDiscard,
      }),
    );

    await screen.findByRole("dialog");
    await screen.findByText("const first = true;");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onKeepEditing).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
});
