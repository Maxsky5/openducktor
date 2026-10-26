import type { GitFileDiff } from "@openducktor/contracts";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  Ellipsis,
  Eye,
  FileText,
  LoaderCircle,
  type LucideIcon,
  MessageSquare,
  Undo2,
} from "lucide-react";
import {
  type MouseEvent,
  memo,
  type ReactElement,
  type RefCallback,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  PierreDiffStyle,
  PierreHunkAction,
} from "@/components/features/agents/pierre-diff-viewer";
import { PierreDiffViewer } from "@/components/features/agents/pierre-diff-viewer";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { DiffScope, GitChangeIntent } from "@openducktor/frontend-core/git/contracts";
import { arraysEqual } from "@/lib/arrays-equal";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { cn } from "@/lib/utils";
import type { InlineCommentDraft } from "@openducktor/frontend-core/drafts/inline-comment-draft-store";
import {
  FILE_LIST_ROW_CLASS_NAME,
  FILE_STATUS_COLOR,
  FILE_STATUS_ICON,
  fileListRowStyle,
} from "./constants";
import type { FileRow, RowLabel } from "./file-list-rows";
import type { HighlightRange } from "./file-list-search";
import type { FileListViewMode } from "./file-list-view-preference";
import {
  chunkActionUnavailableReason,
  discardFileLabel,
  discardUnavailableReason,
  fileIntent,
  GROUP_TOGGLE,
  type GitFileRowActions,
} from "./git-file-row-actions";
import { HighlightedText } from "./highlighted-text";
import {
  type FileDiffAnnotationAction,
  type FileDiffAnnotationState,
  useFileDiffCommentAnnotations,
} from "./use-file-diff-comment-annotations";

const areFileDiffsEqual = (left: GitFileDiff, right: GitFileDiff): boolean =>
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
  viewMode: FileListViewMode;
  diffScope: DiffScope;
  ownerKey: string | null;
  commentPlaceholder?: string | undefined;
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
  onViewFile: ((filePath: string) => void) | null;
  diffStyle: PierreDiffStyle;
  /** Stage, unstage, and discard controls. Review-only lists have none. */
  rowActions: GitFileRowActions | null;
  /** The file action that runs now, or null. */
  runningAction: GitChangeIntent["action"] | null;
  /** True while a change runs and the diff is open. Chunk numbers can move until it ends. */
  isChangeRunning: boolean;
};

