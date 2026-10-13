import type {
  GitHistoryCommit,
  GitHistoryCommitMembership,
  GitHistoryComparison,
} from "@openducktor/contracts";
import type { ReactElement } from "react";
import type { RowComponentProps } from "react-window";
import { CopyIconButton } from "@/components/ui/copy-icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { cn } from "@/lib/utils";
import { AuthorAvatar } from "./git-history-avatar";
import { type HistoryColumnId, historyColumnWidth } from "./git-history-columns";
import { commitBodyBlocks, commitBodyPreview } from "./git-history-commit-message";
import { type GraphView, HistoryGraphCell, laneColor } from "./git-history-graph";
import {
  formatCompactCommitAge,
  formatExactCommitDate,
  formatRelativeCommitDate,
  type GraphRow,
} from "./git-history-graph-model";
import { type HistoryFooter, HistoryFooterRow } from "./git-history-messages";
import { type HistoryRefGroup, HistoryRefsCell, historyRefGroups } from "./git-history-refs";

export type HistoryRowProps = {
  rows: GraphRow[];
  graph: GraphView;
  comparison: GitHistoryComparison;
  currentLabel: string;
  targetLabel: string;
  footer: HistoryFooter;
  nowMs: number;
  /** The shown columns in their order. */
  columns: HistoryColumnId[];
};

const SHORT_OID_LENGTH = 7;

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
  columns,
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
  const refGroups = historyRefGroups(commit, comparison, targetLabel);
  const cell: CellInput = { row, graph, color, refGroups, nowMs, exactDate };
  return (
    <div style={style} {...ariaAttributes} className="flex min-w-0">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="group/history-row flex h-full w-full min-w-0 cursor-pointer items-center text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-[state=open]:bg-muted"
            aria-label={`${membershipLabel(commit.membership)} commit ${commit.subject} by ${commit.authorName}, ${exactDate}`}
            data-testid="agent-studio-git-history-row"
          >
            {columns.map((id, position) => (
              <HistoryCell
                key={id}
                id={id}
                input={cell}
                // The line to the node shows only when the labels sit right beside the graph.
                labelsOnLeft={columns[position - 1] === "refs" && refGroups.length > 0}
              />
            ))}
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
            refGroups={refGroups}
            nowMs={nowMs}
            currentLabel={currentLabel}
            targetLabel={targetLabel}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

type CellInput = {
  row: GraphRow;
  graph: GraphView;
  color: string;
  refGroups: HistoryRefGroup[];
  nowMs: number;
  exactDate: string;
};

/** One column of a row. Each cell keeps the width of its column title. */
function HistoryCell({
  id,
  input,
  labelsOnLeft,
}: {
  id: HistoryColumnId;
  input: CellInput;
  labelsOnLeft: boolean;
}): ReactElement {
  const { row, graph, color, refGroups, nowMs, exactDate } = input;
  const { commit } = row;
  if (id === "graph") {
    return <HistoryGraphCell row={row} graph={graph} connectFromLeft={labelsOnLeft} />;
  }
  if (id === "message") return <MessageCell commit={commit} />;
  const width = historyColumnWidth(id, graph.viewWidth) ?? undefined;
  const fixed = "flex h-full shrink-0 items-center overflow-hidden";
  if (id === "refs") {
    return (
      <span className={cn(fixed, "px-1.5")} style={{ width }}>
        <HistoryRefsCell groups={refGroups} color={color} />
      </span>
    );
  }
  if (id === "author") {
    return (
      <span
        className={cn(fixed, "gap-1.5 px-2 text-[11px] text-muted-foreground")}
        style={{ width }}
        data-testid="agent-studio-git-history-author"
      >
        <AuthorAvatar
          name={commit.authorName}
          email={commit.authorEmail}
          className={cn("size-4 bg-current", color)}
          initialsClassName="text-[7px] text-white"
        />
        <span className="min-w-0 truncate">{commit.authorName}</span>
      </span>
    );
  }
  if (id === "sha") {
    return (
      <code
        className={cn(fixed, "px-2 font-mono text-[11px] text-muted-foreground")}
        style={{ width }}
        title={commit.oid}
      >
        {commit.oid.slice(0, SHORT_OID_LENGTH)}
      </code>
    );
  }
  return (
    <time
      className={cn(fixed, "justify-end px-2.5 text-[11px] text-muted-foreground tabular-nums")}
      style={{ width }}
      dateTime={commit.authorDate}
      title={`${commit.authorName}, ${exactDate}`}
    >
      {formatCompactCommitAge(commit.authorDate, nowMs)}
    </time>
  );
}

/** The subject, then the body as one muted line. */
function MessageCell({ commit }: { commit: GitHistoryCommit }): ReactElement {
  const preview = commitBodyPreview(commit.message);
  return (
    <span className="flex h-full min-w-0 flex-1 items-baseline gap-2 self-center overflow-hidden px-2 text-xs leading-8 whitespace-nowrap">
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
  );
}

const membershipLabel = (membership: GitHistoryCommitMembership): string => {
  if (membership === "current") return "Current branch";
  if (membership === "target") return "Missing target";
  return "Shared base";
};

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
          initialsClassName="text-[11px] text-white"
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
