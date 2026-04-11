import type { FileDiff } from "@openducktor/contracts";
import type { SelectedLineRange } from "@pierre/diffs";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  MessageSquare,
  Pencil,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { memo, type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import type {
  PierreDiffSelection,
  PierreDiffStyle,
} from "@/components/features/agents/pierre-diff-viewer";
import { PierreDiffViewer } from "@/components/features/agents/pierre-diff-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DiffScope } from "@/features/agent-studio-git";
import { cn } from "@/lib/utils";
import {
  type InlineCommentDraft,
  useInlineCommentDraftStore,
} from "@/state/use-inline-comment-draft-store";
import { DIFF_SCOPE_OPTIONS, FILE_STATUS_COLOR, FILE_STATUS_ICON } from "./constants";

const areFileDiffsEqual = (left: FileDiff, right: FileDiff): boolean =>
  left.file === right.file &&
  left.type === right.type &&
  left.additions === right.additions &&
  left.deletions === right.deletions &&
  left.diff === right.diff;

const DIFF_BODY_CONTAINER_STYLE = {
  contain: "layout paint",
} as const;

const COMMENT_CONTEXT_PREVIEW_CLASS_NAME =
  "overflow-x-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-[11px] leading-5 text-foreground";

type FileDiffEntryProps = {
  diff: FileDiff;
  diffScope: DiffScope;
  isConflicted: boolean;
  reserveConflictSlot: boolean;
  isExpanded: boolean;
  onToggle: (filePath: string) => void;
  diffStyle: PierreDiffStyle;
  canReset: boolean;
  isResetDisabled: boolean;
  resetDisabledReason: string | null;
  onRequestFileReset?: ((filePath: string) => void) | undefined;
  onRequestHunkReset?: ((filePath: string, hunkIndex: number) => void) | undefined;
};

const getDiffScopeLabel = (diffScope: DiffScope): string => {
  return DIFF_SCOPE_OPTIONS.find((option) => option.scope === diffScope)?.label ?? diffScope;
};

const formatLineRange = (startLine: number, endLine: number): string => {
  return startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}-${endLine}`;
};

const renderCommentContext = (comment: Pick<InlineCommentDraft, "codeContext">): ReactElement => {
  return (
    <pre className={COMMENT_CONTEXT_PREVIEW_CLASS_NAME}>
      {comment.codeContext
        .map(({ lineNumber, text, isSelected }) => {
          const marker = isSelected ? ">" : " ";
          return `${marker} ${String(lineNumber).padStart(4, " ")} | ${text}`;
        })
        .join("\n")}
    </pre>
  );
};

function FileDiffEntry({
  diff,
  diffScope,
  isConflicted,
  reserveConflictSlot,
  isExpanded,
  onToggle,
  diffStyle,
  canReset,
  isResetDisabled,
  resetDisabledReason,
  onRequestFileReset,
  onRequestHunkReset,
}: FileDiffEntryProps): ReactElement {
  const StatusIcon = FILE_STATUS_ICON[diff.type] ?? FileText;
  const statusColor = FILE_STATUS_COLOR[diff.type] ?? "text-muted-foreground";
  const allDrafts = useInlineCommentDraftStore((store) => store.drafts);
  const addDraft = useInlineCommentDraftStore((store) => store.addDraft);
  const updateDraft = useInlineCommentDraftStore((store) => store.updateDraft);
  const removeDraft = useInlineCommentDraftStore((store) => store.removeDraft);

  const fileName = diff.file.split("/").pop() ?? diff.file;
  const dirName = diff.file.includes("/") ? diff.file.slice(0, diff.file.lastIndexOf("/")) : "";
  const hasDiffContent = diff.diff.trim().length > 0;
  const diffResetKey = `${diffScope}:${diff.diff}`;
  const fileComments = useMemo(
    () => allDrafts.filter((comment) => comment.filePath === diff.file),
    [allDrafts, diff.file],
  );
  const fileCommentCount = fileComments.length;
  const pendingComments = fileComments.filter((comment) => comment.status === "pending");
  const sentComments = fileComments.filter((comment) => comment.status === "sent");

  // Keep diff subtrees mounted after first expand in production for cheap reopen,
  // but reset them in tests so assertions stay deterministic.
  const shouldPersistMountedDiffBody = process.env.NODE_ENV !== "test";
  const [hasMountedDiffBody, setHasMountedDiffBody] = useState(false);
  const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null>(null);
  const [pendingSelection, setPendingSelection] = useState<PierreDiffSelection | null>(null);
  const [newCommentText, setNewCommentText] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

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
    setSelectedLines(null);
    setPendingSelection(null);
    setNewCommentText("");
    setEditingCommentId(null);
    setEditingText("");
  }, [diffResetKey]);

  const shouldRenderPersistedDiffBody =
    hasDiffContent && shouldPersistMountedDiffBody && hasMountedDiffBody;
  const shouldRenderDiffBody = isExpanded || shouldRenderPersistedDiffBody;
  const canSelectMoreLines = pendingSelection == null && editingCommentId == null;

  const clearPendingSelection = useCallback(() => {
    setSelectedLines(null);
    setPendingSelection(null);
    setNewCommentText("");
  }, []);

  const handleLineSelectionEnd = useCallback((selection: PierreDiffSelection | null) => {
    setPendingSelection(selection);
    setSelectedLines(selection?.selectedLines ?? null);
    setNewCommentText("");
  }, []);

  const handleSaveNewComment = useCallback(() => {
    const text = newCommentText.trim();
    if (!pendingSelection || text.length === 0) {
      return;
    }

    addDraft({
      filePath: diff.file,
      diffScope,
      startLine: pendingSelection.startLine,
      endLine: pendingSelection.endLine,
      side: pendingSelection.side,
      text,
      codeContext: pendingSelection.codeContext,
      language: pendingSelection.language,
    });
    clearPendingSelection();
  }, [addDraft, clearPendingSelection, diff.file, diffScope, newCommentText, pendingSelection]);

  const handleStartEditing = useCallback((comment: InlineCommentDraft) => {
    setEditingCommentId(comment.id);
    setEditingText(comment.text);
    setSelectedLines(null);
    setPendingSelection(null);
    setNewCommentText("");
  }, []);

  const handleCancelEditing = useCallback(() => {
    setEditingCommentId(null);
    setEditingText("");
  }, []);

  const handleSaveEditing = useCallback(() => {
    const text = editingText.trim();
    if (!editingCommentId || text.length === 0) {
      return;
    }

    updateDraft(editingCommentId, text);
    setEditingCommentId(null);
    setEditingText("");
  }, [editingCommentId, editingText, updateDraft]);

  return (
    <div className="min-w-0 max-w-full">
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
            <span className="block truncate font-medium leading-tight" title={fileName}>
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
            <span className="flex min-w-[4.75rem] shrink-0 items-center justify-end gap-1 whitespace-nowrap text-[10px] font-mono tabular-nums">
              {diff.additions > 0 ? (
                <span className="text-green-400">+{diff.additions}</span>
              ) : null}
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
                enableLineSelection={canSelectMoreLines}
                selectedLines={selectedLines}
                onLineSelectionEnd={handleLineSelectionEnd}
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

              {pendingSelection ? (
                <section
                  className="rounded-lg border border-border bg-card p-3"
                  data-testid="agent-studio-git-new-comment-form"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">Pending</Badge>
                    <span>{getDiffScopeLabel(diffScope)}</span>
                    <span>{pendingSelection.side === "old" ? "Old side" : "New side"}</span>
                    <span>
                      {formatLineRange(pendingSelection.startLine, pendingSelection.endLine)}
                    </span>
                  </div>
                  <div className="mt-3">
                    {renderCommentContext({ codeContext: pendingSelection.codeContext })}
                  </div>
                  <Textarea
                    value={newCommentText}
                    placeholder="Add a comment for the Builder"
                    className="mt-3 min-h-24"
                    onChange={(event) => setNewCommentText(event.currentTarget.value)}
                  />
                  <div className="mt-3 flex items-center justify-end gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={clearPendingSelection}>
                      <X className="mr-1.5 size-3.5" />
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={newCommentText.trim().length === 0}
                      onClick={handleSaveNewComment}
                    >
                      <Check className="mr-1.5 size-3.5" />
                      Save comment
                    </Button>
                  </div>
                </section>
              ) : null}

              {pendingComments.length > 0 ? (
                <section className="space-y-3" data-testid="agent-studio-git-pending-comments">
                  {pendingComments.map((comment) => {
                    const isEditing = editingCommentId === comment.id;
                    return (
                      <div
                        key={comment.id}
                        className="rounded-lg border border-border bg-card p-3"
                        data-testid="agent-studio-git-pending-comment"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="warning">Pending</Badge>
                          <span>{getDiffScopeLabel(comment.diffScope)}</span>
                          <span>{comment.side === "old" ? "Old side" : "New side"}</span>
                          <span>{formatLineRange(comment.startLine, comment.endLine)}</span>
                        </div>
                        <div className="mt-3">{renderCommentContext(comment)}</div>
                        {isEditing ? (
                          <>
                            <Textarea
                              value={editingText}
                              className="mt-3 min-h-24"
                              onChange={(event) => setEditingText(event.currentTarget.value)}
                            />
                            <div className="mt-3 flex items-center justify-end gap-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={handleCancelEditing}
                              >
                                <X className="mr-1.5 size-3.5" />
                                Cancel
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                disabled={editingText.trim().length === 0}
                                onClick={handleSaveEditing}
                              >
                                <Check className="mr-1.5 size-3.5" />
                                Save
                              </Button>
                            </div>
                          </>
                        ) : (
                          <>
                            <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">
                              {comment.text}
                            </p>
                            <div className="mt-3 flex items-center justify-end gap-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleStartEditing(comment)}
                              >
                                <Pencil className="mr-1.5 size-3.5" />
                                Edit
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeDraft(comment.id)}
                              >
                                <Trash2 className="mr-1.5 size-3.5" />
                                Remove
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </section>
              ) : null}

              {sentComments.length > 0 ? (
                <section className="space-y-2" data-testid="agent-studio-git-sent-comments">
                  {sentComments.map((comment) => (
                    <Collapsible key={comment.id} defaultOpen={false}>
                      <div className="rounded-lg border border-border bg-card">
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                            data-testid="agent-studio-git-sent-comment-trigger"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <Badge variant="outline">Sent</Badge>
                                <span>{getDiffScopeLabel(comment.diffScope)}</span>
                                <span>{comment.side === "old" ? "Old side" : "New side"}</span>
                                <span>{formatLineRange(comment.startLine, comment.endLine)}</span>
                              </div>
                              <p className="mt-1 truncate text-sm text-foreground">
                                {comment.text}
                              </p>
                            </div>
                            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="border-t border-border px-3 py-3">
                          <div>{renderCommentContext(comment)}</div>
                          <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">
                            {comment.text}
                          </p>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  ))}
                </section>
              ) : null}
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
    previous.isExpanded === next.isExpanded &&
    previous.diffScope === next.diffScope &&
    previous.isConflicted === next.isConflicted &&
    previous.reserveConflictSlot === next.reserveConflictSlot &&
    previous.diffStyle === next.diffStyle &&
    previous.canReset === next.canReset &&
    previous.isResetDisabled === next.isResetDisabled &&
    previous.resetDisabledReason === next.resetDisabledReason &&
    previous.onRequestFileReset === next.onRequestFileReset &&
    previous.onRequestHunkReset === next.onRequestHunkReset &&
    previous.onToggle === next.onToggle &&
    areFileDiffsEqual(previous.diff, next.diff),
);