function FileDiffEntryLabel({ row }: { row: FileRow }): ReactElement {
  const { diff, name, directory } = row;
  // Without a directory line, the hover shows the full path from the outer title.
  return (
    // The label sits above the row overlay of the toggle button, so its path tooltip still shows.
    <span
      className="relative z-[1] flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden"
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

type RowStatus = {
  StatusIcon: typeof FileText;
  isConflicted: boolean;
  isExpanded: boolean;
  reserveConflictSlot: boolean;
  statusColor: string;
  fileCommentCount: number;
};

function RowActionButton({
  label,
  icon: Icon,
  isPending,
  disabledReason,
  testId,
  destructive = false,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  isPending: boolean;
  disabledReason: string | null;
  testId: string;
  destructive?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}): ReactElement {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-6 text-muted-foreground hover:text-foreground disabled:pointer-events-auto disabled:cursor-not-allowed"
      aria-label={label}
      title={disabledReason ?? label}
      // A running action takes no second click. Other changes wait in the queue.
      disabled={disabledReason !== null || isPending}
      data-testid={testId}
      onClick={onClick}
    >
      {isPending ? (
        <LoaderCircle className="size-3.5 animate-spin" />
      ) : (
        <Icon className={cn("size-3.5", destructive && "text-destructive")} />
      )}
    </Button>
  );
}

function FileRowMenu({
  filePath,
  isDeleted,
  rowActions,
  discardUnavailable,
  onViewFile,
}: {
  filePath: string;
  /** A deleted file has no content to preview. */
  isDeleted: boolean;
  rowActions: GitFileRowActions | null;
  /** Why Discard cannot run for this file, such as a submodule, or null when it can. */
  discardUnavailable: string | null;
  onViewFile: ((filePath: string) => void) | null;
}): ReactElement {
  const { copyToClipboard } = useCopyToClipboard({ successMessage: "Path copied" });
  const disabled = rowActions?.disabledReason != null;
  const canView = onViewFile !== null && !isDeleted;
  return (
    <ContextMenuContent className="w-60" data-testid="agent-studio-git-file-menu">
      {canView ? (
        <ContextMenuItem className="cursor-pointer" onSelect={() => onViewFile?.(filePath)}>
          <Eye />
          View file
        </ContextMenuItem>
      ) : null}
      {rowActions ? (
        <>
          {rowActions.disabledReason ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">{rowActions.disabledReason}</p>
          ) : null}
          <GroupToggleMenuItem rowActions={rowActions} filePath={filePath} disabled={disabled} />
          {discardUnavailable ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">{discardUnavailable}</p>
          ) : null}
          <ContextMenuItem
            className="cursor-pointer"
            variant="destructive"
            disabled={disabled || discardUnavailable !== null}
            onSelect={() => rowActions.onChange(fileIntent(rowActions, "discard", filePath))}
          >
            <Undo2 />
            {discardFileLabel(rowActions.group)}
          </ContextMenuItem>
        </>
      ) : null}
      {canView || rowActions ? <ContextMenuSeparator /> : null}
      <ContextMenuItem className="cursor-pointer" onSelect={() => void copyToClipboard(filePath)}>
        <Copy />
        Copy path
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

function GroupToggleMenuItem({
  rowActions,
  filePath,
  disabled,
}: {
  rowActions: GitFileRowActions;
  filePath: string;
  disabled: boolean;
}): ReactElement {
  const { action, label, icon: Icon } = GROUP_TOGGLE[rowActions.group];
  return (
    <ContextMenuItem
      className="cursor-pointer"
      disabled={disabled}
      onSelect={() => rowActions.onChange(fileIntent(rowActions, action, filePath))}
    >
      <Icon />
      {label} file
    </ContextMenuItem>
  );
}

function FileRowActionBar({
  filePath,
  rowActions,
  runningAction,
  discardUnavailable,
  onOpenMenu,
}: {
  filePath: string;
  rowActions: GitFileRowActions | null;
  runningAction: GitChangeIntent["action"] | null;
  discardUnavailable: string | null;
  onOpenMenu: (event: MouseEvent<HTMLButtonElement>) => void;
}): ReactElement {
  const pending = (action: GitChangeIntent["action"]) => runningAction === action;
  const toggle = GROUP_TOGGLE[rowActions?.group ?? "unstaged"];
  const anyPending = runningAction !== null;
  return (
    // Only a hover or keyboard focus shows the actions, so a click on the row does not keep them.
    <div
      className={cn(
        "relative z-10 shrink-0 items-center gap-0.5",
        anyPending
          ? "flex"
          : "hidden group-hover/file-row:flex group-has-[:focus-visible]/file-row:flex",
      )}
    >
      {rowActions ? (
        <>
          <RowActionButton
            label={discardFileLabel(rowActions.group)}
            icon={Undo2}
            destructive
            isPending={pending("discard")}
            disabledReason={rowActions.disabledReason ?? discardUnavailable}
            testId="agent-studio-git-discard-file-button"
            onClick={() => rowActions.onChange(fileIntent(rowActions, "discard", filePath))}
          />
          <RowActionButton
            label={`${toggle.label} file`}
            icon={toggle.icon}
            isPending={pending(toggle.action)}
            disabledReason={rowActions.disabledReason}
            testId={`agent-studio-git-${toggle.action}-file-button`}
            onClick={() => rowActions.onChange(fileIntent(rowActions, toggle.action, filePath))}
          />
        </>
      ) : null}
      <RowActionButton
        label={`More actions for ${filePath}`}
        icon={Ellipsis}
        isPending={false}
        disabledReason={null}
        testId="agent-studio-git-file-menu-button"
        onClick={onOpenMenu}
      />
    </div>
  );
}

function FileDiffEntryHeader({
  row,
  viewMode,
  status,
  rowActions,
  runningAction,
  onToggle,
  onViewFile,
}: {
  row: FileRow;
  viewMode: FileListViewMode;
  status: RowStatus;
  rowActions: GitFileRowActions | null;
  runningAction: GitChangeIntent["action"] | null;
  onToggle: (filePath: string) => void;
  onViewFile: ((filePath: string) => void) | null;
}): ReactElement {
  const { diff } = row;
  const {
    StatusIcon,
    fileCommentCount,
    isConflicted,
    isExpanded,
    reserveConflictSlot,
    statusColor,
  } = status;
  const triggerRef = useRef<HTMLDivElement>(null);
  // A menu must not act on content that changed after it opened, so a change closes it.
  const [menu, setMenu] = useState({ open: false, content: diff.diff, generation: 0 });
  if (menu.open && menu.content !== diff.diff) {
    setMenu({ open: false, content: diff.diff, generation: menu.generation + 1 });
  }
  const openMenu = (event: MouseEvent<HTMLButtonElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect();
    triggerRef.current?.dispatchEvent(
      new globalThis.MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: bounds.left,
        clientY: bounds.bottom,
      }),
    );
  };

  return (
    <ContextMenu
      key={menu.generation}
      onOpenChange={(open) => setMenu((current) => ({ ...current, open, content: diff.diff }))}
    >
      <ContextMenuTrigger asChild>
        <div
          ref={triggerRef}
          className="group/file-row relative flex min-w-0 items-center hover:bg-muted/50"
        >
          {/* The button covers the whole row, so a click on the counts also toggles the diff. */}
          <button
            type="button"
            className={cn(
              FILE_LIST_ROW_CLASS_NAME,
              "w-auto flex-1 overflow-hidden pr-2 after:absolute after:inset-0",
            )}
            style={fileListRowStyle(viewMode, row.depth)}
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
                aria-label="Unresolved conflict"
                data-testid="agent-studio-git-file-conflict-indicator"
              />
            ) : reserveConflictSlot ? (
              <span
                className="inline-flex size-3.5 shrink-0 items-center justify-center"
                data-testid="agent-studio-git-file-conflict-slot"
              />
            ) : null}
            <FileDiffEntryLabel row={row} />
          </button>
          <FileRowActionBar
            filePath={diff.file}
            rowActions={rowActions}
            runningAction={runningAction}
            discardUnavailable={discardUnavailableReason(diff)}
            onOpenMenu={openMenu}
          />
          <span
            className="ml-1 flex shrink-0 items-center justify-end gap-2 pr-3"
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
            <span className="flex shrink-0 items-center justify-end gap-1 font-mono text-[10px] whitespace-nowrap tabular-nums">
              {diff.additions > 0 ? (
                <span className="text-green-600 dark:text-green-400">+{diff.additions}</span>
              ) : null}
              {diff.deletions > 0 ? (
                <span className="text-red-600 dark:text-red-400">-{diff.deletions}</span>
              ) : null}
            </span>
          </span>
        </div>
      </ContextMenuTrigger>
      {/* A closed menu still mounts its content parts, which doubles the cost of a long list. */}
      {menu.open ? (
        <FileRowMenu
          filePath={diff.file}
          isDeleted={diff.type === "deleted"}
          rowActions={rowActions}
          discardUnavailable={discardUnavailableReason(diff)}
          onViewFile={onViewFile}
        />
      ) : null}
    </ContextMenu>
  );
}

