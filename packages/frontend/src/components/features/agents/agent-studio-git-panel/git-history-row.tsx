import type {
  GitHistoryCommit,
  GitHistoryCommitMembership,
  GitHistoryComparison,
} from "@openducktor/contracts";
import { type ReactElement, useMemo } from "react";
import type { RowComponentProps } from "react-window";
import { cn } from "@/lib/utils";
import { AuthorAvatar } from "./git-history-avatar";
import { type HistoryColumnId, historyColumnWidth } from "./git-history-columns";
import { commitBodyPreview } from "./git-history-commit-message";
import { type GraphView, HistoryGraphCell, laneColor } from "./git-history-graph";
import {
  formatCompactCommitAge,
  formatExactCommitDate,
  type GraphRow,
} from "./git-history-graph-model";
import { type HistoryFooter, HistoryFooterRow } from "./git-history-messages";
import { type HistoryRefGroup, HistoryRefsCell, historyRefGroups } from "./git-history-refs";

export type HistoryRowProps = {
  rows: GraphRow[];
  /** Commits that the last read added. They fade in. */
  entering: ReadonlySet<string>;
  graph: GraphView;
  comparison: GitHistoryComparison;
  targetLabel: string;
  footer: HistoryFooter;
  nowMs: number;
  /** The shown columns in their order. */
  columns: HistoryColumnId[];
  /** The commit whose details card is open, or null. */
  selectedOid: string | null;
  onSelect: (oid: string, button: HTMLButtonElement) => void;
};

const SHORT_OID_LENGTH = 7;

type CommitText = { preview: string; exactDate: string };

/**
 * The text of a commit that a row shows. A commit never changes, so its text is read once, even
 * when its row unmounts and mounts again as the list scrolls.
 */
const commitTexts = new WeakMap<GitHistoryCommit, CommitText>();
const commitText = (commit: GitHistoryCommit): CommitText => {
  let text = commitTexts.get(commit);
  if (!text) {
    text = {
      preview: commitBodyPreview(commit.message),
      exactDate: formatExactCommitDate(commit.authorDate),
    };
    commitTexts.set(commit, text);
  }
  return text;
};

export function HistoryRowView({
  index,
  style,
  ariaAttributes,
  rows,
  footer,
  ...props
}: RowComponentProps<HistoryRowProps>): ReactElement {
  const row = rows[index];
  return (
    // A row that moves for a new commit slides to its new place.
    <div
      style={style}
      {...ariaAttributes}
      className="flex min-w-0 transition-transform duration-200 ease-out motion-reduce:transition-none"
    >
      {row ? <HistoryCommitRow row={row} {...props} /> : <HistoryFooterRow footer={footer} />}
    </div>
  );
}

function HistoryCommitRow({
  row,
  graph,
  comparison,
  targetLabel,
  nowMs,
  columns,
  selectedOid,
  onSelect,
  entering,
}: Omit<HistoryRowProps, "rows" | "footer"> & { row: GraphRow }): ReactElement {
  const { commit } = row;
  const color = laneColor(commit.membership, row.color);
  const { preview, exactDate } = commitText(commit);
  const refGroups = useMemo(
    () => historyRefGroups(commit, comparison, targetLabel),
    [commit, comparison, targetLabel],
  );
  const isSelected = selectedOid === commit.oid;
  const cell: CellInput = { row, graph, color, refGroups, nowMs, exactDate, preview };
  return (
    <button
      type="button"
      className={cn(
        "group/history-row flex h-full w-full min-w-0 cursor-pointer items-center text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-[state=open]:bg-muted",
        entering.has(commit.oid) && "motion-safe:animate-[history-row-enter_200ms_ease-out]",
      )}
      aria-label={`${membershipLabel(commit.membership)} commit ${commit.subject} by ${commit.authorName}, ${exactDate}`}
      aria-haspopup="dialog"
      aria-expanded={isSelected}
      data-state={isSelected ? "open" : "closed"}
      data-testid="agent-studio-git-history-row"
      onClick={(event) => onSelect(commit.oid, event.currentTarget)}
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
  );
}

type CellInput = {
  row: GraphRow;
  graph: GraphView;
  color: string;
  refGroups: HistoryRefGroup[];
  nowMs: number;
  exactDate: string;
  preview: string;
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
  const { row, graph, color, refGroups, nowMs, exactDate, preview } = input;
  const { commit } = row;
  const width = historyColumnWidth(id, graph.viewWidth) ?? undefined;
  const fixed = "flex h-full shrink-0 items-center overflow-hidden";
  switch (id) {
    case "graph":
      return <HistoryGraphCell row={row} graph={graph} connectFromLeft={labelsOnLeft} />;
    case "message":
      return <MessageCell commit={commit} preview={preview} />;
    case "refs":
      return (
        <span className={cn(fixed, "px-1.5")} style={{ width }}>
          <HistoryRefsCell groups={refGroups} color={color} />
        </span>
      );
    case "author":
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
            initialsClassName="text-[7px] text-background"
          />
          <span className="min-w-0 truncate">{commit.authorName}</span>
        </span>
      );
    case "sha":
      return (
        <code
          className={cn(fixed, "px-2 font-mono text-[11px] text-muted-foreground")}
          style={{ width }}
          title={commit.oid}
        >
          {commit.oid.slice(0, SHORT_OID_LENGTH)}
        </code>
      );
    case "date":
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
}

/** The subject, then the body as one muted line. */
function MessageCell({
  commit,
  preview,
}: {
  commit: GitHistoryCommit;
  preview: string;
}): ReactElement {
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
