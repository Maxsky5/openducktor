import type { WorkspaceFileTreeEntry } from "@openducktor/contracts";
import type { TreeThemeInput } from "@pierre/trees";
import { prepareFileTreeInput, themeToTreeStyles } from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { useQuery } from "@tanstack/react-query";
import {
  type CSSProperties,
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { useTheme } from "@/components/layout/theme-provider";
import { CopyIconButton } from "@/components/ui/copy-icon-button";
import { errorMessage } from "@/lib/errors";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { workspaceFileTreeQueryOptions } from "@/state/queries/filesystem";
import {
  buildTaskExecutionFileTreeGitStatusEntries,
  buildTaskExecutionFileTreeInputPaths,
  resolveTaskExecutionFileTreeSelectionEntry,
  shouldClearTaskExecutionSelectedFile,
  type TaskExecutionFileExplorerPanelModel,
  type TaskExecutionSelectedFile,
} from "./task-execution-file-explorer-model";

const EMPTY_TREE_INPUT = prepareFileTreeInput([]);

const TREE_THEME_BY_MODE = {
  light: {
    name: "openducktor-light",
    type: "light",
    bg: "var(--card)",
    fg: "var(--foreground)",
    colors: {
      focusBorder: "var(--ring)",
      "list.activeSelectionBackground": "var(--selected-surface)",
      "list.activeSelectionForeground": "var(--foreground)",
      "list.focusBackground": "var(--selected-surface)",
      "list.hoverBackground": "var(--muted)",
      "sideBar.background": "var(--card)",
      "sideBar.foreground": "var(--foreground)",
      "sideBarSectionHeader.background": "var(--muted)",
      "sideBarSectionHeader.foreground": "var(--foreground)",
    },
  },
  dark: {
    name: "openducktor-dark",
    type: "dark",
    bg: "var(--card)",
    fg: "var(--foreground)",
    colors: {
      focusBorder: "var(--ring)",
      "list.activeSelectionBackground": "var(--selected-surface)",
      "list.activeSelectionForeground": "var(--foreground)",
      "list.focusBackground": "var(--selected-surface)",
      "list.hoverBackground": "var(--muted)",
      "sideBar.background": "var(--card)",
      "sideBar.foreground": "var(--foreground)",
      "sideBarSectionHeader.background": "var(--muted)",
      "sideBarSectionHeader.foreground": "var(--foreground)",
    },
  },
} satisfies Record<"light" | "dark", TreeThemeInput>;

const treeStylesForTheme = (theme: "light" | "dark"): CSSProperties =>
  ({
    ...themeToTreeStyles(TREE_THEME_BY_MODE[theme]),
    "--trees-bg-override": "var(--card)",
    "--trees-fg-override": "var(--foreground)",
    "--trees-border-color-override": "var(--border)",
    "--trees-selected-bg-override": "var(--selected-surface)",
    "--trees-selected-fg-override": "var(--foreground)",
    height: "100%",
  }) as CSSProperties;

const buildEntriesByPath = (
  entries: readonly WorkspaceFileTreeEntry[] | undefined,
): Map<string, WorkspaceFileTreeEntry> => {
  const byPath = new Map<string, WorkspaceFileTreeEntry>();
  for (const entry of entries ?? []) {
    byPath.set(entry.path, entry);
  }
  return byPath;
};

type SelectionContextRef = {
  entriesByPath: Map<string, WorkspaceFileTreeEntry>;
  rootPath: string | null;
  selectedFile: TaskExecutionSelectedFile | null;
  onSelectFile: (file: TaskExecutionSelectedFile) => void;
};

type FileTreeModel = ReturnType<typeof useFileTree>["model"];

const selectedFilesEqual = (
  first: TaskExecutionSelectedFile | null,
  second: TaskExecutionSelectedFile | null,
): boolean => first?.rootPath === second?.rootPath && first?.relativePath === second?.relativePath;

const clearFileTreeSelection = (
  fileTree: FileTreeModel,
  entriesByPath: ReadonlyMap<string, WorkspaceFileTreeEntry>,
): void => {
  for (const selectedPath of fileTree.getSelectedPaths()) {
    const selectedEntry = resolveTaskExecutionFileTreeSelectionEntry(selectedPath, entriesByPath);
    fileTree.getItem(selectedEntry?.path ?? selectedPath)?.deselect();
  }
};

const syncFileTreeSelection = (
  fileTree: FileTreeModel,
  selectedFile: TaskExecutionSelectedFile | null,
  rootPath: string | null,
  entriesByPath: ReadonlyMap<string, WorkspaceFileTreeEntry>,
): void => {
  if (!selectedFile || selectedFile.rootPath !== rootPath) {
    clearFileTreeSelection(fileTree, entriesByPath);
    return;
  }

  const selectedEntry = entriesByPath.get(selectedFile.relativePath);
  if (selectedEntry?.kind !== "file") {
    clearFileTreeSelection(fileTree, entriesByPath);
    return;
  }

  const selectedPaths = fileTree.getSelectedPaths();
  const currentEntry =
    selectedPaths.length === 1
      ? resolveTaskExecutionFileTreeSelectionEntry(selectedPaths[0] ?? "", entriesByPath)
      : null;
  if (currentEntry?.path === selectedEntry.path) {
    return;
  }

  clearFileTreeSelection(fileTree, entriesByPath);
  fileTree.getItem(selectedEntry.path)?.select();
};

const selectTaskExecutionFileTreePath = (
  selectedPath: string | undefined,
  context: SelectionContextRef,
): void => {
  if (!selectedPath) {
    return;
  }
  const entry = resolveTaskExecutionFileTreeSelectionEntry(selectedPath, context.entriesByPath);
  if (!context.rootPath || entry?.kind !== "file") {
    return;
  }
  const selectedFile = {
    rootPath: context.rootPath,
    relativePath: entry.path,
  };
  if (selectedFilesEqual(selectedFile, context.selectedFile)) {
    return;
  }
  context.onSelectFile(selectedFile);
};

function FileExplorerUnavailableState({ message }: { message: string }): ReactElement {
  return (
    <div className="flex h-full min-h-0 items-center justify-center p-4 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function FileExplorerRootPathHeader({ rootPath }: { rootPath: string }): ReactElement {
  const { copied, copyToClipboard } = useCopyToClipboard({
    successMessage: "Working directory copied",
    errorLogContext: "TaskExecutionFileExplorerPanel.copyWorkingDirectory",
  });

  const copyWorkingDirectory = useCallback(() => {
    void copyToClipboard(rootPath);
  }, [copyToClipboard, rootPath]);

  return (
    <div className="border-b border-border px-3 py-2">
      <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-medium leading-3 text-muted-foreground">Working dir</div>
          <code
            className="block min-w-0 truncate font-mono text-[11px] leading-4 text-foreground"
            title={rootPath}
            data-testid="task-execution-file-explorer-root-path"
          >
            {rootPath}
          </code>
        </div>
        <CopyIconButton
          copied={copied}
          ariaLabel="Copy working directory"
          tooltipLabel={copied ? "Copied" : "Copy working directory"}
          dataTestId="task-execution-file-explorer-copy-root-path"
          className="size-6 shrink-0 border-transparent bg-transparent hover:bg-muted"
          onClick={copyWorkingDirectory}
        />
      </div>
    </div>
  );
}

export function TaskExecutionFileExplorerPanel({
  model,
}: {
  model: TaskExecutionFileExplorerPanelModel;
}): ReactElement {
  const requestedRootPath = model.rootPath;
  const treeQuery = useQuery({
    ...workspaceFileTreeQueryOptions(
      requestedRootPath ?? "__inactive_file_tree__",
      model.targetBranch,
    ),
    enabled: model.isActive && requestedRootPath !== null,
  });
  const rootPath = treeQuery.data?.rootPath ?? requestedRootPath;
  const resolvedRootPath = treeQuery.data?.rootPath ?? null;
  const { theme } = useTheme();
  const treeStyle = useMemo(() => treeStylesForTheme(theme), [theme]);
  const entriesByPath = useMemo(
    () => buildEntriesByPath(treeQuery.data?.entries),
    [treeQuery.data?.entries],
  );
  const gitStatusEntries = useMemo(
    () => buildTaskExecutionFileTreeGitStatusEntries(treeQuery.data?.entries),
    [treeQuery.data?.entries],
  );
  const fileTreeInputPaths = useMemo(
    () => buildTaskExecutionFileTreeInputPaths(treeQuery.data?.entries),
    [treeQuery.data?.entries],
  );
  const selectionRef = useRef<SelectionContextRef>({
    entriesByPath,
    rootPath,
    selectedFile: model.selectedFile,
    onSelectFile: model.onSelectFile,
  });
  const previousRootPathRef = useRef(rootPath);

  selectionRef.current = {
    entriesByPath,
    rootPath,
    selectedFile: model.selectedFile,
    onSelectFile: model.onSelectFile,
  };

  const { model: fileTree } = useFileTree({
    preparedInput: EMPTY_TREE_INPUT,
    initialExpansion: "closed",
    fileTreeSearchMode: "hide-non-matches",
    search: true,
    icons: "complete",
    gitStatus: [],
  });
  const preparedInput = useMemo(
    () => (treeQuery.data ? prepareFileTreeInput(fileTreeInputPaths) : null),
    [fileTreeInputPaths, treeQuery.data],
  );

  useEffect(
    () =>
      fileTree.subscribe(() => {
        const selectedPath = fileTree.getSelectedPaths().at(-1);
        selectTaskExecutionFileTreePath(selectedPath, selectionRef.current);
      }),
    [fileTree],
  );

  useEffect(() => {
    if (!preparedInput) {
      fileTree.resetPaths({ preparedInput: EMPTY_TREE_INPUT });
      fileTree.setGitStatus([]);
      return;
    }

    fileTree.resetPaths({ preparedInput });
    fileTree.setIcons("complete");
    fileTree.setGitStatus(gitStatusEntries);
  }, [fileTree, gitStatusEntries, preparedInput]);

  useEffect(() => {
    syncFileTreeSelection(fileTree, model.selectedFile, rootPath, entriesByPath);
  }, [entriesByPath, fileTree, model.selectedFile, rootPath]);

  useLayoutEffect(() => {
    if (shouldClearTaskExecutionSelectedFile(model.selectedFile, resolvedRootPath)) {
      model.onClearSelectedFile();
    }
  }, [model.onClearSelectedFile, model.selectedFile, resolvedRootPath]);

  useEffect(() => {
    if (previousRootPathRef.current === rootPath) {
      return;
    }
    previousRootPathRef.current = rootPath;
    fileTree.setSearch(null);
  }, [fileTree, rootPath]);

  if (model.unavailableReason) {
    return <FileExplorerUnavailableState message={model.unavailableReason} />;
  }

  if (rootPath === null) {
    return <FileExplorerUnavailableState message="No repository is selected." />;
  }

  if (treeQuery.isError) {
    return <FileExplorerUnavailableState message={errorMessage(treeQuery.error)} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <FileExplorerRootPathHeader rootPath={rootPath} />
      <div className="min-h-0 flex-1 overflow-hidden py-2.5">
        {treeQuery.isLoading ? (
          <FileExplorerUnavailableState message="Loading files..." />
        ) : fileTreeInputPaths.length === 0 ? (
          <FileExplorerUnavailableState message="No files found." />
        ) : (
          <FileTree
            model={fileTree}
            style={treeStyle}
            className="h-full min-h-0"
            aria-label="Workspace file explorer"
          />
        )}
      </div>
    </div>
  );
}