const CHANGE_RUNNING_REASON = "Wait for the current change to finish.";

const hunkActionsFor = (
  rowActions: GitFileRowActions,
  filePath: string,
): readonly PierreHunkAction[] => {
  const hunk = (action: "stage" | "unstage" | "discard") => (hunkIndex: number) =>
    rowActions.onChange({
      action,
      group: rowActions.group,
      selection: { kind: "hunk", filePath, hunkIndex },
    });
  const discard: PierreHunkAction = {
    id: "discard",
    label: "Discard",
    icon: Undo2,
    variant: "destructive",
    onSelect: hunk("discard"),
  };
  const { action, label, icon } = GROUP_TOGGLE[rowActions.group];
  return [discard, { id: action, label, icon, onSelect: hunk(action) }];
};

function FileDiffEntryBody({
  diff,
  diffScope,
  ownerKey,
  commentPlaceholder,
  fileComments,
  annotationState,
  dispatchAnnotation,
  diffStyle,
  shouldRender,
  isExpanded,
  rowActions,
  isChangeRunning,
  bodyRef,
}: {
  diff: GitFileDiff;
  diffScope: DiffScope;
  ownerKey: string | null;
  commentPlaceholder?: string | undefined;
  fileComments: InlineCommentDraft[];
  annotationState: FileDiffAnnotationState;
  dispatchAnnotation: (action: FileDiffAnnotationAction) => void;
  diffStyle: PierreDiffStyle;
  shouldRender: boolean;
  isExpanded: boolean;
  rowActions: GitFileRowActions | null;
  isChangeRunning: boolean;
  bodyRef: RefCallback<HTMLDivElement>;
}): ReactElement | null {
  const {
    selectedLines,
    hasOpenAnnotationForm,
    handleLineSelectionEnd,
    lineAnnotations,
    renderAnnotation,
    unplacedComments,
    renderComment,
  } = useFileDiffCommentAnnotations({
    ownerKey,
    commentPlaceholder,
    diff,
    diffScope,
    fileComments,
    annotationState,
    dispatchAnnotation,
  });
  const chunkUnavailable = rowActions ? chunkActionUnavailableReason(diff) : null;
  const hunkActions = useMemo(
    () =>
      rowActions && chunkUnavailable === null ? hunkActionsFor(rowActions, diff.file) : undefined,
    [chunkUnavailable, diff.file, rowActions],
  );

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
      {rowActions && chunkUnavailable ? (
        <p
          className="px-3 pt-2 text-[11px] text-muted-foreground"
          data-testid="agent-studio-git-chunk-actions-unavailable"
        >
          {chunkUnavailable} Use the file actions.
        </p>
      ) : null}
      {unplacedComments.length > 0 ? (
        <div className="space-y-2 px-3 pt-3" data-testid="agent-studio-git-unplaced-comments">
          <p className="text-[11px] text-muted-foreground">
            The lines of these comments changed. They stay pending, and Send includes their saved
            code context.
          </p>
          {unplacedComments.map((comment) => (
            <div key={comment.id}>{renderComment(comment)}</div>
          ))}
        </div>
      ) : null}
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
            hunkActions={hunkActions}
            hunkActionsDisabledReason={
              rowActions?.disabledReason ?? (isChangeRunning ? CHANGE_RUNNING_REASON : null)
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
  viewMode,
  diffScope,
  ownerKey,
  commentPlaceholder,
  fileComments,
  annotationState,
  onAnnotationAction,
  viewState,
  onToggle,
  onViewFile,
  diffStyle,
  rowActions,
  runningAction,
  isChangeRunning,
}: FileDiffEntryProps): ReactElement {
  const { diff } = row;
  const { isConflicted, reserveConflictSlot, isExpanded } = viewState;
  const StatusIcon = FILE_STATUS_ICON.get(diff.type) ?? FileText;
  const statusColor = FILE_STATUS_COLOR.get(diff.type) ?? "text-muted-foreground";
  const hasDiffContent = diff.diff.trim().length > 0;

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
        viewMode={viewMode}
        status={{
          StatusIcon,
          fileCommentCount: fileComments.length,
          isConflicted,
          isExpanded,
          reserveConflictSlot,
          statusColor,
        }}
        rowActions={rowActions}
        runningAction={runningAction}
        onToggle={onToggle}
        onViewFile={onViewFile}
      />
      <FileDiffEntryBody
        diff={diff}
        diffScope={diffScope}
        ownerKey={ownerKey}
        commentPlaceholder={commentPlaceholder}
        fileComments={fileComments}
        annotationState={annotationState}
        dispatchAnnotation={dispatchAnnotation}
        diffStyle={diffStyle}
        shouldRender={shouldRenderDiffBody}
        isExpanded={isExpanded}
        rowActions={rowActions}
        isChangeRunning={isChangeRunning}
        bodyRef={bodyRef}
      />
    </div>
  );
}

export const FileDiffEntryWithMemo = memo(
  FileDiffEntry,
  (previous, next) =>
    previous.viewMode === next.viewMode &&
    previous.viewState.isExpanded === next.viewState.isExpanded &&
    previous.diffScope === next.diffScope &&
    previous.ownerKey === next.ownerKey &&
    previous.commentPlaceholder === next.commentPlaceholder &&
    previous.viewState.isConflicted === next.viewState.isConflicted &&
    previous.viewState.reserveConflictSlot === next.viewState.reserveConflictSlot &&
    previous.diffStyle === next.diffStyle &&
    previous.rowActions === next.rowActions &&
    previous.runningAction === next.runningAction &&
    previous.isChangeRunning === next.isChangeRunning &&
    previous.onToggle === next.onToggle &&
    previous.onViewFile === next.onViewFile &&
    previous.fileComments === next.fileComments &&
    previous.annotationState === next.annotationState &&
    previous.onAnnotationAction === next.onAnnotationAction &&
    areFileRowsEqual(previous.row, next.row),
);
