import type { FileDiff } from "@openducktor/contracts";
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
import {
  type InlineCommentDraft,
  useInlineCommentDraftStore,
} from "@/state/use-inline-comment-draft-store";
import { DiffPreloadQueue } from "./diff-preload-queue";
import { FileDiffEntryWithMemo } from "./file-diff-entry";
import { FileListDirectoryRow } from "./file-list-directory-row";
import { FileListHeader } from "./file-list-header";
import { buildFileTree, buildListRows, type FileListRow, flattenFileTree } from "./file-list-rows";
import { searchFiles } from "./file-list-search";
import type { FileListViewMode } from "./file-list-view-preference";
import { rowKeyAttributes, useFileListScrollAnchor } from "./use-file-list-scroll-anchor";
import type { FileListState } from "./use-file-list-state";
import {
  EMPTY_FILE_DIFF_ANNOTATION_STATE,
  type FileDiffAnnotationAction,
  type FileDiffAnnotationState,
  fileDiffAnnotationReducer,
} from "./use-file-diff-comment-annotations";

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
  fileDiffs: FileDiff[];
  diffScope: DiffScope;
  ownerKey: string | null;
  conflictedFiles: ReadonlySet<string>;
  diffStyle: PierreDiffStyle;
  setDiffStyle: (style: PierreDiffStyle) => void;
  viewMode: FileListViewMode;
  onViewModeChange: (viewMode: FileListViewMode) => void;
  listState: FileListState;
  expandedFiles: ReadonlySet<string>;
  onToggleFile: (filePath: string) => void;
  preloadLimit: number;
  canResetFiles: boolean;
  isResetDisabled: boolean;
  resetDisabledReason: string | null;
  onRequestFileReset?: ((filePath: string) => void) | undefined;
  onRequestHunkReset?: ((filePath: string, hunkIndex: number) => void) | undefined;
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

function useFileEditorStates(
  ownerKey: string | null,
  diffScope: DiffScope,
  fileDiffs: FileDiff[],
): FileEditorStates {
  const [editorStateByFile, setEditorStateByFile] = useState<Map<string, FileEditorState>>(
    () => new Map(),
  );
  const onAnnotationAction = useCallback<FileAnnotationDispatch>((filePath, diffText, action) => {
    setEditorStateByFile((current) => {
      const entry = current.get(filePath);
      const state = entry?.diffText === diffText ? entry.state : EMPTY_FILE_DIFF_ANNOTATION_STATE;
      const next = new Map(current);
      next.set(filePath, { diffText, state: fileDiffAnnotationReducer(state, action) });
      return next;
    });
  }, []);

  useEffect(() => {
    setEditorStateByFile((current) => (current.size === 0 ? current : new Map()));
  }, [ownerKey, diffScope]);

  useEffect(() => {
    setEditorStateByFile((current) => {
      if (current.size === 0) {
        return current;
      }
      const currentDiffs = new Map(fileDiffs.map((diff) => [diff.file, diff.diff]));
      const next = new Map(current);
      for (const [filePath, entry] of current) {
        if (currentDiffs.get(filePath) !== entry.diffText) {
          next.delete(filePath);
        }
      }
      return next.size === current.size ? current : next;
    });
  }, [fileDiffs]);

  return { editorStateByFile, onAnnotationAction };
}

type FileListRowProps = Pick<
  FileDiffListProps,
  | "diffScope"
  | "ownerKey"
  | "conflictedFiles"
  | "diffStyle"
  | "expandedFiles"
  | "onToggleFile"
  | "canResetFiles"
  | "isResetDisabled"
  | "resetDisabledReason"
  | "onRequestFileReset"
  | "onRequestHunkReset"
