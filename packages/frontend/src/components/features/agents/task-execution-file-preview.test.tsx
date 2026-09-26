import { ChatFileLinkProvider } from "./agent-chat/agent-chat-file-link-provider";
import { AgentChatMarkdownRenderer } from "./agent-chat/agent-chat-markdown-renderer";
import { useTaskExecutionFilePreviewController } from "./file-preview/use-task-execution-file-preview-controller";
import { taskWorktreeQueryOptions } from "@/state/queries/build-runtime";
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type {
  WorkspaceTextFileReadResult,
  WorkspaceTextFileWriteResult,
} from "@openducktor/contracts";
import { HostInvokeError, type HostClient } from "@openducktor/host-client";
import { File, type CodeViewFileItem, type RenderFileResult } from "@pierre/diffs";
import type { Editor, EditorType } from "@pierre/diffs/edit";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createElement,
  type PropsWithChildren,
  type ReactElement,
  useEffect,
  useState,
} from "react";
import { QueryProvider } from "@/lib/query-provider";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { filesystemQueryKeys } from "@/state/queries/filesystem";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { createDeferred } from "@/test-utils/shared-test-fixtures";
import {
  type TaskExecutionSelectedFile,
  taskExecutionSelectedFileKey,
} from "./task-execution-file-explorer-model";
import type { TaskExecutionSelectedFilePreviewModel } from "./task-execution-file-preview";

enableReactActEnvironment();

type PreviewComponent =
  (typeof import("./task-execution-file-preview"))["TaskExecutionSelectedFilePreview"];

let TaskExecutionSelectedFilePreview: PreviewComponent;
let readTextFileMock: ReturnType<typeof mock>;
let writeTextFileMock: ReturnType<typeof mock>;
let codeViewMountCount = 0;
let codeViewUnmountCount = 0;
const actualPreviewPierre = await import("./task-execution-file-preview-pierre");
type PreviewWorkerPool = Pick<
  NonNullable<ReturnType<typeof actualPreviewPierre.useWorkerPool>>,
  "getFileResultCache" | "primeFileHighlightCache" | "subscribeToStatChanges"
>;
type PreviewCodeViewProps = Parameters<typeof actualPreviewPierre.CodeView>[0];
type PreviewEditorOptions = NonNullable<PreviewCodeViewProps["editorOptions"]>;
type PreviewEditor = Editor<EditorType, undefined, undefined>;
type PreviewEditorFactory = Parameters<typeof actualPreviewPierre.EditProvider>[0]["createEditor"];

let latestCodeViewProps: PreviewCodeViewProps | null = null;
const editProviderFactories: PreviewEditorFactory[] = [];

const firstCodeViewItem = (): CodeViewFileItem => {
  const item = latestCodeViewProps?.items[0];
  if (!item) {
    throw new Error("Expected the file preview to render one CodeView item.");
  }
  return item;
};

const createAttachedEditor = (
  options: PreviewEditorOptions | undefined,
  editorType: EditorType = "file",
): PreviewEditor => {
  const createEditor = editProviderFactories.at(-1);
  if (!options || !createEditor) {
    throw new Error("Expected an editor factory and options.");
  }

  return createEditor<EditorType>(editorType, options);
};

const attachEditor = (options: PreviewEditorOptions | undefined, editor: PreviewEditor): void => {
  if (!options) {
    throw new Error("Expected editor options.");
  }

  options.onAttach?.(editor, new File<undefined>());
};
let secondFileReadMode: "pending" | "resolve" = "pending";
let previewTheme: "light" | "dark" = "light";
let latestQueryClient: QueryClient | null = null;
let workerPoolMock: PreviewWorkerPool | undefined;

const runAsyncUiAction = async (action: () => void): Promise<void> => {
  await act(async () => {
    action();
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    await Promise.resolve();
  });
};

const waitForDirtyFile = async (): Promise<void> => {
  await screen.findByRole("status", { name: "Unsaved changes" });
};

const waitForCleanFile = async (): Promise<void> => {
  await waitFor(() => expect(screen.queryByRole("status", { name: "Unsaved changes" })).toBeNull());
};

const dispatchPreviewSaveShortcut = async (modifier: "ctrlKey" | "metaKey" = "ctrlKey") => {
  const event = new KeyboardEvent("keydown", {
    key: "s",
    code: "KeyS",
    [modifier]: true,
    bubbles: true,
    cancelable: true,
  });
  await runAsyncUiAction(() => screen.getByLabelText("Selected file preview").dispatchEvent(event));
  return event;
};

const actualThemeProvider = await import("@/components/layout/theme-provider");
let moduleSpies: Array<{ mockRestore: () => void }> = [];

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

const textFileWriteResult = (
  selectedFile: TaskExecutionSelectedFile,
  contents: string,
  revision: string,
): WorkspaceTextFileWriteResult => ({
  kind: "text",
  rootPath: selectedFile.rootPath,
  relativePath: selectedFile.relativePath,
  contents,
  size: contents.length,
  mtimeMs: 1_760_000_000_001,
  revision,
});

function CaptureQueryClient(): null {
  latestQueryClient = useQueryClient();
  return null;
}

function PreviewTestProviders({ children }: PropsWithChildren): ReactElement {
  return (
    <QueryProvider useIsolatedClient>
      <CaptureQueryClient />
      {children}
    </QueryProvider>
  );
}

