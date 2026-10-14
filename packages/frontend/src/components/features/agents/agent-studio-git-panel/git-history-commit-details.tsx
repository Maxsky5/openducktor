import type { GitHistoryCommit, GitHistoryComparison } from "@openducktor/contracts";
import { type ReactElement, type RefObject, useMemo } from "react";
import { CopyIconButton } from "@/components/ui/copy-icon-button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { cn } from "@/lib/utils";
import { AuthorAvatar } from "./git-history-avatar";
import { commitBodyBlocks } from "./git-history-commit-message";
import { laneColor } from "./git-history-graph";
import {
  formatExactCommitDate,
  formatRelativeCommitDate,
  type GraphRow,
} from "./git-history-graph-model";
import { type HistoryRefGroup, historyRefGroups } from "./git-history-refs";

/**
 * The details card of the selected commit. The list owns one card for every row, so a row that
 * leaves the view while the list scrolls cannot take an open card with it.
 */
export function HistoryCommitPopover({
  row,
  anchor,
  comparison,
  currentLabel,
  targetLabel,
  nowMs,
  onClose,
}: {
  /** The selected commit, or null when no card is open. */
  row: GraphRow | null;
  /** The row button of the selected commit. */
  anchor: RefObject<HTMLButtonElement | null>;
  comparison: GitHistoryComparison;
  currentLabel: string;
  targetLabel: string;
  nowMs: number;
  onClose: () => void;
}): ReactElement {
  // The card measures the row button that opened it.
  const measurable = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () =>
          anchor.current?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0),
      },
    }),
    [anchor],
  );
  return (
    <Popover
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverAnchor virtualRef={measurable} />
      {row ? (
        <PopoverContent
          side="bottom"
          align="start"
          tabIndex={-1}
          className="w-[min(24rem,calc(100vw-1rem))] p-0 outline-none"
          // Focus the card, not its copy button, so the button tooltip does not open at once.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
          }}
          // A click on the open row closes the card through the row, not as an outside click.
          onInteractOutside={(event) => {
            if (event.target instanceof Node && anchor.current?.contains(event.target)) {
              event.preventDefault();
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (anchor.current?.isConnected) anchor.current.focus();
          }}
        >
          <CommitDetails
            commit={row.commit}
            color={laneColor(row.commit.membership, row.lane)}
            refGroups={historyRefGroups(row.commit, comparison, targetLabel)}
            nowMs={nowMs}
            currentLabel={currentLabel}
            targetLabel={targetLabel}
          />
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

function CommitDetails({
  commit,
  color,
  refGroups,
  nowMs,
  currentLabel,
  targetLabel,
}: {
  commit: GitHistoryCommit;
  color: string;
  refGroups: HistoryRefGroup[];
  nowMs: number;
  currentLabel: string;
  targetLabel: string;
}): ReactElement {
  const { copied, copyToClipboard } = useCopyToClipboard({ successMessage: "Commit ID copied" });
  const blocks = commitBodyBlocks(commit.message);
  let side = "Shared base of both branches";
  if (commit.membership === "current") side = `Only on ${currentLabel}`;
  if (commit.membership === "target") side = `Only on ${targetLabel}, missing here`;
  return (
    <div className="text-xs" data-testid="agent-studio-git-history-details">
      <div className="flex items-center gap-2.5 px-3 pt-3">
        <AuthorAvatar
          name={commit.authorName}
          email={commit.authorEmail}
          className={cn("size-8 bg-current", color)}
          initialsClassName="text-[11px] text-background"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground">{commit.authorName}</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {formatRelativeCommitDate(commit.authorDate, nowMs)} ·{" "}
            <time dateTime={commit.authorDate}>{formatExactCommitDate(commit.authorDate)}</time>
          </span>
        </span>
      </div>
      <div className="space-y-2 p-3">
        <p className="text-[13px] leading-snug font-semibold break-words text-foreground">
          {commit.subject}
        </p>
        {blocks.length > 0 ? (
          <div className="max-h-56 space-y-2 overflow-y-auto pr-1 leading-relaxed break-words text-muted-foreground">
            {blocks.map((block) =>
              block.kind === "paragraph" ? (
                <p key={block.line}>{block.text}</p>
              ) : (
                <ul key={block.line} className="list-disc space-y-1 pl-4">
                  {block.items.map((item) => (
                    <li key={item.line}>{item.text}</li>
                  ))}
                </ul>
              ),
            )}
          </div>
        ) : null}
      </div>
      <div className="space-y-1 border-t border-border bg-muted/40 px-3 py-2">
        <p className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
          <span
            className={cn("size-2 shrink-0 rounded-full bg-current", color)}
            aria-hidden="true"
          />
          <span className="min-w-0 truncate">{side}</span>
        </p>
        {refGroups.length > 0 ? (
          <p className="min-w-0 truncate text-[11px] text-muted-foreground">
            {refGroups.flatMap((group) => group.fullNames).join(", ")}
          </p>
        ) : null}
        <div className="flex min-w-0 items-center gap-1">
          <code
            className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/80"
            title={commit.oid}
          >
            {commit.oid}
          </code>
          <CopyIconButton
            copied={copied}
            ariaLabel="Copy commit ID"
            tooltipLabel="Copy commit ID"
            className="size-6 shrink-0"
            onClick={() => void copyToClipboard(commit.oid)}
          />
        </div>
      </div>
    </div>
  );
}
