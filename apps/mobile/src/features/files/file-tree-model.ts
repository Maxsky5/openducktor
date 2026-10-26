import type { WorkspaceFileGitStatus, WorkspaceFileTreeEntry } from "@openducktor/contracts";

type FileTreeKind = "directory" | "file";

type FileTreeNode = {
  path: string;
  name: string;
  /** The lowercase name and path, made once for each read, for sorting and search. */
  lowerName: string;
  lowerPath: string;
  kind: FileTreeKind;
  gitStatus: WorkspaceFileGitStatus | null;
  size: number | null;
};

/** The file tree of a directory, built once for each tree read. */
export type FileTreeIndex = {
  readonly nodes: ReadonlyMap<string, FileTreeNode>;
  /** The child paths of each directory path. The root has the key "". */
  readonly children: ReadonlyMap<string, readonly string[]>;
  /** The directories that hold a file with a Git change. */
  readonly changedDirectories: ReadonlySet<string>;
  /** Every file, by path in any letter case, so a search filters it without a sort. */
  readonly files: readonly FileTreeNode[];
  readonly fileCount: number;
};

/** One row of a folder or of a search. */
export type FileTreeRow = {
  key: string;
  path: string;
  name: string;
  kind: FileTreeKind;
  /** The folder of a search result, or null for a row of the shown folder. */
  directory: string | null;
  gitStatus: WorkspaceFileGitStatus | null;
  /** The entry count of a directory, or null for a file. */
  childCount: number | null;
  /** True for a directory that holds a file with a Git change. */
  changed: boolean;
  size: number | null;
};

/**
 * The Git marker of a file tree entry, as the desktop file tree shows it: a letter and its label,
 * so color is not the only sign. An ignored entry has no letter; it shows dimmed.
 */
export const FILE_GIT_STATUS_PRESENTATION = {
  added: { letter: "A", label: "Added" },
  deleted: { letter: "D", label: "Deleted" },
  modified: { letter: "M", label: "Modified" },
  renamed: { letter: "R", label: "Renamed" },
  untracked: { letter: "U", label: "Untracked" },
  ignored: { letter: null, label: "Ignored" },
} satisfies Record<WorkspaceFileGitStatus, { letter: string | null; label: string }>;

const parentDirectory = (path: string): string => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
};

const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/**
 * Compares by code unit, which costs far less than `localeCompare` on Hermes. A tree can hold
 * tens of thousands of entries.
 */
const compareText = (left: string, right: string): number => {
  if (left < right) return -1;
  return left > right ? 1 : 0;
};

const compareNodes = (left: FileTreeNode, right: FileTreeNode): number => {
  if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
  return compareText(left.lowerName, right.lowerName) || compareText(left.name, right.name);
};

const comparePaths = (left: FileTreeNode, right: FileTreeNode): number =>
  compareText(left.lowerPath, right.lowerPath) || compareText(left.path, right.path);

const toNode = (
  path: string,
  kind: FileTreeKind,
  gitStatus: WorkspaceFileGitStatus | null,
  size: number | null,
): FileTreeNode => {
  const name = nameOf(path);
  return {
    path,
    name,
    lowerName: name.toLowerCase(),
    lowerPath: path.toLowerCase(),
    kind,
    gitStatus,
    size,
  };
};

/**
 * Builds the tree of a file tree read. A directory that the read omits, but that holds an entry,
 * becomes a node too. Directories come first, then files, by name.
 */
export const buildFileTreeIndex = (entries: readonly WorkspaceFileTreeEntry[]): FileTreeIndex => {
  const nodes = new Map<string, FileTreeNode>();
  let fileCount = 0;
  const addDirectory = (path: string): void => {
    if (path === "" || nodes.has(path)) return;
    nodes.set(path, toNode(path, "directory", null, null));
    addDirectory(parentDirectory(path));
  };
  for (const entry of entries) {
    const path = entry.path.replace(/\/+$/, "");
    if (path.length === 0) continue;
    if (entry.kind === "file") fileCount += 1;
    const existing = nodes.get(path);
    nodes.set(
      path,
      toNode(path, entry.kind, entry.gitStatus ?? existing?.gitStatus ?? null, entry.size),
    );
    addDirectory(parentDirectory(path));
  }
  const grouped = new Map<string, FileTreeNode[]>();
  const changedDirectories = new Set<string>();
  const files: FileTreeNode[] = [];
  for (const node of nodes.values()) {
    if (node.kind === "file") files.push(node);
    const parent = parentDirectory(node.path);
    const siblings = grouped.get(parent);
    if (siblings) siblings.push(node);
    else grouped.set(parent, [node]);
    if (node.kind === "file" && node.gitStatus !== null && node.gitStatus !== "ignored") {
      let path = parent;
      while (path !== "" && !changedDirectories.has(path)) {
        changedDirectories.add(path);
        path = parentDirectory(path);
      }
    }
  }
  const children = new Map<string, string[]>();
  for (const [parent, siblings] of grouped) {
    children.set(
      parent,
      siblings.toSorted(compareNodes).map((node) => node.path),
    );
  }
  files.sort(comparePaths);
  return { nodes, children, changedDirectories, files, fileCount };
};

