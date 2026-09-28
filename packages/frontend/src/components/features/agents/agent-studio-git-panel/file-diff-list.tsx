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

type MeasurementState = {
  fileDiffs: FileDiff[];
  diffScope: DiffScope;
  diffStyle: PierreDiffStyle;
  width: number;
  version: number;
};

function useFileListMeasurementVersion(
  fileDiffs: FileDiff[],
  diffScope: DiffScope,
  diffStyle: PierreDiffStyle,
  width: number,
): number {
  const [measurement, setMeasurement] = useState<MeasurementState>(() => ({
    fileDiffs,
    diffScope,
    diffStyle,
    width,
    version: 0,
  }));
  if (
    measurement.fileDiffs !== fileDiffs ||
    measurement.diffScope !== diffScope ||
    measurement.diffStyle !== diffStyle ||
    measurement.width !== width
  ) {
    const filesChanged =
      measurement.fileDiffs.length !== fileDiffs.length ||
      fileDiffs.some((diff, index) => {
        const previous = measurement.fileDiffs[index];
        return (
          previous?.file !== diff.file || previous.type !== diff.type || previous.diff !== diff.diff
        );
      });
    const needsNewMeasurements =
      filesChanged ||
      measurement.diffScope !== diffScope ||
      measurement.diffStyle !== diffStyle ||
      measurement.width !== width;
    setMeasurement({
      fileDiffs,
      diffScope,
      diffStyle,
      width,
      version: measurement.version + (needsNewMeasurements ? 1 : 0),
    });
  }
  return measurement.version;
}

type FileDiffRowProps = Omit<FileDiffListProps, "preloadLimit" | "setDiffStyle"> & {
  inlineCommentsByFile: Map<string, InlineCommentDraft[]>;
  reserveConflictSlot: boolean;
  editorStateByFile: Map<string, FileEditorState>;
  onAnnotationAction: (
    filePath: string,
    diffText: string,
    action: FileDiffAnnotationAction,
  ) => void;
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
}: RowComponentProps<FileDiffRowProps>): ReactElement {
  const diff = fileDiffs[index];
  if (!diff) {
    throw new RangeError(`Missing file diff at row ${index}`);
  }
  const editor = editorStateByFile.get(diff.file);
  return (
    <div style={style} {...ariaAttributes} className="border-b border-border/50">
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
  const [editorStateByFile, setEditorStateByFile] = useState<Map<string, FileEditorState>>(
    () => new Map(),
  );
  const onAnnotationAction = useCallback(
    (filePath: string, diffText: string, action: FileDiffAnnotationAction) => {
      setEditorStateByFile((current) => {
        const entry = current.get(filePath);
        const state = entry?.diffText === diffText ? entry.state : EMPTY_FILE_DIFF_ANNOTATION_STATE;
        const next = new Map(current);
        next.set(filePath, { diffText, state: fileDiffAnnotationReducer(state, action) });
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    setEditorStateByFile(new Map());
  }, [ownerKey, diffScope]);

  useEffect(() => {
    const currentDiffs = new Map(fileDiffs.map((diff) => [diff.file, diff.diff]));
    setEditorStateByFile((current) => {
      const next = new Map(current);
      for (const [filePath, entry] of current) {
        if (currentDiffs.get(filePath) !== entry.diffText) {
          next.delete(filePath);
        }
      }
      return next.size === current.size ? current : next;
    });
  }, [fileDiffs]);

  const listRef = useListRef(null);
  const visibleFileRef = useRef<{ filePath: string; index: number } | null>(null);
  const [listWidth, setListWidth] = useState(0);
  const measurementVersion = useFileListMeasurementVersion(
    fileDiffs,
    diffScope,
    diffStyle,
    listWidth,
  );
  const rowHeight = useDynamicRowHeight({ defaultRowHeight: 40, key: measurementVersion });
  const restoredMeasurementVersionRef = useRef(measurementVersion);

  useLayoutEffect(() => {
    if (restoredMeasurementVersionRef.current === measurementVersion) {
      return;
    }
    restoredMeasurementVersionRef.current = measurementVersion;
    const anchor = visibleFileRef.current;
    if (anchor && fileDiffs.length > 0) {
      const matchingIndex = fileDiffs.findIndex((diff) => diff.file === anchor.filePath);
      const index =
        matchingIndex >= 0 ? matchingIndex : Math.min(anchor.index, fileDiffs.length - 1);
      listRef.current?.scrollToRow({ index, align: "start" });
    }
  }, [fileDiffs, listRef, measurementVersion]);

  const onRowsRendered = useCallback(
    ({ startIndex }: { startIndex: number }) => {
      const filePath = fileDiffs[startIndex]?.file;
      if (filePath) {
        visibleFileRef.current = { filePath, index: startIndex };
      }
    },
    [fileDiffs],
  );
  const onResize = useCallback(({ width }: { width: number }) => {
    if (width > 0) {
      setListWidth(width);
    }
  }, []);
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
        onResize={onResize}
      />
    </div>
  );
});
