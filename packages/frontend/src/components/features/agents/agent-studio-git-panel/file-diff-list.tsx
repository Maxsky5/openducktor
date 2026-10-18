import type { GitFileDiff } from "@openducktor/contracts";
import {
  memo,
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { List, type RowComponentProps } from "react-window";
import type { PierreDiffStyle } from "@/components/features/agents/pierre-diff-viewer";
import type { DiffScope } from "@/features/agent-studio-git";
import { type InlineCommentDraft } from "@openducktor/frontend-core/drafts/inline-comment-draft-store";
import { useInlineCommentDraftStore } from "@openducktor/frontend-core/drafts/use-inline-comment-draft-store";
import { DiffPreloadQueue } from "./diff-preload-queue";
import { FileDiffEntryWithMemo } from "./file-diff-entry";
import { FileListDirectoryRow } from "./file-list-directory-row";
import { FileListHeader } from "./file-list-header";
import { buildFileTree, buildListRows, type FileListRow, flattenFileTree } from "./file-list-rows";
import { type FileSearchMatch, searchFiles } from "./file-list-search";
import type { FileListViewMode } from "./file-list-view-preference";
import { rowKeyAttributes, useFileListScrollAnchor } from "./use-file-list-scroll-anchor";
import { type GitFileRowActions, runningFileAction } from "./git-file-row-actions";
import type { FileListState } from "./use-file-list-state";
import {
  EMPTY_FILE_DIFF_ANNOTATION_STATE,
  type FileDiffAnnotationAction,
  type FileDiffAnnotationState,
  fileDiffAnnotationReducer,
} from "./use-file-diff-comment-annotations";

export const FileDiffList = memo(function FileDiffList({
  fileDiffs,
  diffScope,
  listKey,
  listLabel,
  ownerKey,
  commentPlaceholder,
  commentsByFile,
  conflictedFiles,
  diffStyle,
  viewMode,
  matches,
  listState,
  expandedFiles,
  onToggleFile,
  onViewFile,
  preloadLimit,
  rowActions,
  changingKey,
}: FileDiffListProps): ReactElement {
  const { query } = listState;
  const rows = useFileListRows({ matches, viewMode, listState });
  // Preload the files that the list shows, in their order. A search or a closed directory hides the others.
  const shownFileDiffs = useMemo(
    () => rows.flatMap((row) => (row.kind === "file" ? [row.diff] : [])),
    [rows],
  );
  const inlineCommentDrafts = useInlineCommentDraftStore((store) =>
    ownerKey === null || commentsByFile
      ? EMPTY_INLINE_COMMENTS
      : (store.draftsByOwner[ownerKey] ?? EMPTY_INLINE_COMMENTS),
  );
  const scopeComments = useMemo(
    () => groupInlineCommentsByFile(inlineCommentDrafts, diffScope),
    [diffScope, inlineCommentDrafts],
  );
  const inlineCommentsByFile = commentsByFile ?? scopeComments;
  const reserveConflictSlot = conflictedFiles.size > 0;
  const scopeKey = JSON.stringify([ownerKey, listKey]);
  const { editorStateByFile, onAnnotationAction } = useFileEditorStates(scopeKey, fileDiffs);

  const { listRef, rowHeight, onMeasureRow, onRowsRendered, onScroll } = useFileListScrollAnchor({
    rows,
    measurementKey: scopeKey,
    viewMode,
    // A new search, and a cleared search, start at the top.
    scrollResetKey: query,
  });
  const rowProps: FileListRowProps = {
    rows,
    viewMode,
    diffScope,
    ownerKey,
    commentPlaceholder,
    conflictedFiles,
    diffStyle,
    expandedFiles,
    onToggleFile,
    onViewFile,
    onToggleDirectory: listState.toggleDirectory,
    rowActions,
    changingKey,
    inlineCommentsByFile,
    reserveConflictSlot,
    editorStateByFile,
    onAnnotationAction,
    onMeasureRow,
    measurementKey: scopeKey,
  };

  return (
    <div className="flex h-full min-h-0 w-0 min-w-full max-w-full flex-1 flex-col overflow-hidden">
      <DiffPreloadQueue
        fileDiffs={shownFileDiffs}
        expandedFiles={expandedFiles}
        limit={preloadLimit}
      />

      {rows.length === 0 ? (
        <p
          className="px-3 py-4 text-xs break-words text-muted-foreground"
          data-testid="agent-studio-git-no-file-matches"
        >
          No files match "{listState.appliedSearchText.trim()}"
        </p>
      ) : (
        <List
          aria-label={listLabel}
          tabIndex={0}
          className="h-0 min-h-0 flex-1 overflow-x-hidden"
          defaultHeight={400}
          listRef={listRef}
          rowComponent={FileListRowView}
          rowCount={rows.length}
          rowHeight={rowHeight}
          rowKey={listRowKey}
          rowProps={rowProps}
          overscanCount={3}
          onRowsRendered={onRowsRendered}
          onScroll={onScroll}
        />
      )}
    </div>
  );
});

const EMPTY_INLINE_COMMENTS: InlineCommentDraft[] = [];

const groupInlineCommentsByFile = (
  drafts: InlineCommentDraft[],
  diffScope: DiffScope,
): Map<string, InlineCommentDraft[]> => {
  const grouped = new Map<string, InlineCommentDraft[]>();
  for (const draft of drafts) {
    if (draft.diffScope !== diffScope) {
      continue;
    }
    const existing = grouped.get(draft.filePath);
    if (existing) {
      existing.push(draft);
      continue;
    }
    grouped.set(draft.filePath, [draft]);
  }
  return grouped;
};

type FileDiffListProps = {
  fileDiffs: GitFileDiff[];
  /** The comment scope of the files. */
  diffScope: DiffScope;
  /** Identifies this list for row sizes and comment editors, for example one local group. */
  listKey: string;
  listLabel: string;
  ownerKey: string | null;
  commentPlaceholder?: string | undefined;
  /** Comments placed by the parent. Without it, the list shows every comment of the scope. */
  commentsByFile?: ReadonlyMap<string, InlineCommentDraft[]> | undefined;
  conflictedFiles: ReadonlySet<string>;
  diffStyle: PierreDiffStyle;
  viewMode: FileListViewMode;
  /** The files that the search shows. The parent searches once for its toolbar and this list. */
  matches: FileSearchMatch[];
  listState: FileListState;
  expandedFiles: ReadonlySet<string>;
  onToggleFile: (filePath: string) => void;
  onViewFile: ((filePath: string) => void) | null;
  preloadLimit: number;
  rowActions: GitFileRowActions | null;
  /** The key of the change that runs now, or null. Its row shows the change as busy. */
  changingKey: string | null;
};

type FileEditorState = { diffText: string; state: FileDiffAnnotationState };
type FileAnnotationDispatch = (
  filePath: string,
  diffText: string,
  action: FileDiffAnnotationAction,
) => void;
type FileEditorStates = {
  editorStateByFile: Map<string, FileEditorState>;
  onAnnotationAction: FileAnnotationDispatch;
};

function useFileEditorStates(scopeKey: string, fileDiffs: GitFileDiff[]): FileEditorStates {
  const [editors, setEditors] = useState(() => ({
    scopeKey,
    entries: new Map<string, FileEditorState>(),
  }));
  const editorStateByFile = useMemo(
    () => (editors.scopeKey === scopeKey ? editors.entries : new Map<string, FileEditorState>()),
    [editors, scopeKey],
  );
  const onAnnotationAction = useCallback<FileAnnotationDispatch>(
    (filePath, diffText, action) => {
      setEditors((current) => {
        const entries =
          current.scopeKey === scopeKey ? current.entries : new Map<string, FileEditorState>();
        const entry = entries.get(filePath);
        const state = entry?.diffText === diffText ? entry.state : EMPTY_FILE_DIFF_ANNOTATION_STATE;
        const next = new Map(entries);
        next.set(filePath, { diffText, state: fileDiffAnnotationReducer(state, action) });
        return { scopeKey, entries: next };
      });
    },
    [scopeKey],
  );

  useEffect(() => {
    setEditors((current) => {
      if (current.scopeKey !== scopeKey)
        return { scopeKey, entries: new Map<string, FileEditorState>() };
      if (current.entries.size === 0) return current;
      const diffs = new Map(fileDiffs.map((diff) => [diff.file, diff.diff]));
      const next = new Map(current.entries);
      for (const [filePath, entry] of current.entries) {
        if (diffs.get(filePath) !== entry.diffText) next.delete(filePath);
      }
      return next.size === current.entries.size ? current : { scopeKey, entries: next };
    });
  }, [fileDiffs, scopeKey]);

  return { editorStateByFile, onAnnotationAction };
}

type FileListRowProps = Pick<
  FileDiffListProps,
  | "viewMode"
  | "diffScope"
  | "ownerKey"
  | "commentPlaceholder"
  | "conflictedFiles"
  | "diffStyle"
  | "expandedFiles"
  | "onToggleFile"
  | "onViewFile"
  | "rowActions"
  | "changingKey"
> & {
  rows: readonly FileListRow[];
  onToggleDirectory: FileListState["toggleDirectory"];
  inlineCommentsByFile: ReadonlyMap<string, InlineCommentDraft[]>;
  reserveConflictSlot: boolean;
  editorStateByFile: Map<string, FileEditorState>;
  onAnnotationAction: FileAnnotationDispatch;
  onMeasureRow: (rowKey: string, height: number) => void;
  measurementKey: string;
};

function FileListRowView({
  index,
  style,
  ariaAttributes,
  rows,
  viewMode,
  diffScope,
  ownerKey,
  commentPlaceholder,
  conflictedFiles,
  diffStyle,
  expandedFiles,
  onToggleFile,
  onViewFile,
  onToggleDirectory,
  rowActions,
  changingKey,
  inlineCommentsByFile,
  reserveConflictSlot,
  editorStateByFile,
  onAnnotationAction,
  onMeasureRow,
  measurementKey,
}: RowComponentProps<FileListRowProps>): ReactElement {
  const rowRef = useRef<HTMLDivElement>(null);
  const lastMeasurementRef = useRef<{
    rowKey: string;
    height: number;
    measurementKey: string;
  } | null>(null);
  useLayoutEffect(() => {
    // Match the border-box height that the ResizeObserver of the scroll anchor reports.
    const rowKey = rows[index]?.key;
    const height = rowRef.current?.offsetHeight ?? 0;
    const previous = lastMeasurementRef.current;
    if (
      rowKey &&
      height > 0 &&
      (previous?.rowKey !== rowKey ||
        previous.measurementKey !== measurementKey ||
        Math.abs(previous.height - height) > 1)
    ) {
      lastMeasurementRef.current = { rowKey, height, measurementKey };
      onMeasureRow(rowKey, height);
    }
  });
  const row = rows[index];
  if (!row) {
    throw new RangeError(`Missing file list row at index ${index}`);
  }
  let content: ReactElement;
  if (row.kind === "directory") {
    content = <FileListDirectoryRow row={row} onToggle={onToggleDirectory} />;
  } else {
    const { diff } = row;
    const editor = editorStateByFile.get(diff.file);
    const isExpanded = expandedFiles.has(diff.file);
    content = (
      <FileDiffEntryWithMemo
        row={row}
        viewMode={viewMode}
        diffScope={diffScope}
        ownerKey={ownerKey}
        commentPlaceholder={commentPlaceholder}
        fileComments={inlineCommentsByFile.get(diff.file) ?? EMPTY_INLINE_COMMENTS}
        annotationState={
          editor?.diffText === diff.diff ? editor.state : EMPTY_FILE_DIFF_ANNOTATION_STATE
        }
        onAnnotationAction={onAnnotationAction}
        viewState={{
          isConflicted: conflictedFiles.has(diff.file),
          reserveConflictSlot,
          isExpanded,
        }}
        onToggle={onToggleFile}
        onViewFile={onViewFile}
        diffStyle={diffStyle}
        rowActions={rowActions}
        runningAction={
          rowActions ? runningFileAction(rowActions.group, diff.file, changingKey) : null
        }
        // Only an open diff shows chunk actions, so a closed row does not draw again.
        isChangeRunning={rowActions !== null && changingKey !== null && isExpanded}
      />
    );
  }
  return (
    <div
      ref={rowRef}
      style={style}
      {...ariaAttributes}
      {...rowKeyAttributes(row.key)}
      className="border-b border-border/50"
    >
      {content}
    </div>
  );
}

const listRowKey = (index: number, { rows }: FileListRowProps): string => {
  const row = rows[index];
  if (!row) {
    throw new RangeError(`Missing file list row at index ${index}`);
  }
  return row.key;
};

function useFileListRows({
  matches,
  viewMode,
  listState: { closedDirectories },
}: Pick<FileDiffListProps, "matches" | "viewMode" | "listState">): readonly FileListRow[] {
  const tree = useMemo(
    () => (viewMode === "tree" ? buildFileTree(matches) : null),
    [matches, viewMode],
  );
  return useMemo<readonly FileListRow[]>(
    () => (tree ? flattenFileTree(tree, closedDirectories) : buildListRows(matches)),
    [closedDirectories, matches, tree],
  );
}

/**
 * A file list with its own toolbar: search, line counts, view mode, and diff style. A grouped
 * list, such as the local changes, shows one shared toolbar and uses `FileDiffList` directly.
 */
export const FileDiffListWithHeader = memo(function FileDiffListWithHeader({
  setDiffStyle,
  onViewModeChange,
  ...props
}: Omit<FileDiffListProps, "matches"> & {
  setDiffStyle: (style: PierreDiffStyle) => void;
  onViewModeChange: (viewMode: FileListViewMode) => void;
}): ReactElement {
  const { fileDiffs, listState } = props;
  const search = useMemo(() => {
    const matches = searchFiles(fileDiffs, listState.query);
    let additions = 0;
    let deletions = 0;
    for (const { diff } of matches) {
      additions += diff.additions;
      deletions += diff.deletions;
    }
    return { matches, additions, deletions };
  }, [fileDiffs, listState.query]);
  return (
    <div className="flex h-full min-h-0 w-0 min-w-full max-w-full flex-col overflow-hidden">
      <FileListHeader
        fileCount={fileDiffs.length}
        matchCount={listState.query === "" ? null : search.matches.length}
        totalAdditions={search.additions}
        totalDeletions={search.deletions}
        viewMode={props.viewMode}
        onViewModeChange={onViewModeChange}
        diffStyle={props.diffStyle}
        onDiffStyleChange={setDiffStyle}
        searchText={listState.searchText}
        onSearchTextChange={listState.setSearchText}
      />
      <FileDiffList {...props} matches={search.matches} />
    </div>
  );
});
