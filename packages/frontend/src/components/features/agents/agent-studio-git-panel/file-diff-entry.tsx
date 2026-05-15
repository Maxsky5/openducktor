import type { FileDiff } from "@openducktor/contracts";
import type { DiffLineAnnotation, SelectedLineRange } from "@pierre/diffs";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileText,
  MessageSquare,
  Undo2,
} from "lucide-react";
import {
  memo,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from "react";
import type {
  PierreDiffSelection,
  PierreDiffStyle,
} from "@/components/features/agents/pierre-diff-viewer";
import { PierreDiffViewer } from "@/components/features/agents/pierre-diff-viewer";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DiffScope } from "@/features/agent-studio-git";
import { cn } from "@/lib/utils";
import {
  type InlineCommentDraft,
  useInlineCommentDraftStore,
} from "@/state/use-inline-comment-draft-store";
import { FILE_STATUS_COLOR, FILE_STATUS_ICON } from "./constants";
import { DiffAnnotationShell, DraftCommentCard, NewCommentForm } from "./file-diff-comments";

const areFileDiffsEqual = (left: FileDiff, right: FileDiff): boolean =>
  left.file === right.file &&
  left.type === right.type &&
  left.additions === right.additions &&
  left.deletions === right.deletions &&
  left.diff === right.diff;

const DIFF_BODY_CONTAINER_STYLE = {
  contain: "layout paint",
} as const;

