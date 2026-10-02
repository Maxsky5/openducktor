import type { FileDiff } from "@openducktor/contracts";
import {
  type FileSearchMatch,
  type HighlightRange,
  NO_HIGHLIGHTS,
  sliceRanges,
} from "./file-list-search";

/** Text that a row shows, with the matched characters to highlight. */
export type RowLabel = { text: string; highlights: readonly HighlightRange[] };

export type FileRow = {
  kind: "file";
  key: string;
  diff: FileDiff;
  /** Count of directory rows above the row. Always 0 in list view. */
  depth: number;
  name: RowLabel;
  /** The directory line under the name. List view only. */
  directory: RowLabel | null;
};

export type DirectoryRow = {
  kind: "directory";
  key: string;
  /** Full path of the innermost directory joined into the row. */
  path: string;
  /** Full path of each directory joined into the row, outermost first. */
  chainPaths: readonly string[];
  /** For example `adapters/vendure`. */
  name: RowLabel;
  depth: number;
  isOpen: boolean;
};

export type FileListRow = FileRow | DirectoryRow;

/** Changed files grouped by directory. Directory rows get their open state when the tree is flattened. */
export type FileTree = readonly TreeNode[];

export function buildListRows(matches: readonly FileSearchMatch[]): FileRow[] {
  return matches.map((match) => {
    const { file } = match.diff;
    const nameStart = fileNameStart(file);
    const directory =
      nameStart > 0
        ? {
            text: file.slice(0, nameStart - 1),
            highlights: sliceRanges(match.ranges, 0, nameStart - 1),
          }
        : null;
    return toFileRow(match, 0, directory);
  });
}

/** Groups the matches by directory. Only directories that contain a match appear. */
export function buildFileTree(matches: readonly FileSearchMatch[]): FileTree {
  const root = draftDirectory("", 0, NO_HIGHLIGHTS);
  for (const match of matches) {
    const path = match.diff.file;
    let directory = root;
    let segmentStart = 0;
    let slash = path.indexOf("/");
    while (slash !== -1) {
      const segment = path.slice(segmentStart, slash);
      let child = directory.directories.get(segment);
      if (!child) {
        child = draftDirectory(path.slice(0, slash), segmentStart, match.ranges);
        directory.directories.set(segment, child);
      }
      directory = child;
      segmentStart = slash + 1;
      slash = path.indexOf("/", segmentStart);
    }
    directory.files.push(match);
  }
  return toTreeNodes(root, 0);
}

/** Lists the visible rows depth first. A joined row is closed when any of its directories is closed. */
export function flattenFileTree(
  tree: FileTree,
  closedDirectories: ReadonlySet<string>,
): FileListRow[] {
  const rows: FileListRow[] = [];
  const visit = (nodes: readonly TreeNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "file") {
        rows.push(node);
        continue;
      }
      const { children, ...directory } = node;
      const isOpen = !directory.chainPaths.some((path) => closedDirectories.has(path));
      rows.push({ ...directory, isOpen });
      if (isOpen) {
        visit(children);
      }
    }
  };
  visit(tree);
  return rows;
}

/** Returns every ancestor directory path of every file. */
export function collectDirectoryPaths(fileDiffs: readonly FileDiff[]): Set<string> {
  const paths = new Set<string>();
  for (const { file } of fileDiffs) {
    let slash = file.lastIndexOf("/");
    while (slash > 0) {
      const path = file.slice(0, slash);
      if (paths.has(path)) {
        // The ancestors of a known path are known too.
        break;
      }
      paths.add(path);
      slash = file.lastIndexOf("/", slash - 1);
    }
  }
  return paths;
}

/** A row that a change of rows should keep in view. */
export type RowAnchor = {
  key: string;
  index: number;
  /** The rows that were shown when the anchor was set. */
  rows: readonly FileListRow[];
};

export type AnchorRowMatch = { index: number; isAnchorRow: boolean };

/**
 * Finds the anchor row in the new rows. When it is gone, it uses a related row:
 * the first row in an anchor directory, or the closed directory that hides an anchor file.
 * Else it uses the next row from the anchor's rows that is still shown.
 */
