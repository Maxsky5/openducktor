import type { FileDiff } from "@openducktor/contracts";
import { AlignJustify, SplitSquareHorizontal } from "lucide-react";
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
import { List, type RowComponentProps, useDynamicRowHeight, useListRef } from "react-window";
import type { PierreDiffStyle } from "@/components/features/agents/pierre-diff-viewer";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DiffScope } from "@/features/agent-studio-git";
import { cn } from "@/lib/utils";
import {
  type InlineCommentDraft,
  useInlineCommentDraftStore,
} from "@/state/use-inline-comment-draft-store";
import { DiffPreloadQueue } from "./diff-preload-queue";
import { FileDiffEntryWithMemo } from "./file-diff-entry";
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
  expandedFiles: ReadonlySet<string>;
  onToggleFile: (filePath: string) => void;
  preloadLimit: number;
  canResetFiles: boolean;
  isResetDisabled: boolean;
  resetDisabledReason: string | null;
  onRequestFileReset?: ((filePath: string) => void) | undefined;
  onRequestHunkReset?: ((filePath: string, hunkIndex: number) => void) | undefined;
};

type DiffStyleToggleButtonProps = {
  icon: typeof SplitSquareHorizontal;
  isActive: boolean;
  label: string;
  onClick: () => void;
};

