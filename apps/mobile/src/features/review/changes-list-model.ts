import type {
  ChangedFileGroup,
  ChangedFileItem,
  ChangesListItem,
  CollapsibleGroup,
} from "./changes-model";
import { EMPTY_GROUP_TEXT } from "./changes-model";
import type { FileListViewMode } from "./changes-view-state";
import { type DiffBodyRow, diffBodyRowType } from "./diff-body-model";

/** One row of the Changes list: a group header, a tree directory, a changed file, or a diff row. */
export type ChangesRow =
  | {
      kind: "group";
      key: string;
      group: ChangedFileGroup;
      title: string;
      count: number;
      /** Null for a group that always stays open, such as Conflicts. */
      open: boolean | null;
    }
  | { kind: "group-empty"; key: string; text: string }
  | {
      kind: "directory";
      key: string;
      /** The key of the directory in `closedDirectories`. */
      directoryKey: string;
      path: string;
      /** The directory names that the row joins, such as `adapters/vendure`. */
      name: string;
      depth: number;
      open: boolean;
    }
  | {
      kind: "file";
      key: string;
      file: ChangedFileItem;
      depth: number;
      /** List view shows the directory under the name. Tree view shows it as parent rows. */
      showsDirectory: boolean;
      expanded: boolean;
    }
  | DiffBodyRow;

/** The key of a tree directory of a group in `closedDirectories`. */
export const directoryKey = (group: ChangedFileGroup, path: string): string =>
  JSON.stringify([group, path]);

const isCollapsible = (group: ChangedFileGroup): group is CollapsibleGroup =>
  group === "unstaged" || group === "staged";

type TreeDirectory = {
  path: string;
  /** Where the name of the first joined directory starts in `path`. */
  nameStart: number;
  directories: Map<string, TreeDirectory>;
  files: ChangedFileItem[];
};

const draftDirectory = (path: string, nameStart: number): TreeDirectory => ({
  path,
  nameStart,
  directories: new Map(),
  files: [],
});

const compareNames = (left: string, right: string): number => {
  const order = left.toLowerCase().localeCompare(right.toLowerCase());
  if (order !== 0) return order;
  return left < right ? -1 : left > right ? 1 : 0;
};

const buildTree = (files: readonly ChangedFileItem[]): TreeDirectory => {
  const root = draftDirectory("", 0);
  for (const file of files) {
    let directory = root;
    let start = 0;
    let slash = file.path.indexOf("/");
    while (slash !== -1) {
      const segment = file.path.slice(start, slash);
      let child = directory.directories.get(segment);
      if (!child) {
        child = draftDirectory(file.path.slice(0, slash), start);
        directory.directories.set(segment, child);
      }
      directory = child;
      start = slash + 1;
      slash = file.path.indexOf("/", start);
    }
    directory.files.push(file);
  }
  return root;
};

const onlyChild = (directory: TreeDirectory): TreeDirectory | null => {
  if (directory.files.length > 0 || directory.directories.size !== 1) return null;
  const [child] = directory.directories.values();
  return child ?? null;
};

type Visit = {
  group: ChangedFileGroup;
  closedDirectories: ReadonlySet<string>;
  pushFile: (file: ChangedFileItem, depth: number, showsDirectory: boolean) => void;
  rows: ChangesRow[];
};

/**
 * Adds the rows of a directory, depth first: directories before files, each sorted by name. A
 * chain of directories that hold only one directory and no files joins into one row, as on
 * desktop.
 */
const visitTree = (directory: TreeDirectory, depth: number, visit: Visit): void => {
  const joined = [...directory.directories.values()].map((first) => {
    let last = first;
    let next = onlyChild(last);
    while (next) {
      last = next;
      next = onlyChild(last);
    }
    return { name: last.path.slice(first.nameStart), last };
  });
  joined.sort((left, right) => compareNames(left.name, right.name));
  for (const { name, last } of joined) {
    const key = directoryKey(visit.group, last.path);
    const open = !visit.closedDirectories.has(key);
    visit.rows.push({
      kind: "directory",
      key: `directory:${key}`,
      directoryKey: key,
      path: last.path,
      name,
      depth,
      open,
    });
    if (open) visitTree(last, depth + 1, visit);
  }
  const files = [...directory.files].sort((left, right) => compareNames(left.name, right.name));
  for (const file of files) visit.pushFile(file, depth, false);
};

/**
 * The rows of the Changes list. Each group shows its header, then its files as a list or a tree,
 * with the diff of each expanded file under its row. `diffBody` gives the diff rows of a file.
 */
export const buildChangesRows = ({
  items,
  viewMode,
  expandedFiles,
  collapsedGroups,
  closedDirectories,
  diffBody,
}: {
  items: readonly ChangesListItem[];
  viewMode: FileListViewMode;
  expandedFiles: ReadonlySet<string>;
  collapsedGroups: ReadonlySet<CollapsibleGroup>;
  closedDirectories: ReadonlySet<string>;
  diffBody: (file: ChangedFileItem) => readonly DiffBodyRow[];
}): ChangesRow[] => {
  const rows: ChangesRow[] = [];
  const pushFile = (file: ChangedFileItem, depth: number, showsDirectory: boolean): void => {
    const expanded = expandedFiles.has(file.key);
    rows.push({ kind: "file", key: file.key, file, depth, showsDirectory, expanded });
    if (expanded) rows.push(...diffBody(file));
  };
  const pushFiles = (group: ChangedFileGroup, files: readonly ChangedFileItem[]): void => {
    if (viewMode === "list") {
      for (const file of files) pushFile(file, 0, true);
      return;
    }
    visitTree(buildTree(files), 0, { group, closedDirectories, pushFile, rows });
  };

  let group: ChangedFileGroup | null = null;
  let files: ChangedFileItem[] = [];
  const flush = (): void => {
    if (group !== null && files.length > 0) pushFiles(group, files);
    files = [];
  };
  let open = true;
  for (const item of items) {
    if (item.kind === "section") {
      flush();
      group = item.group;
      const collapsible = isCollapsible(item.group) ? item.group : null;
      open = collapsible === null || !collapsedGroups.has(collapsible);
      rows.push({
        kind: "group",
        key: item.key,
        group: item.group,
        title: item.title,
        count: item.count,
        open: collapsible === null ? null : open,
      });
      if (collapsible !== null && open && item.count === 0) {
        rows.push({
          kind: "group-empty",
          key: `${item.key}:empty`,
          text: EMPTY_GROUP_TEXT[collapsible],
        });
      }
      continue;
    }
    group ??= item.group;
    if (open) files.push(item);
  }
  flush();
  return rows;
};

/** For `FlashList` `getItemType`: rows of one kind share recycled views. */
export const changesRowType = (row: ChangesRow): string =>
  row.kind === "diff" ? diffBodyRowType(row) : row.kind;