type FileDiffEntryProps = {
  diff: FileDiff;
  diffScope: DiffScope;
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

type GitDiffCommentAnnotationMetadata =
  | { kind: "new-comment-form" }
  | { kind: "comment"; commentId: string };

type FileDiffAnnotationState = {
  selectedLines: SelectedLineRange | null;
  pendingSelection: PierreDiffSelection | null;
  editingCommentId: string | null;
};

type FileDiffAnnotationAction =
  | { type: "reset" }
  | { type: "selectionCleared" }
  | { type: "selectionChanged"; selection: PierreDiffSelection | null }
  | { type: "editingStarted"; commentId: string }
  | { type: "editingCanceled" };

const fileDiffAnnotationReducer = (
  state: FileDiffAnnotationState,
  action: FileDiffAnnotationAction,
): FileDiffAnnotationState => {
  switch (action.type) {
    case "reset":
      return {
        selectedLines: null,
        pendingSelection: null,
        editingCommentId: null,
      };
    case "selectionCleared":
      return { ...state, selectedLines: null, pendingSelection: null };
    case "selectionChanged":
      return {
        ...state,
        pendingSelection: action.selection,
        selectedLines: action.selection?.selectedLines ?? null,
      };
    case "editingStarted":
      return {
        selectedLines: null,
        pendingSelection: null,
        editingCommentId: action.commentId,
      };
    case "editingCanceled":
      return { ...state, editingCommentId: null };
  }
};

const mapCommentSideToAnnotationSide = (
  side: InlineCommentDraft["side"],
): "additions" | "deletions" => {
  return side === "old" ? "deletions" : "additions";
};

function FileDiffEntryHeader({
  diff,
  labels,
  resetState,
  status,
  onRequestFileReset,
  onToggle,
}: {
  diff: FileDiff;
  labels: {
    dirName: string;
    fileName: string;
  };
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
  const { dirName, fileName } = labels;
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
    <div className="flex items-center gap-1 px-3 py-1.5 hover:bg-muted/50">
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 overflow-hidden text-left text-xs"
        aria-label={`Toggle diff for ${diff.file}`}
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
        <span
          className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden"
          data-testid="agent-studio-git-file-path"
          title={diff.file}
        >
          <span className="block truncate leading-tight font-medium" title={fileName}>
            {fileName}
          </span>
          {dirName ? (
            <span
              className="block truncate text-[10px] leading-tight text-muted-foreground"
              title={dirName}
            >
              {dirName}
            </span>
          ) : null}
        </span>
        <div
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
        </div>
      </button>

      {canReset ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 shrink-0"
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

function FileDiffEntry({
  diff,
  diffScope,
  viewState,
  onToggle,
  diffStyle,
  resetState,
  resetDisabledReason,
  onRequestFileReset,
  onRequestHunkReset,
}: FileDiffEntryProps): ReactElement {
  const { isConflicted, reserveConflictSlot, isExpanded } = viewState;
  const { canReset, isResetDisabled } = resetState;
  const StatusIcon = FILE_STATUS_ICON[diff.type] ?? FileText;
  const statusColor = FILE_STATUS_COLOR[diff.type] ?? "text-muted-foreground";
  const fileCommentStateKey = useInlineCommentDraftStore(
    useCallback(
      (store) =>
        store
          .getDraftsForFile(diff.file, diffScope)
          .map((comment) => `${comment.id}:${comment.revision}:${comment.status}`)
          .join("|"),
      [diff.file, diffScope],
    ),
  );
  const addDraft = useInlineCommentDraftStore((store) => store.addDraft);
  const updateDraft = useInlineCommentDraftStore((store) => store.updateDraft);
  const removeDraft = useInlineCommentDraftStore((store) => store.removeDraft);

  const fileName = diff.file.split("/").pop() ?? diff.file;
  const dirName = diff.file.includes("/") ? diff.file.slice(0, diff.file.lastIndexOf("/")) : "";
  const hasDiffContent = diff.diff.trim().length > 0;
  const diffResetKey = `${diffScope}:${diff.diff}`;
  void fileCommentStateKey;
  const fileComments = useInlineCommentDraftStore.getState().getDraftsForFile(diff.file, diffScope);
  const fileCommentCount = fileComments.length;
  const commentsById = useMemo(
    () => new Map(fileComments.map((comment) => [comment.id, comment])),
    [fileComments],
  );

  // Keep diff subtrees mounted after first expand in production for cheap reopen,
  // but reset them in tests so assertions stay deterministic.
  const shouldPersistMountedDiffBody = process.env.NODE_ENV !== "test";
  const [hasMountedDiffBody, setHasMountedDiffBody] = useState(false);
  const [annotationState, dispatchAnnotation] = useReducer(fileDiffAnnotationReducer, {
    selectedLines: null,
    pendingSelection: null,
    editingCommentId: null,
  });
  const { selectedLines, pendingSelection, editingCommentId } = annotationState;

  useEffect(() => {
    if (isExpanded && hasDiffContent) {
      setHasMountedDiffBody(true);
      return;
    }

    if (!shouldPersistMountedDiffBody) {
      setHasMountedDiffBody(false);
    }
  }, [hasDiffContent, isExpanded, shouldPersistMountedDiffBody]);

  useEffect(() => {
    void diffResetKey;
    dispatchAnnotation({ type: "reset" });
  }, [diffResetKey]);

  useEffect(() => {
    if (editingCommentId == null) {
      return;
    }

    const editingComment = fileComments.find((comment) => comment.id === editingCommentId);
    if (editingComment?.status === "submitting") {
      dispatchAnnotation({ type: "editingCanceled" });
    }
  }, [fileComments, editingCommentId]);

  const shouldRenderPersistedDiffBody =
    hasDiffContent && shouldPersistMountedDiffBody && hasMountedDiffBody;
  const shouldRenderDiffBody = isExpanded || shouldRenderPersistedDiffBody;
  const hasOpenAnnotationForm = pendingSelection != null || editingCommentId != null;

  const clearPendingSelection = useCallback(() => {
    dispatchAnnotation({ type: "selectionCleared" });
  }, []);

  const handleLineSelectionEnd = useCallback((selection: PierreDiffSelection | null) => {
    dispatchAnnotation({ type: "selectionChanged", selection });
  }, []);

  const handleSaveNewComment = useCallback(
    (text: string) => {
      const normalizedText = text.trim();
      if (!pendingSelection || normalizedText.length === 0) {
        return;
      }

      addDraft({
        filePath: diff.file,
        diffScope,
        startLine: pendingSelection.startLine,
        endLine: pendingSelection.endLine,
        side: pendingSelection.side,
        text: normalizedText,
        codeContext: pendingSelection.codeContext,
        language: pendingSelection.language,
      });
      clearPendingSelection();
    },
    [addDraft, clearPendingSelection, diff.file, diffScope, pendingSelection],
  );

  const handleStartEditing = useCallback((comment: InlineCommentDraft) => {
    dispatchAnnotation({ type: "editingStarted", commentId: comment.id });
  }, []);

  const handleCancelEditing = useCallback(() => {
    dispatchAnnotation({ type: "editingCanceled" });
  }, []);

  const handleSaveEditing = useCallback(
    (commentId: string, text: string) => {
      const normalizedText = text.trim();
      if (normalizedText.length === 0) {
        return;
      }

      updateDraft(commentId, normalizedText);
      dispatchAnnotation({ type: "editingCanceled" });
    },
    [updateDraft],
  );
  const lineAnnotations = useMemo<DiffLineAnnotation<GitDiffCommentAnnotationMetadata>[]>(() => {
    const commentAnnotations = fileComments.map((comment) => ({
      side: mapCommentSideToAnnotationSide(comment.side),
      lineNumber: comment.endLine,
      metadata: {
        kind: "comment",
        commentId: comment.id,
      } satisfies GitDiffCommentAnnotationMetadata,
    }));

    if (pendingSelection == null) {
      return commentAnnotations;
    }

    return [
      ...commentAnnotations,
      {
        side: mapCommentSideToAnnotationSide(pendingSelection.side),
        lineNumber: pendingSelection.endLine,
        metadata: {
          kind: "new-comment-form",
        } satisfies GitDiffCommentAnnotationMetadata,
      },
    ];
  }, [fileComments, pendingSelection]);
  const renderAnnotation = useCallback(
    (annotation: DiffLineAnnotation<unknown>): ReactElement | null => {
      const metadata = annotation.metadata as GitDiffCommentAnnotationMetadata;
      if (metadata.kind === "new-comment-form") {
        if (pendingSelection == null) {
          return null;
        }

        return (
          <DiffAnnotationShell>
            <NewCommentForm onCancel={clearPendingSelection} onSave={handleSaveNewComment} />
          </DiffAnnotationShell>
        );
      }

      const comment = commentsById.get(metadata.commentId);
      if (!comment) {
        return null;
      }

      return (
        <DiffAnnotationShell>
          <DraftCommentCard
            comment={comment}
            isEditing={editingCommentId === comment.id}
            onStartEditing={handleStartEditing}
            onCancelEditing={handleCancelEditing}
            onSaveEditing={handleSaveEditing}
            onRemove={removeDraft}
          />
        </DiffAnnotationShell>
      );
    },
    [
      clearPendingSelection,
      commentsById,
      editingCommentId,
      handleCancelEditing,
      handleSaveEditing,
      handleSaveNewComment,
      handleStartEditing,
      pendingSelection,
      removeDraft,
    ],
  );

  return (
    <div className="min-w-0 max-w-full">
      <FileDiffEntryHeader
        diff={diff}
        labels={{ dirName, fileName }}
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

      {shouldRenderDiffBody ? (
        <div
          className={cn("border-t border-border/50", !isExpanded && "hidden")}
          style={DIFF_BODY_CONTAINER_STYLE}
        >
          {hasDiffContent ? (
            <div className="space-y-3 p-3">
              <PierreDiffViewer
                patch={diff.diff}
                filePath={diff.file}
                diffStyle={diffStyle}
                enableLineSelection={!hasOpenAnnotationForm}
                enableGutterUtility={!hasOpenAnnotationForm}
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
      ) : null}
    </div>
  );
}

export const FileDiffEntryWithMemo = memo(
  FileDiffEntry,
  (previous, next) =>
    previous.viewState.isExpanded === next.viewState.isExpanded &&
    previous.diffScope === next.diffScope &&
    previous.viewState.isConflicted === next.viewState.isConflicted &&
    previous.viewState.reserveConflictSlot === next.viewState.reserveConflictSlot &&
    previous.diffStyle === next.diffStyle &&
    previous.resetState.canReset === next.resetState.canReset &&
    previous.resetState.isResetDisabled === next.resetState.isResetDisabled &&
    previous.resetDisabledReason === next.resetDisabledReason &&
    previous.onRequestFileReset === next.onRequestFileReset &&
    previous.onRequestHunkReset === next.onRequestHunkReset &&
    previous.onToggle === next.onToggle &&
    areFileDiffsEqual(previous.diff, next.diff),
);