function DiffStyleToggleButton({
  icon: Icon,
  isActive,
  label,
  onClick,
}: DiffStyleToggleButtonProps): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-pressed={isActive}
          className={cn(
            "p-1",
            isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
          onClick={onClick}
        >
          <Icon className="size-3" />
          <span className="sr-only">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

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

type FileOrderState = {
  fileDiffs: FileDiff[];
  version: number;
};

type VisibleFileAnchor = { filePath: string; index: number; offset: number };

function getRenderedFileRow(list: HTMLElement, index: number): HTMLElement | undefined {
  for (const child of list.children) {
    if (child instanceof HTMLElement && child.getAttribute("aria-posinset") === String(index + 1)) {
      return child;
    }
  }
  return undefined;
}

function useFileOrderVersion(fileDiffs: FileDiff[]): number {
  const [fileOrder, setFileOrder] = useState<FileOrderState>(() => ({
    fileDiffs,
    version: 0,
  }));
  if (fileOrder.fileDiffs !== fileDiffs) {
    const filesChanged =
      fileOrder.fileDiffs.length !== fileDiffs.length ||
      fileDiffs.some((diff, index) => fileOrder.fileDiffs[index]?.file !== diff.file);
    setFileOrder({
      fileDiffs,
      version: fileOrder.version + (filesChanged ? 1 : 0),
    });
  }
  return fileOrder.version;
}

type FileDiffRowProps = Omit<FileDiffListProps, "preloadLimit" | "setDiffStyle"> & {
  inlineCommentsByFile: Map<string, InlineCommentDraft[]>;
  reserveConflictSlot: boolean;
  editorStateByFile: Map<string, FileEditorState>;
  onAnnotationAction: FileAnnotationDispatch;
  onMeasureRow: (index: number, height: number) => void;
};

function FileDiffRow({
  index,
  style,
  ariaAttributes,
  fileDiffs,
  diffScope,
  ownerKey,
  conflictedFiles,
  diffStyle,
  expandedFiles,
  onToggleFile,
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
}: RowComponentProps<FileDiffRowProps>): ReactElement {
  const rowRef = useRef<HTMLDivElement>(null);
  const lastMeasurementRef = useRef<{ index: number; height: number } | null>(null);
  useLayoutEffect(() => {
    // Match the border-box height that react-window receives from ResizeObserver.
    const height = rowRef.current?.offsetHeight ?? 0;
    const previous = lastMeasurementRef.current;
    if (height > 0 && (previous?.index !== index || Math.abs(previous.height - height) > 1)) {
      lastMeasurementRef.current = { index, height };
      onMeasureRow(index, height);
    }
  });
  const diff = fileDiffs[index];
  if (!diff) {
    throw new RangeError(`Missing file diff at row ${index}`);
  }
  const editor = editorStateByFile.get(diff.file);
  return (
    <div ref={rowRef} style={style} {...ariaAttributes} className="border-b border-border/50">
      <FileDiffEntryWithMemo
        diff={diff}
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
    </div>
  );
}

const fileRowKey = (index: number, { fileDiffs }: FileDiffRowProps): string => {
  const diff = fileDiffs[index];
  if (!diff) {
    throw new RangeError(`Missing file diff at row ${index}`);
  }
  return diff.file;
};

export const FileDiffList = memo(function FileDiffList({
  fileDiffs,
  diffScope,
  ownerKey,
  conflictedFiles,
  diffStyle,
  setDiffStyle,
  expandedFiles,
  onToggleFile,
  preloadLimit,
  canResetFiles,
  isResetDisabled,
  resetDisabledReason,
  onRequestFileReset,
  onRequestHunkReset,
}: FileDiffListProps): ReactElement {
  const { totalAdditions, totalDeletions } = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const fileDiff of fileDiffs) {
      additions += fileDiff.additions;
      deletions += fileDiff.deletions;
    }
    return { totalAdditions: additions, totalDeletions: deletions };
  }, [fileDiffs]);
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

  const listRef = useListRef(null);
  const visibleFileRef = useRef<VisibleFileAnchor | null>(null);
  const pendingAnchorRef = useRef<VisibleFileAnchor | null>(null);
  const fileOrderVersion = useFileOrderVersion(fileDiffs);
  // Keep measured heights through width and content changes; visible rows remeasure before paint.
  const rowHeight = useDynamicRowHeight({ defaultRowHeight: 40 });
  const restoredFileOrderVersionRef = useRef(fileOrderVersion);

  const captureVisibleOffset = useCallback(() => {
    const list = listRef.current?.element;
    const anchor = visibleFileRef.current;
    if (!list || !anchor) return;
    const row = getRenderedFileRow(list, anchor.index);
    if (!row) return;
    anchor.offset = Math.max(0, list.getBoundingClientRect().top - row.getBoundingClientRect().top);
  }, [listRef]);

  useLayoutEffect(() => {
    if (restoredFileOrderVersionRef.current !== fileOrderVersion) {
      restoredFileOrderVersionRef.current = fileOrderVersion;
      pendingAnchorRef.current = visibleFileRef.current && { ...visibleFileRef.current };
    }
    const anchor = pendingAnchorRef.current;
    const list = listRef.current?.element;
    if (!anchor || !list) return;
    if (fileDiffs.length === 0) {
      pendingAnchorRef.current = null;
      return;
    }

    const matchingIndex = fileDiffs.findIndex((diff) => diff.file === anchor.filePath);
    const index = matchingIndex >= 0 ? matchingIndex : Math.min(anchor.index, fileDiffs.length - 1);
    const row = getRenderedFileRow(list, index);
    if (!row) {
      let rowStart = 0;
      for (let rowIndex = 0; rowIndex < index; rowIndex++) {
        rowStart += rowHeight.getRowHeight(rowIndex) ?? 40;
      }
      list.scrollTop = rowStart;
      return;
    }

    const listTop = list.getBoundingClientRect().top;
    const rowRect = row.getBoundingClientRect();
    if (rowRect.height === 0) return;
    if (Math.abs((rowHeight.getRowHeight(index) ?? 40) - rowRect.height) > 1) {
      rowHeight.setRowHeight(index, rowRect.height);
      return;
    }

    const rowStart = list.scrollTop + rowRect.top - listTop;
    const offset =
      matchingIndex >= 0 ? Math.min(anchor.offset, Math.max(0, rowRect.height - 1)) : 0;
    list.scrollTop = rowStart + offset;
    pendingAnchorRef.current = null;
  }, [fileDiffs, fileOrderVersion, listRef, rowHeight]);

  const onRowsRendered = useCallback(
    ({ startIndex }: { startIndex: number }) => {
      const filePath = fileDiffs[startIndex]?.file;
      if (filePath) {
        visibleFileRef.current = { filePath, index: startIndex, offset: 0 };
        captureVisibleOffset();
      }
    },
    [captureVisibleOffset, fileDiffs],
  );
  const rowProps: FileDiffRowProps = {
    fileDiffs,
    diffScope,
    ownerKey,
    conflictedFiles,
    diffStyle,
    expandedFiles,
    onToggleFile,
    canResetFiles,
    isResetDisabled,
    resetDisabledReason,
    onRequestFileReset,
    onRequestHunkReset,
    inlineCommentsByFile,
    reserveConflictSlot,
    editorStateByFile,
    onAnnotationAction,
    onMeasureRow: rowHeight.setRowHeight,
  };

  return (
    <div className="flex h-full min-h-0 w-0 min-w-full max-w-full flex-col overflow-hidden">
      <div
        className="flex min-w-0 shrink-0 flex-wrap items-center gap-x-2 gap-y-2 border-b border-border/50 px-3 py-2 text-xs text-muted-foreground"
        data-testid="agent-studio-git-list-header"
      >
        <span className="shrink-0">
          {fileDiffs.length} changed file{fileDiffs.length > 1 ? "s" : ""}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <div className="flex shrink-0 items-center overflow-hidden rounded-md border border-border/50">
            <DiffStyleToggleButton
              icon={SplitSquareHorizontal}
              isActive={diffStyle === "split"}
              label="Side-by-side"
              onClick={() => setDiffStyle("split")}
            />
            <DiffStyleToggleButton
              icon={AlignJustify}
              isActive={diffStyle === "unified"}
              label="Unified"
              onClick={() => setDiffStyle("unified")}
            />
          </div>
          <span className="shrink-0 whitespace-nowrap font-mono">
            {totalAdditions > 0 ? (
              <span className="mr-1.5 text-green-400">+{totalAdditions}</span>
            ) : null}
            {totalDeletions > 0 ? <span className="text-red-400">-{totalDeletions}</span> : null}
          </span>
        </div>
      </div>

      <DiffPreloadQueue fileDiffs={fileDiffs} expandedFiles={expandedFiles} limit={preloadLimit} />

      <List
        aria-label="Changed files"
        tabIndex={0}
        className="h-0 min-h-0 flex-1 overflow-x-hidden"
        defaultHeight={400}
        listRef={listRef}
        rowComponent={FileDiffRow}
        rowCount={fileDiffs.length}
        rowHeight={rowHeight}
        rowKey={fileRowKey}
        rowProps={rowProps}
        overscanCount={3}
        onRowsRendered={onRowsRendered}
        onScroll={captureVisibleOffset}
      />
    </div>
  );
});
