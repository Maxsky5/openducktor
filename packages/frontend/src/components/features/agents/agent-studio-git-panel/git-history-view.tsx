import type { GitCurrentBranch, GitHistoryComparison } from "@openducktor/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  memo,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { List } from "react-window";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import { gitHistoryQueryOptions } from "@/state/queries/git";
import {
  historyColumnLeft,
  useHistoryColumnsStore,
  visibleHistoryColumns,
} from "./git-history-columns";
import { HistoryCommitPopover } from "./git-history-commit-details";
import { GRAPH_OFFSET_PROPERTY, ROW_HEIGHT, useGraphView } from "./git-history-graph";
import { HistoryColumnsHeader } from "./git-history-header";
import { type GraphLayout, type GraphRow, layoutHistoryGraph } from "./git-history-graph-model";
import {
  type HistoryFooter,
  HistoryLoading,
  HistoryMessage,
  HistoryRefreshFailure,
  HistoryRelation,
  historyFooter,
  RetainedHistoryMessage,
} from "./git-history-messages";
import { type HistoryRowProps, HistoryRowView } from "./git-history-row";

export type GitHistoryViewProps = {
  repoPath: string | null;
  workingDir: string | null;
  checkout: GitCurrentBranch | null;
  /** The resolved comparison ref, or null while the comparison is unavailable. */
  targetReference: string | null;
  targetLabel: string;
  comparisonUnavailableReason: string | null;
};

export const GitHistoryView = memo(function GitHistoryView(
  props: GitHistoryViewProps,
): ReactElement {
  const { repoPath, workingDir, checkout, targetReference } = props;
  if (props.comparisonUnavailableReason || !targetReference) {
    return (
      <HistoryMessage title="History is unavailable" tone="muted">
        {props.comparisonUnavailableReason ??
          "Choose a target branch to compare History. Use Refresh to fetch it again."}
      </HistoryMessage>
    );
  }
  if (!repoPath || !workingDir || !checkout) {
    return <HistoryLoading label="Reading the current branch..." />;
  }
  return (
    <GitHistoryComparisonView
      {...props}
      repoPath={repoPath}
      workingDir={workingDir}
      checkout={checkout}
      targetReference={targetReference}
    />
  );
});

function GitHistoryComparisonView({
  repoPath,
  workingDir,
  checkout,
  targetReference,
  targetLabel,
}: GitHistoryViewProps & {
  repoPath: string;
  workingDir: string;
  checkout: GitCurrentBranch;
  targetReference: string;
}): ReactElement {
  const history = useInfiniteQuery(
    gitHistoryQueryOptions({ repoPath, workingDir, checkout, targetReference }),
  );
  const firstPage = history.data?.pages[0];
  const commits = useMemo(
    () =>
      history.data?.pages.flatMap((page) => (page.outcome === "page" ? page.commits : [])) ?? [],
    [history.data],
  );
  // Ages count from the read, so rendering stays pure and the rows stay stable. The graph of the
  // previous commit has no read time while the new graph loads, so the ages keep the last one.
  const [readAt, setReadAt] = useState(history.dataUpdatedAt);
  if (history.dataUpdatedAt > readAt) setReadAt(history.dataUpdatedAt);
  // The current branch keeps its own lane, apart from the commits that the target merged.
  const layout = useMemo(() => layoutHistoryGraph(commits, { tipLane: "dedicated" }), [commits]);
  const currentLabel = checkout.detached ? "Detached HEAD" : (checkout.name ?? "Current branch");
  const { fetchNextPage } = history;
  // A page load during a refresh joins that refresh instead of cancelling it.
  const loadNext = useCallback(() => void fetchNextPage({ cancelRefetch: false }), [fetchNextPage]);
  // A stable footer keeps the rows of the list from rendering again for an unrelated change.
  const footer = useMemo(
    () =>
      historyFooter({
        isFetchingNextPage: history.isFetchingNextPage,
        isFetchNextPageError: history.isFetchNextPageError,
        isRefetchError: history.isRefetchError,
        hasNextPage: history.hasNextPage,
        error: history.error,
        loadNext,
      }),
    [
      history.error,
      history.hasNextPage,
      history.isFetchNextPageError,
      history.isFetchingNextPage,
      history.isRefetchError,
      loadNext,
    ],
  );

  if (history.isPending) return <HistoryLoading label="Loading History..." />;
  if (history.isError && !firstPage) {
    return (
      <HistoryMessage title="History could not load" tone="error">
        {errorMessage(history.error)}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => void history.refetch()}
        >
          Retry
        </Button>
      </HistoryMessage>
    );
  }
  // A failed refresh keeps the last loaded result, so the view marks that result as old.
  const refreshFailure = history.isRefetchError ? (
    <HistoryRefreshFailure
      message={errorMessage(history.error)}
      isRefreshing={history.isRefetching}
      onRefresh={() => void history.refetch()}
    />
  ) : null;
  if (!firstPage || firstPage.outcome === "no_commits") {
    return (
      <RetainedHistoryMessage refreshFailure={refreshFailure}>
        <HistoryMessage title="No commits yet" tone="muted">
          This branch has no commits. Stage changes and make the first commit to start its History.
        </HistoryMessage>
      </RetainedHistoryMessage>
    );
  }
  if (firstPage.outcome === "no_common_ancestor") {
    return (
      <RetainedHistoryMessage refreshFailure={refreshFailure}>
        <HistoryMessage title="No shared history" tone="muted">
          {firstPage.shallow
            ? `This clone has incomplete history, so ${currentLabel} and ${targetLabel} show no common commit. Fetch more history to compare them.`
            : `${currentLabel} and ${targetLabel} have no common ancestor.`}
        </HistoryMessage>
      </RetainedHistoryMessage>
    );
  }

  return (
    <HistoryCommitList
      comparison={firstPage.comparison}
      layout={layout}
      currentLabel={currentLabel}
      targetLabel={targetLabel}
      footer={footer}
      nowMs={readAt}
      refreshFailure={refreshFailure}
    />
  );
}

