import type { FileDiff } from "@openducktor/contracts";
import { AlertTriangle, ChevronDown, ChevronRight, FileText, Undo2 } from "lucide-react";
import { memo, type ReactElement } from "react";
import type { PierreDiffStyle } from "@/components/features/agents/pierre-diff-viewer";
import { PierreDiffViewer } from "@/components/features/agents/pierre-diff-viewer";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { FILE_STATUS_COLOR, FILE_STATUS_ICON } from "./constants";

const areFileDiffsEqual = (left: FileDiff, right: FileDiff): boolean =>
  left.file === right.file &&
  left.type === right.type &&
  left.additions === right.additions &&
  left.deletions === right.deletions &&
  left.diff === right.diff;

type FileDiffEntryProps = {
  diff: FileDiff;
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

function FileDiffEntry({
  diff,
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

  const fileName = diff.file.split("/").pop() ?? diff.file;
  const dirName = diff.file.includes("/") ? diff.file.slice(0, diff.file.lastIndexOf("/")) : "";
  const hasDiffContent = diff.diff.trim().length > 0;

  return (
    <div className="min-w-0 max-w-full">
      <div className="flex items-center gap-1 px-3 py-1.5 transition-colors hover:bg-muted/50">
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 overflow-hidden text-left text-xs"
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
            className="ml-2 flex min-w-[4.75rem] shrink-0 items-center justify-end"
            data-testid="agent-studio-git-file-stats"
          >
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

      {isExpanded ? (
        <div className="border-t border-border/50">
          {hasDiffContent ? (
            <PierreDiffViewer
              patch={diff.diff}
              filePath={diff.file}
              diffStyle={diffStyle}
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