const renderPreview = (
  model: Pick<TaskExecutionSelectedFilePreviewModel, "selectedFile" | "onClose"> &
    Partial<Omit<TaskExecutionSelectedFilePreviewModel, "selectedFile" | "onClose">>,
  theme: "light" | "dark" = "light",
  onFileSaved: () => void = () => {},
  branch: string | null = null,
) => {
  const fullModel: TaskExecutionSelectedFilePreviewModel = {
    selectedFile: model.selectedFile,
    onClose: model.onClose,
    previewSessionKey: model.previewSessionKey ?? 0,
    preservePreviousSnapshot: model.preservePreviousSnapshot ?? false,
    hasPendingDiscard: model.hasPendingDiscard ?? false,
    isApplyingTransition: model.isApplyingTransition ?? false,
    onLeavePolicyChange: model.onLeavePolicyChange ?? (() => {}),
    onKeepEditing: model.onKeepEditing ?? (() => {}),
    onDiscard: model.onDiscard ?? (() => {}),
  };
  previewTheme = theme;

  return (
    <PreviewTestProviders>
      <TaskExecutionSelectedFilePreview
        model={fullModel}
        onFileSaved={onFileSaved}
        branch={branch}
      />
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
  latestQueryClient = null;
  workerPoolMock = undefined;

  readTextFileMock = mock<HostClient["filesystemReadTextFile"]>((input) => {
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
  writeTextFileMock = mock<HostClient["filesystemWriteTextFile"]>(async (input) => ({
    kind: "text" as const,
    rootPath: input.rootPath,
    relativePath: input.relativePath,
    contents: input.contents,
    size: input.contents.length,
    mtimeMs: 1_760_000_000_001,
    revision: `${input.revision}:saved`,
  }));

  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitCanonicalizePath: async (path) => path,
        filesystemReadTextFile: readTextFileMock,
        filesystemWriteTextFile: writeTextFileMock,
      },
    }),
  );

  moduleSpies = [
    spyOn(actualThemeProvider, "useTheme").mockImplementation(() => ({
      theme: previewTheme,
      themePreference: previewTheme,
      setThemePreference: () => {},
    })),
    spyOn(actualPreviewPierre, "useWorkerPool").mockImplementation(() => {
      // SAFETY: The preview reads only the three worker-pool methods in PreviewWorkerPool.
      return workerPoolMock as ReturnType<typeof actualPreviewPierre.useWorkerPool>;
    }),
    spyOn(actualPreviewPierre, "EditProvider").mockImplementation(({ children, createEditor }) => {
      editProviderFactories.push(createEditor);
      return <>{children}</>;
    }),
    spyOn(actualPreviewPierre, "CodeView").mockImplementation((props): ReactElement => {
      latestCodeViewProps = props;
      useEffect(() => {
        codeViewMountCount += 1;
        return () => {
          codeViewUnmountCount += 1;
        };
      }, []);
      return createElement(
        "pre",
        { "aria-label": "Code editor", "data-testid": "mock-code-view", tabIndex: -1 },
        props.items[0]?.file.contents ?? "",
      );
    }),
  ];

  ({ TaskExecutionSelectedFilePreview } = await import("./task-execution-file-preview"));
});

afterEach(() => {
  document.documentElement.classList.remove("dark", "light");
  for (const moduleSpy of moduleSpies) {
    moduleSpy.mockRestore();
  }
  moduleSpies = [];
  configureShellBridge(createUnavailableShellBridge());
});

function ChatPreviewHarness(): ReactElement {
  const [taskId, setTaskId] = useState("a");
  const preview = useTaskExecutionFilePreviewController();
  const client = useQueryClient();
  useEffect(() => {
    for (const id of ["a", "b"])
      client.setQueryData(
        taskWorktreeQueryOptions({ repoPath: "/repo", taskId: id }).queryKey,
        () => ({ workingDirectory: `/repo/${id}` }),
      );
  }, [client]);
  return (
    <>
      <button type="button" onClick={() => preview.requestContextTransition(() => setTaskId("b"))}>
        Select Task B
      </button>
      <ChatFileLinkProvider
        owner={{ repoPath: "/repo", taskId, ownerKey: taskId, onSelectFile: preview.onSelectFile }}
      >
        <div data-testid="chat-transcript" hidden={preview.model.selectedFile !== null}>
          <AgentChatMarkdownRenderer markdown="[first file](src/first.ts:42) and [second file](src/second.ts)" />
        </div>
      </ChatFileLinkProvider>
      <TaskExecutionSelectedFilePreview
        key={preview.model.previewSessionKey}
        model={preview.model}
        onFileSaved={() => {}}
      />
    </>
  );
}