/** The width of an element, or 0 before the first measure. */
function useObservedWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** A row keeps its element for its commit, so a new commit above it moves the row, not its content. */
const historyRowKey = (index: number, { rows }: HistoryRowProps): string =>
  rows[index]?.commit.oid ?? "footer";

const NO_COMMITS: ReadonlySet<string> = new Set();

/**
 * The commits that the last read added. They fade in while the other rows slide to their place.
 * The first rows of a list show at once.
 */
function useEnteringCommits(rows: GraphRow[]): ReadonlySet<string> {
  const [shown, setShown] = useState({ rows, entering: NO_COMMITS });
  if (shown.rows !== rows) {
    const before = new Set(shown.rows.map((row) => row.commit.oid));
    const added = rows.filter((row) => !before.has(row.commit.oid));
    setShown({
      rows,
      entering: before.size === 0 ? NO_COMMITS : new Set(added.map((row) => row.commit.oid)),
    });
  }
  return shown.entering;
}

function HistoryCommitList({
  comparison,
  layout,
  currentLabel,
  targetLabel,
  footer,
  nowMs,
  refreshFailure,
}: {
  comparison: GitHistoryComparison;
  layout: GraphLayout;
  currentLabel: string;
  targetLabel: string;
  footer: HistoryFooter;
  nowMs: number;
  refreshFailure: ReactNode;
}): ReactElement {
  const [measure, rowWidth] = useObservedWidth();
  const { graph, scroller } = useGraphView(layout.laneCount, rowWidth);
  const order = useHistoryColumnsStore((state) => state.order);
  const hidden = useHistoryColumnsStore((state) => state.hidden);
  const columns = useMemo(() => visibleHistoryColumns({ order, hidden }), [hidden, order]);
  const entering = useEnteringCommits(layout.rows);
  const [selectedOid, setSelectedOid] = useState<string | null>(null);
  const selectedButton = useRef<HTMLButtonElement | null>(null);
  const onSelect = useCallback((oid: string, button: HTMLButtonElement) => {
    selectedButton.current = button;
    setSelectedOid((current) => (current === oid ? null : oid));
  }, []);
  const closeDetails = useCallback(() => setSelectedOid(null), []);
  const selectedRow = selectedOid
    ? (layout.rows.find((row) => row.commit.oid === selectedOid) ?? null)
    : null;
  const rowsLength = layout.rows.length;
  const onRowsRendered = useCallback(
    ({ stopIndex }: { stopIndex: number }) => {
      if (stopIndex >= rowsLength - 10 && footer.kind === "more") footer.load();
    },
    [footer, rowsLength],
  );
  // The rows read the sideways scroll from CSS, so a scroll does not render them again.
  const showGraphOffset = useCallback(
    (scrollLeft: number) =>
      measure.current?.style.setProperty(GRAPH_OFFSET_PROPERTY, `${scrollLeft}px`),
    [measure],
  );
  const attachScroller = useCallback(
    (element: HTMLDivElement | null) => {
      scroller.current = element;
      // A new scroller starts at its own position, not at the offset of an old one.
      if (element) showGraphOffset(element.scrollLeft);
    },
    [scroller, showGraphOffset],
  );
  return (
    <div
      ref={measure}
      className="@container/history flex h-full min-h-0 flex-col"
      data-testid="agent-studio-git-history"
    >
      {refreshFailure}
      <HistoryRelation
        comparison={comparison}
        currentLabel={currentLabel}
        targetLabel={targetLabel}
      />
      <HistoryColumnsHeader columns={columns} graphWidth={graph.viewWidth} />
      <List
        aria-label={`Commits of ${currentLabel} compared with ${targetLabel}`}
        className="h-0 min-h-0 flex-1 overflow-x-hidden"
        defaultHeight={400}
        rowComponent={HistoryRowView}
        rowCount={layout.rows.length + (footer.kind === "end" ? 0 : 1)}
        rowHeight={ROW_HEIGHT}
        rowKey={historyRowKey}
        rowProps={{
          rows: layout.rows,
          entering,
          graph,
          comparison,
          targetLabel,
          footer,
          nowMs,
          columns,
          selectedOid,
          onSelect,
        }}
        overscanCount={8}
        onRowsRendered={onRowsRendered}
        // An open card follows its row, so a scroll closes it before its row leaves the view.
        onScroll={selectedOid ? closeDetails : undefined}
      />
      <HistoryCommitPopover
        row={selectedRow}
        anchor={selectedButton}
        comparison={comparison}
        currentLabel={currentLabel}
        targetLabel={targetLabel}
        nowMs={nowMs}
        onClose={closeDetails}
      />
      {columns.includes("graph") && graph.viewWidth < graph.width ? (
        <div
          ref={attachScroller}
          role="region"
          aria-label="Commit graph lanes"
          tabIndex={0}
          className="shrink-0 overflow-x-auto overflow-y-hidden border-t border-border/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          style={{
            width: graph.viewWidth,
            marginLeft: historyColumnLeft(columns, "graph", graph.viewWidth, rowWidth),
          }}
          onScroll={(event) => showGraphOffset(event.currentTarget.scrollLeft)}
          data-testid="agent-studio-git-history-graph-scroll"
        >
          <div className="h-px" style={{ width: graph.width }} />
        </div>
      ) : null}
    </div>
  );
}