> & {
  rows: readonly FileListRow[];
  onToggleDirectory: FileListState["toggleDirectory"];
  inlineCommentsByFile: Map<string, InlineCommentDraft[]>;
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
  diffScope,
  ownerKey,
  conflictedFiles,
  diffStyle,
  expandedFiles,
  onToggleFile,
  onToggleDirectory,
  canResetFiles,
  isResetDisabled,
  resetDisabledReason,
  onRequestFileReset,
  onRequestHunkReset,
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
    content = (
      <FileDiffEntryWithMemo
        row={row}
        diffScope={diffScope}
        ownerKey={ownerKey}
        fileComments={inlineCommentsByFile.get(diff.file) ?? EMPTY_INLINE_COMMENTS}
        annotationState={
          editor?.diffText === diff.diff ? editor.state : EMPTY_FILE_DIFF_ANNOTATION_STATE
        }
        onAnnotationAction={onAnnotationAction}
        viewState={{
          isConflicted: conflictedFiles.has(diff.file),
          reserveConflictSlot,
          isExpanded: expandedFiles.has(diff.file),
        }}
        onToggle={onToggleFile}
        diffStyle={diffStyle}
        resetState={{ canReset: canResetFiles, isResetDisabled }}
        resetDisabledReason={resetDisabledReason}
        onRequestFileReset={onRequestFileReset}
        onRequestHunkReset={onRequestHunkReset}
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
  fileDiffs,
  viewMode,
  listState: { query, closedDirectories },
}: Pick<FileDiffListProps, "fileDiffs" | "viewMode" | "listState">) {
  const matches = useMemo(() => searchFiles(fileDiffs, query), [fileDiffs, query]);
  const tree = useMemo(
    () => (viewMode === "tree" ? buildFileTree(matches) : null),
    [matches, viewMode],
  );
  const rows = useMemo<readonly FileListRow[]>(
    () => (tree ? flattenFileTree(tree, closedDirectories) : buildListRows(matches)),
    [closedDirectories, matches, tree],
  );
  const totals = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const { diff } of matches) {
      additions += diff.additions;
      deletions += diff.deletions;
    }
    return { additions, deletions };
  }, [matches]);
  return { matches, rows, totals };
}

export const FileDiffList = memo(function FileDiffList({
  fileDiffs,
  diffScope,
  ownerKey,
  conflictedFiles,
  diffStyle,
  setDiffStyle,
  viewMode,
  onViewModeChange,
  listState,
  expandedFiles,
  onToggleFile,
  preloadLimit,
  canResetFiles,
  isResetDisabled,
  resetDisabledReason,
  onRequestFileReset,
  onRequestHunkReset,
}: FileDiffListProps): ReactElement {
  const { query } = listState;
  const { matches, rows, totals } = useFileListRows({ fileDiffs, viewMode, listState });
  // Preload the files that the list shows, in their order. A search or a closed directory hides the others.
  const shownFileDiffs = useMemo(
    () => rows.flatMap((row) => (row.kind === "file" ? [row.diff] : [])),
    [rows],
  );
  const inlineCommentDrafts = useInlineCommentDraftStore((store) =>
    ownerKey === null
      ? EMPTY_INLINE_COMMENTS
      : (store.draftsByOwner[ownerKey] ?? EMPTY_INLINE_COMMENTS),
  );
  const inlineCommentsByFile = useMemo(
    () => groupInlineCommentsByFile(inlineCommentDrafts, diffScope),
    [diffScope, inlineCommentDrafts],
  );
  const reserveConflictSlot = conflictedFiles.size > 0;
  const { editorStateByFile, onAnnotationAction } = useFileEditorStates(
    ownerKey,
    diffScope,
    fileDiffs,
  );

  const measurementKey = JSON.stringify([ownerKey, diffScope]);
  const { listRef, rowHeight, onMeasureRow, onRowsRendered, onScroll } = useFileListScrollAnchor({
    rows,
    measurementKey,
    // A new search, and a cleared search, start at the top.
    scrollResetKey: query,
  });
  const rowProps: FileListRowProps = {
    rows,
    diffScope,
    ownerKey,
    conflictedFiles,
    diffStyle,
    expandedFiles,
    onToggleFile,
    onToggleDirectory: listState.toggleDirectory,
    canResetFiles,
    isResetDisabled,
    resetDisabledReason,
    onRequestFileReset,
    onRequestHunkReset,
    inlineCommentsByFile,
    reserveConflictSlot,
    editorStateByFile,
    onAnnotationAction,
    onMeasureRow,
    measurementKey,
  };

  return (
    <div className="flex h-full min-h-0 w-0 min-w-full max-w-full flex-col overflow-hidden">
      <FileListHeader
        fileCount={fileDiffs.length}
        matchCount={query === "" ? null : matches.length}
        totalAdditions={totals.additions}
        totalDeletions={totals.deletions}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        diffStyle={diffStyle}
        onDiffStyleChange={setDiffStyle}
        searchText={listState.searchText}
        onSearchTextChange={listState.setSearchText}
      />

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
          aria-label="Changed files"
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