export function findAnchorRow(rows: readonly FileListRow[], anchor: RowAnchor): AnchorRowMatch {
  const index = rows.findIndex((row) => row.key === anchor.key);
  if (index >= 0) {
    return { index, isAnchorRow: true };
  }
  const anchorRow = anchor.rows[anchor.index];
  const relatedIndex = anchorRow ? findRelatedRow(rows, anchorRow) : -1;
  if (relatedIndex >= 0) {
    return { index: relatedIndex, isAnchorRow: false };
  }
  const indexByKey = new Map(rows.map((row, rowIndex) => [row.key, rowIndex]));
  for (const nextRow of anchor.rows.slice(anchor.index + 1)) {
    const nextIndex = indexByKey.get(nextRow.key);
    if (nextIndex !== undefined) {
      return { index: nextIndex, isAnchorRow: false };
    }
  }
  return { index: Math.min(anchor.index, rows.length - 1), isAnchorRow: false };
}

type TreeDirectory = Omit<DirectoryRow, "isOpen"> & { children: readonly TreeNode[] };

type TreeNode = TreeDirectory | FileRow;

type DraftDirectory = {
  path: string;
  /** Offset of this directory's name in `path`. */
  nameStart: number;
  directories: Map<string, DraftDirectory>;
  files: FileSearchMatch[];
  /** All matching files under the directory share these ranges inside the directory path. */
  firstFileRanges: readonly HighlightRange[];
};

function draftDirectory(
  path: string,
  nameStart: number,
  firstFileRanges: readonly HighlightRange[],
): DraftDirectory {
  return { path, nameStart, directories: new Map(), files: [], firstFileRanges };
}

function toTreeNodes(directory: DraftDirectory, depth: number): TreeNode[] {
  const directories = Array.from(directory.directories.values(), (child) =>
    toTreeDirectory(child, depth),
  ).sort((left, right) => compareNames(left.name.text, right.name.text));
  const files = directory.files
    .map((match) => toFileRow(match, depth, null))
    .sort((left, right) => compareNames(left.name.text, right.name.text));
  return [...directories, ...files];
}

function toTreeDirectory(directory: DraftDirectory, depth: number): TreeDirectory {
  // Join a chain of directories that hold only one sub-directory and no files into one row.
  const chainPaths = [directory.path];
  let last = directory;
  let onlyChild = onlyChildDirectory(last);
  while (onlyChild) {
    last = onlyChild;
    chainPaths.push(last.path);
    onlyChild = onlyChildDirectory(last);
  }
  return {
    kind: "directory",
    key: `dir:${last.path}`,
    path: last.path,
    chainPaths,
    name: {
      text: last.path.slice(directory.nameStart),
      highlights: sliceRanges(last.firstFileRanges, directory.nameStart, last.path.length),
    },
    depth,
    children: toTreeNodes(last, depth + 1),
  };
}

function onlyChildDirectory(directory: DraftDirectory): DraftDirectory | null {
  if (directory.files.length > 0 || directory.directories.size !== 1) {
    return null;
  }
  const [child] = directory.directories.values();
  return child ?? null;
}

function toFileRow(
  { diff, ranges }: FileSearchMatch,
  depth: number,
  directory: RowLabel | null,
): FileRow {
  const nameStart = fileNameStart(diff.file);
  return {
    kind: "file",
    key: `file:${diff.file}`,
    diff,
    depth,
    name: {
      text: diff.file.slice(nameStart),
      highlights: sliceRanges(ranges, nameStart, diff.file.length),
    },
    directory,
  };
}

/** Offset of the file name in a slash-separated path. */
function fileNameStart(path: string): number {
  return path.lastIndexOf("/") + 1;
}

const nameCollator = new Intl.Collator("en", { sensitivity: "base" });

function compareNames(left: string, right: string): number {
  const order = nameCollator.compare(left, right);
  if (order !== 0) {
    return order;
  }
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

function findRelatedRow(rows: readonly FileListRow[], anchorRow: FileListRow): number {
  if (anchorRow.kind === "directory") {
    // List view has no directory rows, so use the first file in the directory.
    const prefix = `${anchorRow.path}/`;
    return rows.findIndex((row) =>
      (row.kind === "file" ? row.diff.file : row.path).startsWith(prefix),
    );
  }
  // The tree can hide the file in a closed directory.
  return rows.findIndex(
    (row) =>
      row.kind === "directory" && !row.isOpen && anchorRow.diff.file.startsWith(`${row.path}/`),
  );
}