describe("TaskExecutionSelectedFilePreview", () => {
  test("keeps the previous highlighted file visible while the next file prepares", async () => {
    const onClose = mock(() => {});
    const view = render(renderPreview({ selectedFile: firstFile, onClose }));

    await screen.findByText("const first = true;");

    view.rerender(
      renderPreview({ selectedFile: secondFile, preservePreviousSnapshot: true, onClose }),
    );

    await waitFor(() => expect(readTextFileMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText("src/first.ts")).toBeTruthy();
    expect(screen.getByText("const first = true;")).toBeTruthy();
    expect(screen.queryByText("Loading...")).toBeNull();
    expect(screen.queryByText("Loading file...")).toBeNull();
    expect(firstCodeViewItem()?.edit).toBe(false);
  });

  test("keeps the previous file visible until the next file is highlighted", async () => {
    let notifyStatsChanged: (() => void) | undefined;
    const highlightedCacheKeys = new Set([
      JSON.stringify([taskExecutionSelectedFileKey(firstFile), "revision:const first = true;"]),
    ]);
    const cachedResult: RenderFileResult = {
      result: { code: [], themeStyles: "", baseThemeType: undefined },
      options: { theme: "one-light", useTokenTransformer: false, tokenizeMaxLineLength: 0 },
    };
    workerPoolMock = {
      getFileResultCache: mock((file) =>
        file.cacheKey && highlightedCacheKeys.has(file.cacheKey) ? cachedResult : undefined,
      ),
      primeFileHighlightCache: mock(async () => undefined),
      subscribeToStatChanges: mock((callback) => {
        notifyStatsChanged = callback;
        return () => undefined;
      }),
    };
    secondFileReadMode = "resolve";
    const onClose = mock(() => {});
    const view = render(renderPreview({ selectedFile: firstFile, onClose }));

    await screen.findByText("const first = true;");
    view.rerender(
      renderPreview({ selectedFile: secondFile, preservePreviousSnapshot: true, onClose }),
    );

    await waitFor(() => expect(readTextFileMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText("src/first.ts")).toBeTruthy();
    expect(screen.getByText("const first = true;")).toBeTruthy();
    expect(screen.getByLabelText("Selected file preview").getAttribute("aria-busy")).toBe("true");

    const secondCacheKey = JSON.stringify([
      taskExecutionSelectedFileKey(secondFile),
      "revision:const second = true;",
    ]);
    highlightedCacheKeys.add(secondCacheKey);
    act(() => notifyStatsChanged?.());

    await screen.findByText("const second = true;");
    expect(screen.getByText("src/second.ts")).toBeTruthy();
    expect(screen.getByLabelText("Selected file preview").getAttribute("aria-busy")).toBe("false");
  });

  test("clears the busy state when the next file fails to load", async () => {
    const onClose = mock(() => {});
    const view = render(renderPreview({ selectedFile: firstFile, onClose }));

    await screen.findByText("const first = true;");
    readTextFileMock.mockImplementationOnce(async () => {
      throw new Error("Second file failed.");
    });
    view.rerender(
      renderPreview({ selectedFile: secondFile, preservePreviousSnapshot: true, onClose }),
    );

    await screen.findByText("Second file failed.");
    expect(screen.getByLabelText("Selected file preview").getAttribute("aria-busy")).toBe("false");
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
    fireEvent.keyDown(screen.getByLabelText("Selected file preview"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("does not close when an editor surface already handled Escape", async () => {
    const onClose = mock(() => {});
    render(renderPreview({ selectedFile: firstFile, onClose }));
    await screen.findByText("const first = true;");
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();

    screen.getByLabelText("Selected file preview").dispatchEvent(event);

    expect(onClose).not.toHaveBeenCalled();
  });

  test("does not capture Save or Escape outside the preview", async () => {
    const onClose = mock(() => {});
    render(renderPreview({ selectedFile: firstFile, onClose }));
    await screen.findByText("const first = true;");
    const outsideInput = document.createElement("input");
    document.body.append(outsideInput);
    outsideInput.focus();

    fireEvent.keyDown(outsideInput, { key: "Escape" });
    fireEvent.keyDown(outsideInput, { key: "s", ctrlKey: true });

    expect(onClose).not.toHaveBeenCalled();
    expect(writeTextFileMock).not.toHaveBeenCalled();
    outsideInput.remove();
  });

  test("captures Cmd/Ctrl+S for a clean preview without writing", async () => {
    const onClose = mock(() => {});
    render(renderPreview({ selectedFile: firstFile, onClose }));
    await screen.findByText("const first = true;");

    const event = await dispatchPreviewSaveShortcut();

    expect(event.defaultPrevented).toBe(true);
    expect(writeTextFileMock).not.toHaveBeenCalled();
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
    expect(screen.queryByRole("button", { name: "Save file" })).toBeNull();
  });

  test("keeps failed reads out of the editor", async () => {
    readTextFileMock.mockImplementationOnce(async () => {
      throw new Error("Unable to read file 'src/first.ts'.");
    });
    const onClose = mock(() => {});

    render(renderPreview({ selectedFile: firstFile, onClose }));

    await screen.findByText("Unable to read file 'src/first.ts'.");
    expect(latestCodeViewProps).toBeNull();
    expect(screen.queryByRole("button", { name: "Save file" })).toBeNull();
  });

  test("discards a previous draft before an unsupported-file switch", async () => {
    const onClose = mock(() => {});
    const view = render(renderPreview({ selectedFile: firstFile, onClose }));
    await screen.findByText("const first = true;");
    const firstItem = firstCodeViewItem();
    act(() => {
      latestCodeViewProps?.onItemEditChange?.(firstItem, {
        ...firstItem?.file,
        contents: "unsaved first draft",
      });
    });
    await waitForDirtyFile();
    readTextFileMock.mockImplementationOnce(async () => ({
      kind: "unsupported",
      rootPath: secondFile.rootPath,
      relativePath: secondFile.relativePath,
      reason: "binary",
      message: "Binary files cannot be previewed as text.",
      size: 3,
      mtimeMs: 1,
    }));

    view.rerender(renderPreview({ selectedFile: secondFile, onClose }));

    await screen.findByText("Binary files cannot be previewed as text.");
    const saveEvent = await dispatchPreviewSaveShortcut();
    expect(saveEvent.defaultPrevented).toBe(true);
    expect(writeTextFileMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Save file" })).toBeNull();

    view.rerender(renderPreview({ selectedFile: firstFile, onClose }));

    await screen.findByText("const first = true;");
    await waitForCleanFile();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save file" }).disabled).toBe(
      true,
    );
    await dispatchPreviewSaveShortcut();
    expect(writeTextFileMock).not.toHaveBeenCalled();
  });

  test("keeps editor sessions distinct when file paths contain separators", async () => {
    const firstCollisionFile = { rootPath: "/tmp/team:one", relativePath: "src/a.ts" };
    const secondCollisionFile = { rootPath: "/tmp/team", relativePath: "one:src/a.ts" };
    readTextFileMock.mockImplementation(
      async (input: { rootPath: string; relativePath: string }) => {
        const selectedFile =
          input.rootPath === firstCollisionFile.rootPath ? firstCollisionFile : secondCollisionFile;
        const contents = selectedFile === firstCollisionFile ? "first contents" : "second contents";
        return textFileResult(selectedFile, contents);
      },
    );
    const onClose = mock(() => {});
    const view = render(renderPreview({ selectedFile: firstCollisionFile, onClose }));
    await screen.findByText("first contents");
    const firstItem = firstCodeViewItem();
    act(() => {
      latestCodeViewProps?.onItemEditChange?.(firstItem, {
        ...firstItem?.file,
        contents: "first draft",
      });
    });
    await waitForDirtyFile();

    view.rerender(renderPreview({ selectedFile: secondCollisionFile, onClose }));

    await screen.findByText("second contents");
    expect(firstCodeViewItem()?.id).not.toBe(firstItem?.id);
  });

  test("drops a discarded draft before the same file is reopened", async () => {
    const onClose = mock(() => {});
    const view = render(renderPreview({ selectedFile: firstFile, onClose }));
    await screen.findByText("const first = true;");
    const item = firstCodeViewItem();
    act(() => {
      latestCodeViewProps?.onItemEditChange?.(item, { ...item?.file, contents: "discard me" });
    });
    await waitForDirtyFile();

    view.rerender(renderPreview({ selectedFile: null, onClose }));
    view.rerender(renderPreview({ selectedFile: firstFile, onClose }));

    await screen.findByText("const first = true;");
    await waitForCleanFile();
    expect(screen.queryByText("discard me")).toBeNull();
  });

  test("keeps the live editor mounted when a background file refresh fails", async () => {
    const onClose = mock(() => {});
    render(renderPreview({ selectedFile: firstFile, onClose }));
    await screen.findByText("const first = true;");
    const item = firstCodeViewItem();
    act(() => {
      latestCodeViewProps?.onItemEditChange?.(item, { ...item?.file, contents: "local draft" });
    });
    await waitForDirtyFile();
    readTextFileMock.mockImplementationOnce(async () => {
      throw new Error("Refresh failed.");
    });

    await act(async () => {
      await latestQueryClient?.invalidateQueries();
    });

    await waitFor(() => expect(readTextFileMock).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("mock-code-view")).toBeTruthy();
    expect(codeViewMountCount).toBe(1);
    expect(codeViewUnmountCount).toBe(0);
    expect(screen.getByRole("status", { name: "Unsaved changes" })).toBeTruthy();
  });

  test("shows a clean file's refreshed unsupported state", async () => {
    const onClose = mock(() => {});
    render(renderPreview({ selectedFile: firstFile, onClose }));
    await screen.findByText("const first = true;");
    readTextFileMock.mockImplementationOnce(async () => ({
      kind: "unsupported",
      rootPath: firstFile.rootPath,
      relativePath: firstFile.relativePath,
      reason: "binary",
      message: "Binary files cannot be previewed as text.",
      size: 3,
      mtimeMs: 2,
    }));

    await act(async () => {
      await latestQueryClient?.invalidateQueries();
    });

    await screen.findByText("Binary files cannot be previewed as text.");
    expect(screen.queryByTestId("mock-code-view")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save file" })).toBeNull();
  });

  test("shows a clean file's background refresh error", async () => {
    const onClose = mock(() => {});
    render(renderPreview({ selectedFile: firstFile, onClose }));
    await screen.findByText("const first = true;");
    readTextFileMock.mockImplementationOnce(async () => {
      throw new Error("Refresh failed.");
    });

    await act(async () => {
      await latestQueryClient?.invalidateQueries();
    });

    await screen.findByText("Refresh failed.");
    expect(screen.queryByTestId("mock-code-view")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save file" })).toBeNull();
  });

  test("opens in edit mode and saves without replacing Pierre's editor document", async () => {
    const onClose = mock(() => {});
    const onLeavePolicyChange = mock(() => {});
    const onFileSaved = mock(() => {});

    render(
      renderPreview(
        { selectedFile: firstFile, onClose, onLeavePolicyChange },
        "light",
        onFileSaved,
      ),
    );

    await screen.findByText("const first = true;");
    await waitFor(() => expect(firstCodeViewItem()?.edit).toBe(true));
    const firstItem = firstCodeViewItem();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save file" }).disabled).toBe(
      true,
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(firstItem?.version).toBe(1);
    expect(firstItem?.file.cacheKey).toBe(
      JSON.stringify([taskExecutionSelectedFileKey(firstFile), "revision:const first = true;"]),
    );
    const providerFactory = editProviderFactories.at(-1);
    const editorOptions = latestCodeViewProps?.editorOptions;
    const attachedEditor = createAttachedEditor(editorOptions);
    const focus = spyOn(attachedEditor, "focus").mockImplementation(() => {});
    attachEditor(editorOptions, attachedEditor);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    act(() => {
      latestCodeViewProps?.onItemEditChange?.(firstItem, {
        ...firstItem?.file,
        contents: "const first = false;\n",
      });
    });
    await waitForDirtyFile();
    expect(screen.getByRole("status", { name: "Unsaved changes" })).toBeTruthy();
    const saveButton = screen.getByRole("button", { name: "Save file" });
    expect(fireEvent.mouseDown(saveButton)).toBe(false);
    await runAsyncUiAction(() => fireEvent.click(saveButton));

    await waitFor(() => expect(writeTextFileMock).toHaveBeenCalledTimes(1));
    expect(writeTextFileMock).toHaveBeenCalledWith({
      rootPath: "/repo",
      relativePath: "src/first.ts",
      contents: "const first = false;\n",
      revision: "revision:const first = true;",
    });
    await waitForCleanFile();
    expect(screen.queryByRole("status")).toBeNull();
    expect(firstCodeViewItem()).toMatchObject({
      edit: true,
      version: firstItem?.version,
      file: {
        cacheKey: firstItem?.file.cacheKey,
        contents: "const first = false;\n",
      },
    });
    expect(editProviderFactories.at(-1)).toBe(providerFactory);
    expect(latestCodeViewProps?.editorOptions).toBe(editorOptions);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(codeViewMountCount).toBe(1);
    expect(onLeavePolicyChange).toHaveBeenCalledWith("confirm");
    expect(onLeavePolicyChange).toHaveBeenCalledWith("defer");
    expect(onLeavePolicyChange).toHaveBeenLastCalledWith("allow");
    expect(onFileSaved).toHaveBeenCalledTimes(1);
  });

  test("restores saved contents after a clean editor remount", async () => {
    const onClose = mock(() => {});
    render(renderPreview({ selectedFile: firstFile, onClose }));
    await screen.findByText("const first = true;");
    const firstItem = firstCodeViewItem();
    const firstCacheKey = firstItem?.file.cacheKey;
    const attachedEditor = createAttachedEditor(latestCodeViewProps?.editorOptions);
    spyOn(attachedEditor, "focus").mockImplementation(() => {});
    attachEditor(latestCodeViewProps?.editorOptions, attachedEditor);

    act(() => {
      latestCodeViewProps?.onItemEditChange?.(firstItem, {
        ...firstItem?.file,
        contents: "const first = false;",
      });
    });
    await runAsyncUiAction(() =>
      fireEvent.click(screen.getByRole("button", { name: "Save file" })),
    );
    await waitForCleanFile();

    readTextFileMock.mockImplementationOnce(async () => {
      throw new Error("Refresh failed.");
    });
    await act(async () => {
      await latestQueryClient?.invalidateQueries();
    });
    await screen.findByText("Refresh failed.");
    expect(screen.queryByTestId("mock-code-view")).toBeNull();

    readTextFileMock.mockImplementationOnce(async () =>
      textFileWriteResult(firstFile, "const first = false;", "revision:const first = true;:saved"),
    );
    await act(async () => {
      await latestQueryClient?.invalidateQueries();
    });

    await screen.findByText("const first = false;");
    expect(firstCodeViewItem()).toMatchObject({
      version: firstItem?.version,
      file: {
        contents: "const first = false;",
      },
    });
    expect(firstCodeViewItem()?.file.cacheKey).not.toBe(firstCacheKey);
    expect(firstCodeViewItem()?.file.cacheKey).toBe(
      JSON.stringify([
        taskExecutionSelectedFileKey(firstFile),
        "revision:const first = true;:saved",
      ]),
    );
    expect(codeViewMountCount).toBe(2);
  });

  test("uses the saved revision for a second edit and Cmd/Ctrl+S", async () => {
    const onClose = mock(() => {});
    render(renderPreview({ selectedFile: firstFile, onClose }));
    await screen.findByText("const first = true;");
    await waitFor(() => expect(firstCodeViewItem()?.edit).toBe(true));

    const editAndSave = async (contents: string) => {
      const expectedWriteCount = writeTextFileMock.mock.calls.length + 1;
      const item = firstCodeViewItem();
      act(() => {
        latestCodeViewProps?.onItemEditChange?.(item, { ...item?.file, contents });
      });
      await waitForDirtyFile();
      const event = await dispatchPreviewSaveShortcut();
      expect(event.defaultPrevented).toBe(true);
      await waitFor(() => expect(writeTextFileMock).toHaveBeenCalledTimes(expectedWriteCount));
      await waitForCleanFile();
    };

    await editAndSave("first save");
    await editAndSave("second save");

    expect(writeTextFileMock).toHaveBeenCalledTimes(2);
    expect(writeTextFileMock.mock.calls[1]?.[0]).toMatchObject({
      contents: "second save",
      revision: "revision:const first = true;:saved",
    });
  });

  test("ignores a completed save after the active editor session changes", async () => {
    secondFileReadMode = "resolve";
    const pendingWrite = createDeferred<WorkspaceTextFileWriteResult>();
    writeTextFileMock.mockImplementationOnce(() => pendingWrite.promise);
    const onClose = mock(() => {});
    const onLeavePolicyChange = mock(() => {});
    const view = render(renderPreview({ selectedFile: firstFile, onClose, onLeavePolicyChange }));
    await screen.findByText("const first = true;");
    const item = firstCodeViewItem();
    act(() => {
      latestCodeViewProps?.onItemEditChange?.(item, { ...item?.file, contents: "first draft" });
    });
    await runAsyncUiAction(() =>
      fireEvent.click(screen.getByRole("button", { name: "Save file" })),
    );
    await waitFor(() => expect(writeTextFileMock).toHaveBeenCalledTimes(1));

    view.rerender(renderPreview({ selectedFile: secondFile, onClose, onLeavePolicyChange }));
    await screen.findByText("const second = true;");
    const leavePolicyCallCount = onLeavePolicyChange.mock.calls.length;
    await act(async () => {
      pendingWrite.resolve(textFileWriteResult(firstFile, "first draft", "saved-first"));
      await pendingWrite.promise;
    });

    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save file" }).disabled).toBe(
        true,
      ),
    );
    expect(onLeavePolicyChange).toHaveBeenCalledTimes(leavePolicyCallCount);
    expect(screen.getByText("const second = true;")).toBeTruthy();
  });

  test("keeps a failed draft dirty and shows the save error", async () => {
    writeTextFileMock.mockImplementationOnce(async () => {
      throw new Error("Permission denied while saving this file.");
    });
    const onClose = mock(() => {});
    render(renderPreview({ selectedFile: firstFile, onClose }));
    await screen.findByText("const first = true;");
    await waitFor(() => expect(firstCodeViewItem()?.edit).toBe(true));
    const item = firstCodeViewItem();

    act(() => {
      latestCodeViewProps?.onItemEditChange?.(item, { ...item?.file, contents: "draft" });
    });
    const firstSaveButton = await screen.findByRole("button", { name: "Save file" });
    await runAsyncUiAction(() => fireEvent.click(firstSaveButton));

    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("Permission denied");
    expect(screen.getByRole("status", { name: "Unsaved changes" })).toBeTruthy();
    expect(firstCodeViewItem()).toMatchObject({ edit: true, version: 1 });

    await runAsyncUiAction(() =>
      fireEvent.click(screen.getByRole("button", { name: "Save file" })),
    );
    await waitFor(() => expect(writeTextFileMock).toHaveBeenCalledTimes(2));
    await waitForCleanFile();
    expect(writeTextFileMock.mock.calls[1]?.[0]).toMatchObject({ contents: "draft" });
  });

  test("keeps a draft but blocks saving it on another branch with the same file revision", async () => {
    const onClose = mock(() => {});
    const model = { selectedFile: firstFile, onClose };
    const view = render(renderPreview(model, "light", undefined, "main"));
    await screen.findByText("const first = true;");
    const item = firstCodeViewItem();
    act(() => {
      latestCodeViewProps?.onItemEditChange?.(item, { ...item.file, contents: "draft" });
    });
    await waitForDirtyFile();

    view.rerender(renderPreview(model, "light", undefined, "feature"));

    expect(screen.getByRole("status", { name: "Unsaved changes" })).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save file" }).disabled).toBe(
      true,
    );
    expect(screen.getByRole("alert").textContent).toContain("current branch");
    expect((await dispatchPreviewSaveShortcut("metaKey")).defaultPrevented).toBe(true);
    expect(writeTextFileMock).toHaveBeenCalledTimes(0);

    await runAsyncUiAction(() =>
      fireEvent.click(screen.getByRole("button", { name: "Review latest version" })),
    );
    await screen.findByRole("dialog", { name: "Review latest file" });
    expect(screen.getByLabelText("Latest file contents").textContent).toBe("const first = true;");
    await runAsyncUiAction(() =>
      fireEvent.click(screen.getByRole("button", { name: "Use latest as baseline" })),
    );
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save file" }).disabled).toBe(
        false,
      ),
    );
    await runAsyncUiAction(() =>
      fireEvent.click(screen.getByRole("button", { name: "Save file" })),
    );

    await waitFor(() => expect(writeTextFileMock).toHaveBeenCalledTimes(1));
    expect(writeTextFileMock.mock.calls[0]?.[0]).toMatchObject({
      contents: "draft",
      revision: "revision:const first = true;",
    });
  });

  test("lets a clean preview start a draft after a branch change", async () => {
    const onClose = mock(() => {});
    const model = { selectedFile: firstFile, onClose };
    const view = render(renderPreview(model, "light", undefined, "main"));
    await screen.findByText("const first = true;");

    view.rerender(renderPreview(model, "light", undefined, "feature"));
    const item = firstCodeViewItem();
    act(() => {
      latestCodeViewProps?.onItemEditChange?.(item, { ...item.file, contents: "new draft" });
    });

    await waitForDirtyFile();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save file" }).disabled).toBe(
      false,
    );
  });

  test("drops a review result if the branch changes while the file loads", async () => {
    const pendingReview = createDeferred<WorkspaceTextFileReadResult>();
    const onClose = mock(() => {});
    const model = { selectedFile: firstFile, onClose };
    const view = render(renderPreview(model, "light", undefined, "main"));
    await screen.findByText("const first = true;");
    const item = firstCodeViewItem();
    act(() => {
      latestCodeViewProps?.onItemEditChange?.(item, { ...item.file, contents: "draft" });
    });
    await waitForDirtyFile();
    view.rerender(renderPreview(model, "light", undefined, "feature"));
    readTextFileMock.mockImplementationOnce(() => pendingReview.promise);
    await runAsyncUiAction(() =>
      fireEvent.click(screen.getByRole("button", { name: "Review latest version" })),
    );

    view.rerender(renderPreview(model, "light", undefined, "other"));
    await act(async () => {
      pendingReview.resolve(textFileResult(firstFile, "const first = true;"));
      await pendingReview.promise;
    });

    expect(screen.queryByRole("dialog", { name: "Review latest file" })).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save file" }).disabled).toBe(
      true,
    );
    expect(writeTextFileMock).toHaveBeenCalledTimes(0);
  });

  test("closes a loaded review when the branch changes again", async () => {
    const onClose = mock(() => {});
    const model = { selectedFile: firstFile, onClose };
    const view = render(renderPreview(model, "light", undefined, "main"));
    await screen.findByText("const first = true;");
    const item = firstCodeViewItem();
    act(() => {
      latestCodeViewProps?.onItemEditChange?.(item, { ...item.file, contents: "draft" });
    });
    await waitForDirtyFile();
    view.rerender(renderPreview(model, "light", undefined, "feature"));
    await runAsyncUiAction(() =>
      fireEvent.click(screen.getByRole("button", { name: "Review latest version" })),
    );
    await screen.findByRole("dialog", { name: "Review latest file" });

    view.rerender(renderPreview(model, "light", undefined, "other"));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Review latest file" })).toBeNull(),
    );
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save file" }).disabled).toBe(
      true,
    );
    expect(writeTextFileMock).toHaveBeenCalledTimes(0);
  });

  test("shows a failed branch review and keeps the draft blocked", async () => {
    const onClose = mock(() => {});
    const model = { selectedFile: firstFile, onClose };
    const view = render(renderPreview(model, "light", undefined, "main"));
    await screen.findByText("const first = true;");
    const item = firstCodeViewItem();
    act(() => {
      latestCodeViewProps?.onItemEditChange?.(item, { ...item.file, contents: "draft" });
    });
    await waitForDirtyFile();
    view.rerender(renderPreview(model, "light", undefined, "feature"));
    readTextFileMock.mockImplementationOnce(async () => {
      throw new Error("Read denied.");
    });

    await runAsyncUiAction(() =>
      fireEvent.click(screen.getByRole("button", { name: "Review latest version" })),
    );

    await screen.findByText("Read denied.");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save file" }).disabled).toBe(
      true,
    );
    expect(screen.getByRole("status", { name: "Unsaved changes" })).toBeTruthy();
    expect(writeTextFileMock).toHaveBeenCalledTimes(0);
  });

  test("reviews the latest file and rebases a stale draft without losing it", async () => {
    readTextFileMock.mockImplementationOnce(async () =>
      textFileResult(firstFile, "const first = true;"),
    );
    readTextFileMock.mockImplementationOnce(async () =>
      textFileResult(firstFile, "const external = true;"),
    );
    writeTextFileMock.mockImplementationOnce(async () => {
      throw new HostInvokeError("The file changed after it was loaded.", {
        kind: "workspace_text_file_write",
        workspaceTextFileWriteFailure: {
          code: "stale_revision",
          message: "The file changed after it was loaded.",
          rootPath: firstFile.rootPath,
          relativePath: firstFile.relativePath,
        },
      });
    });
    const onClose = mock(() => {});
    render(renderPreview({ selectedFile: firstFile, onClose }));
    await screen.findByText("const first = true;");
    const item = firstCodeViewItem();
    act(() => {
      latestCodeViewProps?.onItemEditChange?.(item, { ...item?.file, contents: "local draft" });
    });

    await runAsyncUiAction(() =>
      fireEvent.click(screen.getByRole("button", { name: "Save file" })),
    );
    await screen.findByText("The file changed after it was loaded.");
    const blockedSaveEvent = await dispatchPreviewSaveShortcut("metaKey");
    expect(blockedSaveEvent.defaultPrevented).toBe(true);
    expect(writeTextFileMock).toHaveBeenCalledTimes(1);
    await runAsyncUiAction(() =>
      fireEvent.click(screen.getByRole("button", { name: "Review latest version" })),
    );

    await screen.findByRole("dialog", { name: "Review latest file" });
    expect(screen.getByLabelText("Latest file contents").textContent).toBe(
      "const external = true;",
    );
    await runAsyncUiAction(() =>
      fireEvent.click(screen.getByRole("button", { name: "Use latest as baseline" })),
    );
    await waitForDirtyFile();
    await runAsyncUiAction(() =>
      fireEvent.click(screen.getByRole("button", { name: "Save file" })),
    );
    await waitFor(() => expect(writeTextFileMock).toHaveBeenCalledTimes(2));

    expect(writeTextFileMock.mock.calls[1]?.[0]).toMatchObject({
      contents: "local draft",
      revision: "revision:const external = true;",
    });
  });

  test("restores accepted conflict contents after a clean editor remount", async () => {
    readTextFileMock.mockImplementationOnce(async () =>
      textFileResult(firstFile, "const first = true;"),
    );
    readTextFileMock.mockImplementationOnce(async () =>
      textFileResult(firstFile, "const external = true;"),
    );
    writeTextFileMock.mockImplementationOnce(async () => {
      throw new HostInvokeError("The file changed after it was loaded.", {
        kind: "workspace_text_file_write",
        workspaceTextFileWriteFailure: {
          code: "stale_revision",
          message: "The file changed after it was loaded.",
          rootPath: firstFile.rootPath,
          relativePath: firstFile.relativePath,
        },
      });
    });
    const onClose = mock(() => {});
    render(renderPreview({ selectedFile: firstFile, onClose }));
    await screen.findByText("const first = true;");
    const firstItem = firstCodeViewItem();
    act(() => {
      latestCodeViewProps?.onItemEditChange?.(firstItem, {
        ...firstItem?.file,
        contents: "const external = true;",
      });
    });

    await runAsyncUiAction(() =>
      fireEvent.click(screen.getByRole("button", { name: "Save file" })),
    );
    await screen.findByText("The file changed after it was loaded.");
    await runAsyncUiAction(() =>
      fireEvent.click(screen.getByRole("button", { name: "Review latest version" })),
    );
    await screen.findByRole("dialog", { name: "Review latest file" });
    await runAsyncUiAction(() =>
      fireEvent.click(screen.getByRole("button", { name: "Use latest as baseline" })),
    );
    await waitForCleanFile();

    readTextFileMock.mockImplementationOnce(async () => {
      throw new Error("Refresh failed.");
    });
    await act(async () => {
      await latestQueryClient?.invalidateQueries();
    });
    await screen.findByText("Refresh failed.");
    expect(screen.queryByTestId("mock-code-view")).toBeNull();

    readTextFileMock.mockImplementationOnce(async () =>
      textFileResult(firstFile, "const external = true;"),
    );
    await act(async () => {
      await latestQueryClient?.invalidateQueries();
    });

    await screen.findByText("const external = true;");
    expect(firstCodeViewItem()).toMatchObject({
      version: firstItem?.version,
      file: {
        contents: "const external = true;",
      },
    });
    expect(firstCodeViewItem()?.file.cacheKey).not.toBe(firstItem?.file.cacheKey);
    expect(firstCodeViewItem()?.file.cacheKey).toBe(
      JSON.stringify([taskExecutionSelectedFileKey(firstFile), "revision:const external = true;"]),
    );
    expect(codeViewMountCount).toBe(2);
  });

  test("ignores a conflict review that resolves after another file is selected", async () => {
    const pendingReview = createDeferred<WorkspaceTextFileReadResult>();
    writeTextFileMock.mockImplementationOnce(async () => {
      throw new HostInvokeError("The file changed after it was loaded.", {
        kind: "workspace_text_file_write",
        workspaceTextFileWriteFailure: {
          code: "stale_revision",
          message: "The file changed after it was loaded.",
          rootPath: firstFile.rootPath,
          relativePath: firstFile.relativePath,
        },
      });
    });
    const onClose = mock(() => {});
    const view = render(renderPreview({ selectedFile: firstFile, onClose }));
    await screen.findByText("const first = true;");
    const item = firstCodeViewItem();
    act(() => {
      latestCodeViewProps?.onItemEditChange?.(item, { ...item?.file, contents: "local draft" });
    });
    await runAsyncUiAction(() =>
      fireEvent.click(screen.getByRole("button", { name: "Save file" })),
    );
    await screen.findByText("The file changed after it was loaded.");
    readTextFileMock.mockImplementationOnce(() => pendingReview.promise);
    await runAsyncUiAction(() =>
      fireEvent.click(screen.getByRole("button", { name: "Review latest version" })),
    );

    secondFileReadMode = "resolve";
    view.rerender(renderPreview({ selectedFile: secondFile, onClose }));
    await screen.findByText("const second = true;");
    await act(async () => {
      pendingReview.resolve(textFileResult(firstFile, "const external = true;"));
      await pendingReview.promise;
    });

    expect(screen.queryByRole("dialog", { name: "Review latest file" })).toBeNull();
    expect(firstCodeViewItem()?.id).toBe(taskExecutionSelectedFileKey(secondFile));
  });

  test("clears dirty state when the draft returns to the saved baseline", async () => {
    const onClose = mock(() => {});
    render(renderPreview({ selectedFile: firstFile, onClose }));
    await screen.findByText("const first = true;");
    await waitFor(() => expect(firstCodeViewItem()?.edit).toBe(true));
    const item = firstCodeViewItem();

    act(() => {
      latestCodeViewProps?.onItemEditChange?.(item, { ...item?.file, contents: "changed" });
    });
    await waitForDirtyFile();
    act(() => {
      latestCodeViewProps?.onItemEditChange?.(item, {
        ...item?.file,
        contents: "const first = true;",
      });
    });

    await waitForCleanFile();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save file" }).disabled).toBe(
      true,
    );
    expect(writeTextFileMock).not.toHaveBeenCalled();
  });

  test("suppresses duplicate Save input while one write is pending", async () => {
    const pendingWrite = createDeferred<WorkspaceTextFileWriteResult>();
    writeTextFileMock.mockImplementationOnce(() => pendingWrite.promise);
    const onClose = mock(() => {});
    render(renderPreview({ selectedFile: firstFile, onClose }));
    await screen.findByText("const first = true;");
    await waitFor(() => expect(firstCodeViewItem()?.edit).toBe(true));
    const item = firstCodeViewItem();
    act(() => {
      latestCodeViewProps?.onItemEditChange?.(item, { ...item?.file, contents: "draft" });
    });
    const saveButton = await screen.findByRole<HTMLButtonElement>("button", { name: "Save file" });

    fireEvent.click(saveButton);
    const pendingSaveEvent = await dispatchPreviewSaveShortcut("metaKey");

    await waitFor(() => expect(writeTextFileMock).toHaveBeenCalledTimes(1));
    expect(pendingSaveEvent.defaultPrevented).toBe(true);
    const pendingSaveButton = await screen.findByRole<HTMLButtonElement>("button", {
      name: "Saving file",
    });
    expect(screen.getByRole("status", { name: "Unsaved changes" })).toBeTruthy();
    expect(pendingSaveButton.getAttribute("aria-busy")).toBe("true");
    expect(pendingSaveButton.disabled).toBe(true);
    await act(async () => {
      pendingWrite.resolve(textFileWriteResult(firstFile, "draft", "revision-2"));
      await pendingWrite.promise;
    });
    await waitForCleanFile();
  });

  test("keeps pending Save feedback when the draft returns to the old baseline", async () => {
    const pendingWrite = createDeferred<WorkspaceTextFileWriteResult>();
    writeTextFileMock.mockImplementationOnce(() => pendingWrite.promise);
    const onClose = mock(() => {});
    render(renderPreview({ selectedFile: firstFile, onClose }));
    await screen.findByText("const first = true;");
    await waitFor(() => expect(firstCodeViewItem()?.edit).toBe(true));
    const item = firstCodeViewItem();
    act(() => {
      latestCodeViewProps?.onItemEditChange?.(item, { ...item?.file, contents: "draft" });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Save file" }));
    await waitFor(() => expect(writeTextFileMock).toHaveBeenCalledTimes(1));

    act(() => {
      latestCodeViewProps?.onItemEditChange?.(item, {
        ...item?.file,
        contents: "const first = true;",
      });
    });

    const pendingSaveButton = await screen.findByRole<HTMLButtonElement>("button", {
      name: "Saving file",
    });
    expect(screen.getByRole("status", { name: "Unsaved changes" })).toBeTruthy();
    expect(pendingSaveButton.getAttribute("aria-busy")).toBe("true");
    expect(pendingSaveButton.disabled).toBe(true);
    const duplicateSaveEvent = await dispatchPreviewSaveShortcut();
    expect(duplicateSaveEvent.defaultPrevented).toBe(true);
    expect(writeTextFileMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      latestQueryClient?.setQueryData(
        filesystemQueryKeys.textFile(firstFile.rootPath, firstFile.relativePath),
        textFileResult(firstFile, "draft"),
      );
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    });
    await waitFor(() =>
      expect(firstCodeViewItem()).toMatchObject({
        file: { contents: "const first = true;" },
        version: item?.version,
      }),
    );

    await act(async () => {
      pendingWrite.resolve(textFileWriteResult(firstFile, "draft", "revision-2"));
      await pendingWrite.promise;
    });

    await waitForDirtyFile();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save file" }).disabled).toBe(
      false,
    );
  });

  test("clears pending Save feedback after a failed write at the old baseline", async () => {
    const pendingWrite = createDeferred<WorkspaceTextFileWriteResult>();
    writeTextFileMock.mockImplementationOnce(() => pendingWrite.promise);
    const onClose = mock(() => {});
    render(renderPreview({ selectedFile: firstFile, onClose }));
    await screen.findByText("const first = true;");
    await waitFor(() => expect(firstCodeViewItem()?.edit).toBe(true));
    const item = firstCodeViewItem();
    act(() => {
      latestCodeViewProps?.onItemEditChange?.(item, { ...item?.file, contents: "draft" });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Save file" }));
    await screen.findByRole("button", { name: "Saving file" });

    act(() => {
      latestCodeViewProps?.onItemEditChange?.(item, {
        ...item?.file,
        contents: "const first = true;",
      });
    });
    expect(screen.getByRole("status", { name: "Unsaved changes" })).toBeTruthy();

    await act(async () => {
      pendingWrite.reject(new Error("Permission denied while saving this file."));
      await pendingWrite.promise.catch(() => undefined);
    });

    expect((await screen.findByRole("alert")).textContent).toContain("Permission denied");
    expect(screen.queryByRole("status", { name: "Unsaved changes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Saving file" })).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save file" }).disabled).toBe(
      true,
    );
  });

  test("keeps text entered during Save dirty against the returned revision", async () => {
    const pendingWrite = createDeferred<WorkspaceTextFileWriteResult>();
    writeTextFileMock.mockImplementationOnce(() => pendingWrite.promise);
    const onClose = mock(() => {});
    render(renderPreview({ selectedFile: firstFile, onClose }));
    await screen.findByText("const first = true;");
    await waitFor(() => expect(firstCodeViewItem()?.edit).toBe(true));
    const item = firstCodeViewItem();
    act(() => {
      latestCodeViewProps?.onItemEditChange?.(item, { ...item?.file, contents: "first draft" });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Save file" }));
    await waitFor(() => expect(writeTextFileMock).toHaveBeenCalledTimes(1));

    act(() => {
      latestCodeViewProps?.onItemEditChange?.(item, { ...item?.file, contents: "newer draft" });
    });
    await act(async () => {
      pendingWrite.resolve(textFileWriteResult(firstFile, "first draft", "revision-2"));
      await pendingWrite.promise;
    });

    await waitForDirtyFile();
    await runAsyncUiAction(() =>
      fireEvent.click(screen.getByRole("button", { name: "Save file" })),
    );
    await waitFor(() => expect(writeTextFileMock).toHaveBeenCalledTimes(2));
    await waitForCleanFile();
    expect(writeTextFileMock.mock.calls[1]?.[0]).toMatchObject({
      contents: "newer draft",
      revision: "revision-2",
    });
  });

  test("keeps the provider factory, editor options, and CodeView session stable across theme changes", async () => {
    const onClose = mock(() => {});
    const view = render(renderPreview({ selectedFile: firstFile, onClose }, "light"));
    await screen.findByText("const first = true;");
    await waitFor(() => expect(firstCodeViewItem()?.edit).toBe(true));
    const factory = editProviderFactories.at(-1);
    const options = latestCodeViewProps?.editorOptions;

    view.rerender(renderPreview({ selectedFile: firstFile, onClose }, "dark"));
    await waitFor(() => expect(editProviderFactories.length).toBeGreaterThan(1));

    expect(editProviderFactories.at(-1)).toBe(factory);
    expect(latestCodeViewProps?.editorOptions).toBe(options);
    expect(firstCodeViewItem()?.edit).toBe(true);
    expect(codeViewMountCount).toBe(1);
  });

  test("focuses the first visible line when the editor attaches", async () => {
    const onClose = mock(() => {});
    render(renderPreview({ selectedFile: firstFile, onClose }));
    await screen.findByText("const first = true;");
    await waitFor(() => expect(firstCodeViewItem()?.edit).toBe(true));
    const editorOptions = latestCodeViewProps?.editorOptions;
    const attachedEditor = createAttachedEditor(editorOptions);
    const focus = spyOn(attachedEditor, "focus").mockImplementation(() => {});

    expect(editorOptions?.onAttach).toBeFunction();
    attachEditor(editorOptions, attachedEditor);
    expect(focus).toHaveBeenCalledWith({ lineNumber: "first-visible", preventScroll: true });
  });

  test("returns focus to Pierre after Keep editing and routes both decisions", async () => {
    const onClose = mock(() => {});
    const onKeepEditing = mock(() => {});
    const onDiscard = mock(() => {});
    const view = render(
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
    const editorSurface = screen.getByLabelText("Code editor");
    const editorOptions = latestCodeViewProps?.editorOptions;
    const attachedEditor = createAttachedEditor(editorOptions);
    const focus = spyOn(attachedEditor, "focus").mockImplementation(() => editorSurface.focus());
    attachEditor(editorOptions, attachedEditor);
    fireEvent.keyDown(screen.getByLabelText("Selected file preview"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(onKeepEditing).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onKeepEditing).toHaveBeenCalledTimes(2);
    view.rerender(
      renderPreview({
        selectedFile: firstFile,
        onClose,
        hasPendingDiscard: false,
        onKeepEditing,
        onDiscard,
      }),
    );
    await waitFor(() => expect(focus).toHaveBeenCalledTimes(2));
    expect(document.activeElement).toBe(editorSurface);

    view.rerender(
      renderPreview({
        selectedFile: firstFile,
        onClose,
        hasPendingDiscard: true,
        onKeepEditing,
        onDiscard,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  test("does not save while the discard dialog is open", async () => {
    const onClose = mock(() => {});
    render(
      renderPreview({
        selectedFile: firstFile,
        onClose,
        hasPendingDiscard: true,
      }),
    );
    await screen.findByText("const first = true;");
    const item = firstCodeViewItem();
    act(() => {
      latestCodeViewProps?.onItemEditChange?.(item, { ...item?.file, contents: "local draft" });
    });

    const event = await dispatchPreviewSaveShortcut();

    expect(event.defaultPrevented).toBe(true);
    expect(writeTextFileMock).not.toHaveBeenCalled();
  });

  test("holds the discard choice while branch checkout runs", async () => {
    const onKeepEditing = mock(() => {});
    const onDiscard = mock(() => {});
    render(
      renderPreview({
        selectedFile: firstFile,
        onClose: () => {},
        hasPendingDiscard: true,
        isApplyingTransition: true,
        onKeepEditing,
        onDiscard,
      }),
    );

    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: "Keep editing" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(
      screen.getByRole("button", { name: "Switching branch..." }).hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onKeepEditing).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });
});

test("chat links open each Task's file through the shared preview and retain the transcript", async () => {
  readTextFileMock.mockImplementation(async (file: TaskExecutionSelectedFile) =>
    textFileResult(file, `contents from ${file.rootPath}`),
  );
  const view = render(
    <PreviewTestProviders>
      <ChatPreviewHarness />
    </PreviewTestProviders>,
  );
  try {
    const transcript = view.getByTestId("chat-transcript");
    transcript.scrollTop = 123;
    expect(readTextFileMock).not.toHaveBeenCalled();
    fireEvent.click(view.getByText("first file"));
    await screen.findByText("contents from /repo/a");
    expect(transcript.hidden).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Close file preview" }));
    expect(transcript.hidden).toBe(false);
    expect(transcript.scrollTop).toBe(123);
    fireEvent.click(screen.getByRole("button", { name: "Select Task B" }));
    fireEvent.click(view.getByText("first file"));
    await screen.findByText("contents from /repo/b");
    expect(readTextFileMock).toHaveBeenCalledTimes(2);
  } finally {
    view.unmount();
  }
});

test("chat selections keep dirty drafts until discard is accepted", async () => {
  readTextFileMock.mockImplementation(async (file: TaskExecutionSelectedFile) =>
    textFileResult(file, file.relativePath),
  );
  const view = render(
    <PreviewTestProviders>
      <ChatPreviewHarness />
    </PreviewTestProviders>,
  );
  try {
    fireEvent.click(view.getByText("first file"));
    await screen.findByRole("button", { name: "Save file" });
    const item = firstCodeViewItem();
    act(() =>
      latestCodeViewProps?.onItemEditChange?.(item, { ...item.file, contents: "keep this draft" }),
    );
    await waitForDirtyFile();
    fireEvent.click(view.getByText("first file"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitForDirtyFile();
    fireEvent.click(view.getByText("second file"));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitForDirtyFile();
    expect(readTextFileMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Save file" }));
    await waitFor(() =>
      expect(writeTextFileMock).toHaveBeenCalledWith(
        expect.objectContaining({ contents: "keep this draft" }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save file" }).hasAttribute("disabled")).toBe(true),
    );
    const savedItem = firstCodeViewItem();
    act(() =>
      latestCodeViewProps?.onItemEditChange?.(savedItem, {
        ...savedItem.file,
        contents: "discard this draft",
      }),
    );
    await waitForDirtyFile();
    fireEvent.click(view.getByText("second file"));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(readTextFileMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByLabelText("Code editor").textContent).toBe("src/second.ts"),
    );
  } finally {
    view.unmount();
  }
});