/**
 * The tree of a read, shared by each screen of the read. TanStack Query keeps one entries array
 * for each read, so the folders of one tree build it once.
 */
const indexCache = new WeakMap<readonly WorkspaceFileTreeEntry[], FileTreeIndex>();

export const fileTreeIndex = (entries: readonly WorkspaceFileTreeEntry[]): FileTreeIndex => {
  const cached = indexCache.get(entries);
  if (cached) return cached;
  const index = buildFileTreeIndex(entries);
  indexCache.set(entries, index);
  return index;
};

const toRow = (
  index: FileTreeIndex,
  node: FileTreeNode,
  directory: string | null,
): FileTreeRow => ({
  key: node.path,
  path: node.path,
  name: node.name,
  kind: node.kind,
  directory,
  gitStatus: node.gitStatus,
  childCount: node.kind === "directory" ? (index.children.get(node.path)?.length ?? 0) : null,
  changed: node.kind === "directory" && index.changedDirectories.has(node.path),
  size: node.size,
});

/** True when `directory` is the root or a directory of the tree. */
export const hasDirectory = (index: FileTreeIndex, directory: string): boolean =>
  directory === "" || index.nodes.get(directory)?.kind === "directory";

/**
 * A directory that holds only one directory joins it in one row, such as `apps/electron`, as in
 * the desktop file tree. The row opens the innermost directory.
 */
const joinedDirectoryRow = (index: FileTreeIndex, node: FileTreeNode): FileTreeRow => {
  let inner = node;
  let name = node.name;
  for (;;) {
    const children = index.children.get(inner.path) ?? [];
    const only = children.length === 1 ? index.nodes.get(children[0] ?? "") : undefined;
    if (only?.kind !== "directory") break;
    inner = only;
    name = `${name}/${only.name}`;
  }
  return { ...toRow(index, inner, null), name, gitStatus: inner.gitStatus ?? node.gitStatus };
};

/** The entries of one directory: directories first, then files, by name. */
export const directoryRows = (index: FileTreeIndex, directory: string): FileTreeRow[] =>
  (index.children.get(directory) ?? []).flatMap((path) => {
    const node = index.nodes.get(path);
    if (!node) return [];
    return [node.kind === "directory" ? joinedDirectoryRow(index, node) : toRow(index, node, null)];
  });

const isInside = (path: string, directory: string): boolean =>
  directory === "" || path.startsWith(`${directory}/`);

/**
 * The files under `directory` whose path holds the query, in any letter case, by path. Each
 * result names its folder, as in the desktop file tree search. It runs on each keystroke, so it
 * filters the sorted files of the index and lowercases only the query.
 */
export const searchFileRows = (
  index: FileTreeIndex,
  query: string,
  directory: string,
): FileTreeRow[] => {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const rows: FileTreeRow[] = [];
  for (const node of index.files) {
    if (!node.lowerPath.includes(needle) || !isInside(node.path, directory)) continue;
    rows.push(toRow(index, node, parentDirectory(node.path)));
  }
  return rows;
};

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

/** One decimal under 10, so "4.2 KB" and "18 MB". */
const scaledSize = (value: number, unit: string): string =>
  `${value < 10 ? Math.round(value * 10) / 10 : Math.round(value)} ${unit}`;

/** A file size such as "512 bytes", "4.2 KB", or "18 MB". */
export const formatFileSize = (bytes: number): string => {
  if (bytes < KB) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  if (bytes < MB) return scaledSize(bytes / KB, "KB");
  if (bytes < GB) return scaledSize(bytes / MB, "MB");
  return scaledSize(bytes / GB, "GB");
};

/** What the Files view shows: a load, why it has no files, or the folder of a ready tree. */
export type FilesViewState =
  | { kind: "loading" }
  | { kind: "unavailable"; reason: string }
  | { kind: "failed"; error: unknown }
  | { kind: "missing_folder" }
  | { kind: "ready"; rootPath: string };

/**
 * The state of the Files view. A tree that loaded once keeps its list after a failed refresh, and
 * the list shows that failure.
 */
export const filesViewState = ({
  directoryPending,
  unavailableReason,
  rootPath,
  loaded,
  error,
  folderFound,
}: {
  /** True while the working directory resolves. */
  directoryPending: boolean;
  unavailableReason: string | null;
  rootPath: string | null;
  loaded: boolean;
  error: unknown;
  /** True when the loaded tree has the folder of the view. */
  folderFound: boolean;
}): FilesViewState => {
  if (directoryPending) return { kind: "loading" };
  if (unavailableReason || rootPath === null) {
    return {
      kind: "unavailable",
      reason: unavailableReason ?? "The working directory is unavailable.",
    };
  }
  if (!loaded) return error ? { kind: "failed", error } : { kind: "loading" };
  return folderFound ? { kind: "ready", rootPath } : { kind: "missing_folder" };
};
