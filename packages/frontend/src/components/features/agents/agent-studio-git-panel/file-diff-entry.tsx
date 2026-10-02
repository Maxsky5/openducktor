import type { FileDiff } from "@openducktor/contracts";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileText,
  MessageSquare,
  Undo2,
} from "lucide-react";
import { memo, type ReactElement, type RefCallback, useCallback, useState } from "react";
import type { PierreDiffStyle } from "@/components/features/agents/pierre-diff-viewer";
import { PierreDiffViewer } from "@/components/features/agents/pierre-diff-viewer";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DiffScope } from "@/features/agent-studio-git";
import { arraysEqual } from "@/lib/arrays-equal";
import { cn } from "@/lib/utils";
import type { InlineCommentDraft } from "@/state/use-inline-comment-draft-store";
import {
  FILE_LIST_ROW_CLASS_NAME,
  FILE_STATUS_COLOR,
  FILE_STATUS_ICON,
  fileListRowIndentStyle,
} from "./constants";
import type { FileRow, RowLabel } from "./file-list-rows";
import type { HighlightRange } from "./file-list-search";
import { HighlightedText } from "./highlighted-text";
import {
  type FileDiffAnnotationAction,
  type FileDiffAnnotationState,
  useFileDiffCommentAnnotations,
} from "./use-file-diff-comment-annotations";

const areFileDiffsEqual = (left: FileDiff, right: FileDiff): boolean =>
  left.file === right.file &&
  left.type === right.type &&
  left.additions === right.additions &&
  left.deletions === right.deletions &&
  left.diff === right.diff;

const areRangesEqual = (left: HighlightRange, right: HighlightRange): boolean =>
  left.start === right.start && left.end === right.end;

const areLabelsEqual = (left: RowLabel | null, right: RowLabel | null): boolean =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.text === right.text &&
    arraysEqual(left.highlights, right.highlights, areRangesEqual));

const areFileRowsEqual = (left: FileRow, right: FileRow): boolean =>
  left === right ||
  (left.depth === right.depth &&
    areLabelsEqual(left.name, right.name) &&
    areLabelsEqual(left.directory, right.directory) &&
    areFileDiffsEqual(left.diff, right.diff));

const DIFF_BODY_CONTAINER_STYLE = {
  contain: "layout paint",
} as const;

type FileDiffEntryProps = {
  row: FileRow;
  diffScope: DiffScope;
  ownerKey: string | null;
  fileComments: InlineCommentDraft[];
  annotationState: FileDiffAnnotationState;
  onAnnotationAction: (
    filePath: string,
    diffText: string,
    action: FileDiffAnnotationAction,
  ) => void;
  viewState: {
    isConflicted: boolean;
    reserveConflictSlot: boolean;
    isExpanded: boolean;
  };
  onToggle: (filePath: string) => void;
  diffStyle: PierreDiffStyle;
  resetState: {
    canReset: boolean;
    isResetDisabled: boolean;
  };
  resetDisabledReason: string | null;
  onRequestFileReset?: ((filePath: string) => void) | undefined;
  onRequestHunkReset?: ((filePath: string, hunkIndex: number) => void) | undefined;
};

function FileDiffEntryLabel({ row }: { row: FileRow }): ReactElement {
  const { diff, name, directory } = row;
  // Without a directory line, the hover shows the full path from the outer title.
  return (
    <span
      className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden"
      data-testid="agent-studio-git-file-path"
      title={diff.file}
    >
      <span
        className="block truncate leading-tight font-medium"
        title={directory ? name.text : undefined}
      >
        <HighlightedText label={name} />
      </span>
      {directory ? (
        <span
          className="block truncate text-[10px] leading-tight text-muted-foreground"
          title={directory.text}
        >
          <HighlightedText label={directory} />
        </span>
      ) : null}
    </span>
  );
}

