import type {
  GitHistoryCommit,
  GitHistoryCommitMembership,
  GitHistoryComparison,
} from "@openducktor/contracts";
import { GitBranch, type LucideIcon, Target } from "lucide-react";
import type { ReactElement } from "react";
import type { RowComponentProps } from "react-window";
import { CopyIconButton } from "@/components/ui/copy-icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { cn } from "@/lib/utils";
import { commitBodyBlocks, commitBodyPreview } from "./git-history-commit-message";
import { type GraphView, HistoryGraphCell, laneColor } from "./git-history-graph";
import {
  authorInitials,
  formatCompactCommitAge,
  formatExactCommitDate,
  formatRelativeCommitDate,
  type GraphRow,
} from "./git-history-graph-model";
import { type HistoryFooter, HistoryFooterRow } from "./git-history-messages";

export type HistoryRowProps = {
  rows: GraphRow[];
  graph: GraphView;
  comparison: GitHistoryComparison;
  currentLabel: string;
  targetLabel: string;
  footer: HistoryFooter;
  nowMs: number;
};

export function HistoryRowView({
  index,
  style,
  ariaAttributes,
  rows,
  graph,
  comparison,
  currentLabel,
  targetLabel,
  footer,
  nowMs,
}: RowComponentProps<HistoryRowProps>): ReactElement {
  const row = rows[index];
  if (!row) {
    return (
      <div style={style} {...ariaAttributes}>
        <HistoryFooterRow footer={footer} />
      </div>
    );
  }
  const { commit } = row;
  const color = laneColor(commit.membership, row.lane);
  const exactDate = formatExactCommitDate(commit.authorDate);
  const preview = commitBodyPreview(commit.message);
  return (
    <div style={style} {...ariaAttributes} className="flex min-w-0">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="group/history-row flex h-full w-full min-w-0 cursor-pointer items-center text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            aria-label={`${membershipLabel(commit.membership)} commit ${commit.subject} by ${commit.authorName}, ${exactDate}`}
            data-testid="agent-studio-git-history-row"
          >
            <HistoryGraphCell row={row} graph={graph} />
            <span className="flex h-full min-w-0 flex-1 items-center gap-2 pr-2.5 pl-2 group-hover/history-row:bg-muted/60 group-data-[state=open]/history-row:bg-muted">
              <RefPills
                commit={commit}
                comparison={comparison}
                color={color}
                currentLabel={currentLabel}
                targetLabel={targetLabel}
              />
              <span className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden whitespace-nowrap text-xs">
                <span
                  className={cn(
                    "max-w-full shrink-0 truncate",
                    commit.membership === "target" ? "text-foreground/65" : "text-foreground",
                  )}
                >
                  {commit.subject}
                </span>
                {preview ? (
                  <span className="min-w-0 truncate text-muted-foreground/75">{preview}</span>
                ) : null}
              </span>
              <span
                className="hidden w-24 shrink-0 truncate text-[11px] text-muted-foreground @[30rem]/history:block"
                data-testid="agent-studio-git-history-author"
              >
                {commit.authorName}
              </span>
              <time
                className="w-8 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums"
                dateTime={commit.authorDate}
                title={`${commit.authorName}, ${exactDate}`}
              >
                {formatCompactCommitAge(commit.authorDate, nowMs)}
              </time>
            </span>
          </button>
        </PopoverTrigger>
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
        >
          <CommitDetails
            commit={commit}
            color={color}
            nowMs={nowMs}
            currentLabel={currentLabel}
            targetLabel={targetLabel}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

const membershipLabel = (membership: GitHistoryCommitMembership): string => {
  if (membership === "current") return "Current branch";
  if (membership === "target") return "Missing target";
  return "Shared base";
};

type TipRef = { label: string; description: string; color: string; icon: LucideIcon };

/**
 * Branch labels at the tips, tinted with the lane color as in GitKraken. A second label on the
 * same commit folds into a count, so the subject keeps its space.
 */
function RefPills({
  commit,
  comparison,
  color,
  currentLabel,
  targetLabel,
}: {
  commit: GitHistoryCommit;
  comparison: GitHistoryComparison;
  color: string;
  currentLabel: string;
  targetLabel: string;
}): ReactElement | null {
  const refs: TipRef[] = [];
  if (commit.oid === comparison.currentTip) {
    refs.push({
      label: currentLabel,
      description: `Current: ${currentLabel}`,
      color,
      icon: GitBranch,
    });
  }
  if (commit.oid === comparison.targetTip) {
    refs.push({
      label: targetLabel,
      description: `Target: ${targetLabel}`,
      color: laneColor("target", 0),
      icon: Target,
    });
  }
  const [first, ...others] = refs;
  if (!first && commit.membership !== "boundary") return null;
  return (
    <span
      className="flex min-w-0 max-w-[45%] shrink-0 items-center gap-1"
      data-testid="agent-studio-git-history-markers"
    >
      {first ? <RefPill {...first} /> : null}
      {others.length > 0 ? (
        <span
          className="inline-flex h-[18px] shrink-0 items-center rounded-[4px] bg-muted px-1 text-[10.5px] leading-none font-semibold text-muted-foreground"
          title={others.map((ref) => ref.description).join("\n")}
        >
          <span className="sr-only">{others.map((ref) => ref.description).join(", ")}</span>
          <span aria-hidden="true">+{others.length}</span>
        </span>
      ) : null}
      {first ? null : (
        <span
          className="inline-flex h-[18px] shrink-0 items-center rounded-[4px] border border-dashed border-border px-1.5 text-[10.5px] leading-none font-medium text-muted-foreground"
          title="Shared base"
        >
          <span className="sr-only">Shared base</span>
          <span aria-hidden="true">Base</span>
        </span>
      )}
    </span>
  );
}

function RefPill({ label, description, color, icon: Icon }: TipRef): ReactElement {
  return (
    <span
      className={cn(
        "relative inline-flex h-[18px] max-w-full min-w-0 items-center gap-1 overflow-hidden rounded-[4px] border-l-[3px] border-current px-1.5 text-[10.5px] leading-none font-semibold",
        color,
      )}
      title={description}
    >
      <span aria-hidden="true" className="absolute inset-0 bg-current opacity-20" />
      <Icon className="relative size-3 shrink-0" aria-hidden="true" />
      <span className="sr-only">{description}</span>
      <span className="relative truncate text-foreground" aria-hidden="true">
        {label}
      </span>
    </span>
  );
}

function CommitDetails({
  commit,
  color,
  nowMs,
  currentLabel,
  targetLabel,
}: {
  commit: GitHistoryCommit;
  color: string;
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
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full bg-current",
            color,
          )}
          aria-hidden="true"
        >
          <span className="text-[11px] font-bold text-white">
            {authorInitials(commit.authorName)}
          </span>
        </span>
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
