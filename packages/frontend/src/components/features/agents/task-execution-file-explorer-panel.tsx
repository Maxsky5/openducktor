import type { WorkspaceFileTreeEntry } from "@openducktor/contracts";
import type { GitStatusEntry, TreeThemeInput } from "@pierre/trees";
import { preparePresortedFileTreeInput, themeToTreeStyles } from "@pierre/trees";
import { FileTree, useFileTree, useFileTreeSearch } from "@pierre/trees/react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { type CSSProperties, type ReactElement, useEffect, useMemo, useRef } from "react";
import { useTheme } from "@/components/layout/theme-provider";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/errors";
import { workspaceFileTreeQueryOptions } from "@/state/queries/filesystem";

export type TaskExecutionSelectedFile = {
  rootPath: string;
  relativePath: string;
};

export type TaskExecutionFileExplorerPanelModel = {
  rootPath: string | null;
  unavailableReason: string | null;
  isActive: boolean;
  selectedFile: TaskExecutionSelectedFile | null;
  onSelectFile: (file: TaskExecutionSelectedFile) => void;
};

const EMPTY_TREE_INPUT = preparePresortedFileTreeInput([]);

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

export const buildTaskExecutionFileTreeInputPaths = (
  entries: readonly WorkspaceFileTreeEntry[] | undefined,
): string[] => (entries ?? []).filter((entry) => entry.kind === "file").map((entry) => entry.path);

const buildGitStatusEntries = (
  entries: readonly WorkspaceFileTreeEntry[] | undefined,
): GitStatusEntry[] =>
  (entries ?? [])
    .filter((entry) => entry.kind === "file" && entry.gitStatus !== null)
    .map((entry) => ({
      path: entry.path,
      status: entry.gitStatus as GitStatusEntry["status"],
    }));

export const normalizeTaskExecutionFileTreeSelectionPath = (path: string): string =>
  path.startsWith("f::") ? path.slice(3) : path;

export const resolveTaskExecutionFileTreeSelectionEntry = (
  selectedPath: string,
  entriesByPath: ReadonlyMap<string, WorkspaceFileTreeEntry>,
): WorkspaceFileTreeEntry | null => {
  const normalizedPath = normalizeTaskExecutionFileTreeSelectionPath(selectedPath);
  const exactEntry = entriesByPath.get(normalizedPath);
  if (exactEntry) {
    return exactEntry;
  }

  let matchedEntry: WorkspaceFileTreeEntry | null = null;
  for (const entry of entriesByPath.values()) {
    if (entry.path.endsWith(`/${normalizedPath}`)) {
      if (matchedEntry !== null) {
        return null;
      }
      matchedEntry = entry;
    }
  }
  return matchedEntry;
};

type SelectionContextRef = {
  entriesByPath: Map<string, WorkspaceFileTreeEntry>;
  rootPath: string | null;
  onSelectFile: (file: TaskExecutionSelectedFile) => void;
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
  context.onSelectFile({
    rootPath: context.rootPath,
    relativePath: entry.path,
  });
};

function FileExplorerUnavailableState({ message }: { message: string }): ReactElement {
  return (
    <div className="flex h-full min-h-0 items-center justify-center p-4 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

export function TaskExecutionFileExplorerPanel({
  model,
}: {
  model: TaskExecutionFileExplorerPanelModel;
}): ReactElement {
  const rootPath = model.rootPath;
  const treeQuery = useQuery({
    ...workspaceFileTreeQueryOptions(rootPath ?? "__inactive_file_tree__"),
    enabled: model.isActive && rootPath !== null,
  });
  const { theme } = useTheme();
  const treeStyle = useMemo(() => treeStylesForTheme(theme), [theme]);
  const entriesByPath = useMemo(
    () => buildEntriesByPath(treeQuery.data?.entries),
    [treeQuery.data?.entries],
  );
  const gitStatusEntries = useMemo(
    () => buildGitStatusEntries(treeQuery.data?.entries),
    [treeQuery.data?.entries],
  );
  const fileTreeInputPaths = useMemo(
    () => buildTaskExecutionFileTreeInputPaths(treeQuery.data?.entries),
    [treeQuery.data?.entries],
  );
  const selectionRef = useRef<SelectionContextRef>({
    entriesByPath,
    rootPath,
    onSelectFile: model.onSelectFile,
  });
  const previousRootPathRef = useRef(rootPath);

  selectionRef.current = {
    entriesByPath,
    rootPath,
    onSelectFile: model.onSelectFile,
  };

  const { model: fileTree } = useFileTree({
    preparedInput: EMPTY_TREE_INPUT,
    initialExpansion: "open",
    fileTreeSearchMode: "hide-non-matches",
    search: true,
    icons: "complete",
    gitStatus: [],
  });
  const search = useFileTreeSearch(fileTree);
  const preparedInput = useMemo(
    () => (treeQuery.data ? preparePresortedFileTreeInput(fileTreeInputPaths) : null),
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

  const searchValue = search.value;

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="space-y-2 border-b border-border p-3">
        <div className="truncate text-xs text-muted-foreground" title={rootPath}>
          {rootPath}
        </div>
        <div className="relative">
          <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-3.5 text-muted-foreground" />
          <Input
            value={searchValue}
            aria-label="Search files"
            placeholder="Search files"
            className="h-8 pl-8 text-xs"
            onFocus={() => search.open(searchValue)}
            onChange={(event) => {
              const nextValue = event.currentTarget.value;
              if (!search.isOpen) {
                search.open(nextValue);
              }
              search.setValue(nextValue.length > 0 ? nextValue : null);
            }}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
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
