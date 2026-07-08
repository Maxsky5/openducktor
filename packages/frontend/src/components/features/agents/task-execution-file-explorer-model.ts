import type { WorkspaceFileTreeEntry } from "@openducktor/contracts";
import type { GitStatusEntry } from "@pierre/trees";

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

export const buildTaskExecutionFileTreeInputPaths = (
  entries: readonly WorkspaceFileTreeEntry[] | undefined,
): string[] => {
  const paths: string[] = [];
  for (const entry of entries ?? []) {
    if (entry.kind === "file") {
      paths.push(entry.path);
    }
  }
  return paths;
};

const buildAncestorDirectoryPaths = (filePath: string): string[] => {
  const segments = filePath.split("/").filter(Boolean);
  const ancestors: string[] = [];
  for (let length = 1; length < segments.length; length += 1) {
    ancestors.push(segments.slice(0, length).join("/"));
  }
  return ancestors;
};

export const buildTaskExecutionFileTreeGitStatusEntries = (
  entries: readonly WorkspaceFileTreeEntry[] | undefined,
): GitStatusEntry[] => {
  const statusByPath = new Map<string, GitStatusEntry["status"]>();
  const pathOrder: string[] = [];
  const addStatus = (path: string, status: GitStatusEntry["status"]) => {
    const previousStatus = statusByPath.get(path);
    if (previousStatus === undefined) {
      pathOrder.push(path);
      statusByPath.set(path, status);
      return;
    }
    if (previousStatus !== status) {
      statusByPath.set(path, "modified");
    }
  };

  for (const entry of entries ?? []) {
    if (entry.gitStatus === null) {
      continue;
    }

    const status = entry.gitStatus as GitStatusEntry["status"];
    if (entry.kind === "file") {
      for (const ancestorPath of buildAncestorDirectoryPaths(entry.path)) {
        addStatus(ancestorPath, "modified");
      }
    }
    addStatus(entry.path, status);
  }

  return pathOrder.map((path) => ({
    path,
    status: statusByPath.get(path) ?? "modified",
  }));
};

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
