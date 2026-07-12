import type { WorkspaceFileTreeEntry } from "@openducktor/contracts";
import type { GitStatusEntry } from "@pierre/trees";

export type TaskExecutionSelectedFile = {
  rootPath: string;
  relativePath: string;
};

export type TaskExecutionFileExplorerPanelModel = {
  rootPath: string | null;
  targetBranch: string | null;
  unavailableReason: string | null;
  isActive: boolean;
  selectedFile: TaskExecutionSelectedFile | null;
  onSelectFile: (file: TaskExecutionSelectedFile) => void;
  onClearSelectedFile: () => void;
};

export const buildTaskExecutionFileTreeInputPaths = (
  entries: readonly WorkspaceFileTreeEntry[] | undefined,
): string[] => {
  const paths: string[] = [];
  for (const entry of entries ?? []) {
    paths.push(entry.kind === "directory" ? `${entry.path}/` : entry.path);
  }
  return paths;
};

export const buildTaskExecutionFileTreeGitStatusEntries = (
  entries: readonly WorkspaceFileTreeEntry[] | undefined,
): GitStatusEntry[] => {
  const gitStatusEntries: GitStatusEntry[] = [];

  for (const entry of entries ?? []) {
    if (entry.kind !== "file" || entry.gitStatus === null) {
      continue;
    }
    gitStatusEntries.push({
      path: entry.path,
      status: entry.gitStatus as GitStatusEntry["status"],
    });
  }

  return gitStatusEntries;
};

export const shouldClearTaskExecutionSelectedFile = (
  selectedFile: TaskExecutionSelectedFile | null,
  resolvedRootPath: string | null,
): boolean =>
  selectedFile !== null && resolvedRootPath !== null && selectedFile.rootPath !== resolvedRootPath;

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