function FileDiffEntryHeader({
  row,
  resetState,
  status,
  onRequestFileReset,
  onToggle,
}: {
  row: FileRow;
  resetState: {
    canReset: boolean;
    isResetDisabled: boolean;
    resetDisabledReason: string | null;
  };
  status: {
    StatusIcon: typeof FileText;
    isConflicted: boolean;
    isExpanded: boolean;
    reserveConflictSlot: boolean;
    statusColor: string;
    fileCommentCount: number;
  };
  onRequestFileReset?: ((filePath: string) => void) | undefined;
  onToggle: (filePath: string) => void;
}): ReactElement {
  const { diff } = row;
  const { canReset, isResetDisabled, resetDisabledReason } = resetState;
  const {
    StatusIcon,
    fileCommentCount,
    isConflicted,
    isExpanded,
    reserveConflictSlot,
    statusColor,
  } = status;

  return (
    <div className="relative hover:bg-muted/50">
      <button
        type="button"
        className={cn(FILE_LIST_ROW_CLASS_NAME, "overflow-hidden", canReset && "pr-12")}
        style={fileListRowIndentStyle(row.depth)}
        aria-label={`Toggle diff for ${diff.file}`}
        aria-expanded={isExpanded}
        data-testid="agent-studio-git-file-toggle-button"
        onClick={() => onToggle(diff.file)}
      >
        {isExpanded ? (
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
        )}
        <StatusIcon className={cn("size-3.5 shrink-0", statusColor)} />
        {isConflicted ? (
          <AlertTriangle
            className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
            data-testid="agent-studio-git-file-conflict-indicator"
          />
        ) : reserveConflictSlot ? (
          <span
            className="inline-flex size-3.5 shrink-0 items-center justify-center"
            data-testid="agent-studio-git-file-conflict-slot"
          />
        ) : null}
        <FileDiffEntryLabel row={row} />
        <span
          className="ml-2 flex min-w-[4.75rem] shrink-0 items-center justify-end gap-2"
          data-testid="agent-studio-git-file-stats"
        >
          {fileCommentCount > 0 ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-foreground"
              data-testid="agent-studio-git-file-comment-count"
            >
              <MessageSquare className="size-3" />
              <span>{fileCommentCount}</span>
            </span>
          ) : null}
          <span className="flex min-w-[4.75rem] shrink-0 items-center justify-end gap-1 font-mono text-[10px] whitespace-nowrap tabular-nums">
            {diff.additions > 0 ? <span className="text-green-400">+{diff.additions}</span> : null}
            {diff.deletions > 0 ? <span className="text-red-400">-{diff.deletions}</span> : null}
          </span>
        </span>
      </button>

      {canReset ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-1/2 right-3 z-10 size-6 -translate-y-1/2 disabled:pointer-events-auto"
              aria-label="Reset file"
              title="Reset file"
              data-testid="agent-studio-git-reset-file-button"
              disabled={isResetDisabled}
              onClick={(event) => {
                event.stopPropagation();
                onRequestFileReset?.(diff.file);
              }}
            >
              <Undo2 className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            <p>{resetDisabledReason ?? "Reset file"}</p>
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

function FileDiffEntryBody({
  diff,
  diffScope,
  ownerKey,
  fileComments,
  annotationState,
  dispatchAnnotation,
  diffStyle,
  shouldRender,
  isExpanded,
  canReset,
  isResetDisabled,
  bodyRef,
  onRequestHunkReset,
}: {
  diff: FileDiff;
  diffScope: DiffScope;
  ownerKey: string | null;
  fileComments: InlineCommentDraft[];
  annotationState: FileDiffAnnotationState;
  dispatchAnnotation: (action: FileDiffAnnotationAction) => void;
  diffStyle: PierreDiffStyle;
  shouldRender: boolean;
  isExpanded: boolean;
  canReset: boolean;
  isResetDisabled: boolean;
  bodyRef: RefCallback<HTMLDivElement>;
  onRequestHunkReset?: ((filePath: string, hunkIndex: number) => void) | undefined;
}): ReactElement | null {
  const {
    selectedLines,
    hasOpenAnnotationForm,
    handleLineSelectionEnd,
    lineAnnotations,
    renderAnnotation,
  } = useFileDiffCommentAnnotations({
    ownerKey,
    diff,
    diffScope,
    fileComments,
    annotationState,
    dispatchAnnotation,
  });

  if (!shouldRender) {
    return null;
  }

  const hasDiffContent = diff.diff.trim().length > 0;
  return (
    <div
      ref={bodyRef}
      className={cn("border-t border-border/50", !isExpanded && "hidden")}
      style={DIFF_BODY_CONTAINER_STYLE}
    >
      {hasDiffContent ? (
        <div className="space-y-3 p-3">
          <PierreDiffViewer
            patch={diff.diff}
            filePath={diff.file}
            diffStyle={diffStyle}
            enableLineSelection={ownerKey !== null && !hasOpenAnnotationForm}
            enableGutterUtility={ownerKey !== null && !hasOpenAnnotationForm}
            selectedLines={selectedLines}
            onLineSelectionEnd={handleLineSelectionEnd}
            lineAnnotations={lineAnnotations}
            renderAnnotation={renderAnnotation}
            enableHunkReset={canReset && onRequestHunkReset != null}
            isHunkResetDisabled={isResetDisabled}
            onResetHunk={
              onRequestHunkReset
                ? (hunkIndex) => {
                    onRequestHunkReset(diff.file, hunkIndex);
                  }
                : undefined
            }
          />
        </div>
      ) : (
        <div className="p-3 text-xs italic text-muted-foreground">
          No diff content available for {diff.file}
        </div>
      )}
    </div>
  );
}

function FileDiffEntry({
  row,
  diffScope,
  ownerKey,
  fileComments,
  annotationState,
  onAnnotationAction,
  viewState,
  onToggle,
  diffStyle,
  resetState,
  resetDisabledReason,
  onRequestFileReset,
  onRequestHunkReset,
}: FileDiffEntryProps): ReactElement {
  const { diff } = row;
  const { isConflicted, reserveConflictSlot, isExpanded } = viewState;
  const { canReset, isResetDisabled } = resetState;
  const StatusIcon = FILE_STATUS_ICON.get(diff.type) ?? FileText;
  const statusColor = FILE_STATUS_COLOR.get(diff.type) ?? "text-muted-foreground";
  const hasDiffContent = diff.diff.trim().length > 0;
  const fileCommentCount = fileComments.length;

  const [hasMountedDiffBody, setHasMountedDiffBody] = useState(false);
  const bodyRef = useCallback(
    (element: HTMLDivElement | null): void => {
      if (element && hasDiffContent) {
        setHasMountedDiffBody(true);
      }
    },
    [hasDiffContent],
  );
  const shouldRenderPersistedDiffBody = hasDiffContent && hasMountedDiffBody;
  const shouldRenderDiffBody = isExpanded || shouldRenderPersistedDiffBody;
  const dispatchAnnotation = useCallback(
    (action: FileDiffAnnotationAction) => onAnnotationAction(diff.file, diff.diff, action),
    [diff.file, diff.diff, onAnnotationAction],
  );

  return (
    <div className="min-w-0 max-w-full">
      <FileDiffEntryHeader
        row={row}
        resetState={{ canReset, isResetDisabled, resetDisabledReason }}
        status={{
          StatusIcon,
          fileCommentCount,
          isConflicted,
          isExpanded,
          reserveConflictSlot,
          statusColor,
        }}
        onRequestFileReset={onRequestFileReset}
        onToggle={onToggle}
      />
      <FileDiffEntryBody
        diff={diff}
        diffScope={diffScope}
        ownerKey={ownerKey}
        fileComments={fileComments}
        annotationState={annotationState}
        dispatchAnnotation={dispatchAnnotation}
        diffStyle={diffStyle}
        shouldRender={shouldRenderDiffBody}
        isExpanded={isExpanded}
        canReset={canReset}
        isResetDisabled={isResetDisabled}
        bodyRef={bodyRef}
        onRequestHunkReset={onRequestHunkReset}
      />
    </div>
  );
}

export const FileDiffEntryWithMemo = memo(
  FileDiffEntry,
  (previous, next) =>
    previous.viewState.isExpanded === next.viewState.isExpanded &&
    previous.diffScope === next.diffScope &&
    previous.ownerKey === next.ownerKey &&
    previous.viewState.isConflicted === next.viewState.isConflicted &&
    previous.viewState.reserveConflictSlot === next.viewState.reserveConflictSlot &&
    previous.diffStyle === next.diffStyle &&
    previous.resetState.canReset === next.resetState.canReset &&
    previous.resetState.isResetDisabled === next.resetState.isResetDisabled &&
    previous.resetDisabledReason === next.resetDisabledReason &&
    previous.onRequestFileReset === next.onRequestFileReset &&
    previous.onRequestHunkReset === next.onRequestHunkReset &&
    previous.onToggle === next.onToggle &&
    previous.fileComments === next.fileComments &&
    previous.annotationState === next.annotationState &&
    previous.onAnnotationAction === next.onAnnotationAction &&
    areFileRowsEqual(previous.row, next.row),
);
