import type { DiffScope } from "@openducktor/frontend-core/git/contracts";
import { type ChangedFileGroup, changedFileKey, type CollapsibleGroup } from "./changes-model";

/** The desktop file list views: a directory tree, or one row for each file with its directory. */
export type FileListViewMode = "tree" | "list";

/**
 * The choices of a Changes view: the diff scope, the expanded file diffs, the closed groups and
 * directories, and the list view. The expanded files stay when the scope changes, as on desktop.
 */
export type ChangesViewState = {
  scope: DiffScope;
  viewMode: FileListViewMode;
  /** The keys of the files whose diff shows under their row. See `changedFileKey`. */
  expandedFiles: ReadonlySet<string>;
  collapsedGroups: ReadonlySet<CollapsibleGroup>;
  /** The keys of the closed tree directories. See `directoryKey`. */
  closedDirectories: ReadonlySet<string>;
};

export type ChangesViewAction =
  | { type: "scope_selected"; scope: DiffScope }
  | { type: "view_mode_selected"; viewMode: FileListViewMode }
  | { type: "file_toggled"; fileKey: string }
  | { type: "group_toggled"; group: CollapsibleGroup }
  | { type: "directory_toggled"; directoryKey: string };

/** A changed file that a Changes view opens on, such as the file of a pending comment. */
export type ChangesFocus = { scope: DiffScope; path: string };

/** The groups of a scope that can list a file. A partly staged file shows in two of them. */
const SCOPE_GROUPS = {
  uncommitted: ["conflicted", "unstaged", "staged"],
  target: ["target"],
} as const satisfies Record<DiffScope, readonly ChangedFileGroup[]>;

/** The focus that route params name, or null when they name no scope and file. */
export const readChangesFocus = (
  scope: string | undefined,
  path: string | undefined,
): ChangesFocus | null =>
  (scope === "uncommitted" || scope === "target") && path ? { scope, path } : null;

/**
 * Desktop opens the file list as a tree. A focus opens its scope with the diff of its file shown,
 * in each group that lists the file.
 */
export const createChangesViewState = (
  viewMode: FileListViewMode = "tree",
  focus: ChangesFocus | null = null,
): ChangesViewState => ({
  scope: focus?.scope ?? "uncommitted",
  viewMode,
  expandedFiles: new Set(
    focus ? SCOPE_GROUPS[focus.scope].map((group) => changedFileKey(group, focus.path)) : [],
  ),
  collapsedGroups: new Set(),
  closedDirectories: new Set(),
});

const toggled = <Value>(values: ReadonlySet<Value>, value: Value): ReadonlySet<Value> => {
  const next = new Set(values);
  if (!next.delete(value)) next.add(value);
  return next;
};

export const changesViewReducer = (
  state: ChangesViewState,
  action: ChangesViewAction,
): ChangesViewState => {
  switch (action.type) {
    case "scope_selected":
      return action.scope === state.scope ? state : { ...state, scope: action.scope };
    case "view_mode_selected":
      return action.viewMode === state.viewMode ? state : { ...state, viewMode: action.viewMode };
    case "file_toggled":
      return { ...state, expandedFiles: toggled(state.expandedFiles, action.fileKey) };
    case "group_toggled":
      return { ...state, collapsedGroups: toggled(state.collapsedGroups, action.group) };
    case "directory_toggled":
      return { ...state, closedDirectories: toggled(state.closedDirectories, action.directoryKey) };
  }
};
