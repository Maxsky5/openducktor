import type { GitCurrentBranch, GitHistoryComparison } from "@openducktor/contracts";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  memo,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { List } from "react-window";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import { gitHistoryQueryOptions, refreshGitWorkingDirectory } from "@/state/queries/git";
import {
  historyColumnLeft,
  useHistoryColumnsStore,
  visibleHistoryColumns,
} from "./git-history-columns";
import { HistoryCommitPopover } from "./git-history-commit-details";
import { GRAPH_OFFSET_PROPERTY, ROW_HEIGHT, useGraphView } from "./git-history-graph";
import { HistoryColumnsHeader } from "./git-history-header";
import { type GraphLayout, layoutHistoryGraph } from "./git-history-graph-model";
import { type HistoryFooter, historyFooter } from "./git-history-footer";
import {
  HistoryLoading,
  HistoryMessage,
  HistoryRefreshFailure,
  RetainedHistoryMessage,
} from "./git-history-messages";
import { type HistoryRowProps, HistoryRowView } from "./git-history-row";

export type GitHistoryViewProps = {
  /**
   * The Git context and the chosen target. While the panel checks the same target again, such as
   * after a commit, History keeps the graph that it shows.
   */
  contextKey: string;
  /** True while the panel reads the branch or checks the comparison again. */
  pending: boolean;
  repoPath: string | null;
  workingDir: string | null;
  checkout: GitCurrentBranch | null;
  /** The resolved comparison ref, or null while the comparison is unavailable or pending. */
  targetReference: string | null;
  targetLabel: string;
  comparisonUnavailableReason: string | null;
};

type HistoryInputs = {
  repoPath: string;
  workingDir: string;
  checkout: GitCurrentBranch;
  targetReference: string;
};

const readyInputs = ({
  repoPath,
  workingDir,
  checkout,
  targetReference,
}: GitHistoryViewProps): HistoryInputs | null =>
  repoPath && workingDir && checkout && targetReference
    ? { repoPath, workingDir, checkout, targetReference }
    : null;

const sameInputs = (left: HistoryInputs, right: HistoryInputs): boolean =>
  left.repoPath === right.repoPath &&
  left.workingDir === right.workingDir &&
  left.targetReference === right.targetReference &&
  left.checkout.name === right.checkout.name &&
  left.checkout.detached === right.checkout.detached &&
  left.checkout.revision === right.checkout.revision;

/** The last ready inputs of a Git context and target. Another context starts without them. */
function useShownInputs(contextKey: string, ready: HistoryInputs | null): HistoryInputs | null {
  const [shown, setShown] = useState<{ contextKey: string; inputs: HistoryInputs } | null>(null);
  if (ready && (shown?.contextKey !== contextKey || !sameInputs(shown.inputs, ready))) {
    setShown({ contextKey, inputs: ready });
  }
  return shown?.contextKey === contextKey ? shown.inputs : null;
}

export const GitHistoryView = memo(function GitHistoryView(
  props: GitHistoryViewProps,
): ReactElement {
  const ready = readyInputs(props);
  const shown = useShownInputs(props.contextKey, ready);
  // A failed or missing comparison shows at once. A pending check keeps the shown graph.
  if (!props.pending && !ready && props.comparisonUnavailableReason) {
    return (
      <HistoryMessage title="History is unavailable" tone="muted">
        {props.comparisonUnavailableReason}
      </HistoryMessage>
    );
  }
  if (!props.pending && !props.targetReference) {
    return (
      <HistoryMessage title="History is unavailable" tone="muted">
        Choose a target branch to compare History. Use Refresh to fetch it again.
      </HistoryMessage>
    );
  }
  const inputs = ready ?? (props.pending ? shown : null);
  // The loader shows only while History has no graph to show.
  if (!inputs) return <HistoryLoading label="Loading History..." />;
  return <GitHistoryComparisonView {...inputs} targetLabel={props.targetLabel} />;
});

function GitHistoryComparisonView({
  repoPath,
  workingDir,
  checkout,
  targetReference,
  targetLabel,
}: HistoryInputs & { targetLabel: string }): ReactElement {
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
  const comparison = firstPage?.outcome === "page" ? firstPage.comparison : null;
  // The compared branches use the main colors. A branch that a rebase rewrites gets its own.
  const layout = useMemo(
    () =>
      layoutHistoryGraph(commits, {
        tipLane: "dedicated",
        mainTips: new Set(comparison ? [comparison.currentTip, comparison.targetTip] : []),
      }),
    [commits, comparison],
  );
  const currentLabel = checkout.detached ? "Detached HEAD" : (checkout.name ?? "Current branch");
  const queryClient = useQueryClient();
  // A retry reads the checkout too, so a branch that moved since the last read reads again.
  const retry = useCallback(() => {
    void refreshGitWorkingDirectory(queryClient, repoPath, workingDir).catch(() => undefined);
  }, [queryClient, repoPath, workingDir]);
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
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={retry}>
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
      onRefresh={retry}
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
/** How long a removed commit fades out before the other rows close the gap. */
const LEAVE_MS = 200;

type RowTransitions = {
  /** The layout of the last read. It shows after the removed commits fade out. */
  received: GraphLayout;
  shown: GraphLayout;
  /** Commits that the shown layout added. They fade in. */
  entering: ReadonlySet<string>;
  /** Commits that the received layout removed. They fade out. */
  leaving: ReadonlySet<string>;
};

/** The commits of `layout` that `oids` does not hold. */
const commitsMissingFrom = (
  layout: GraphLayout,
  oids: ReadonlySet<string>,
): ReadonlySet<string> => {
  const missing = layout.rows.filter((row) => !oids.has(row.commit.oid));
  return missing.length === 0 ? NO_COMMITS : new Set(missing.map((row) => row.commit.oid));
};

const commitOids = (layout: GraphLayout): ReadonlySet<string> =>
  new Set(layout.rows.map((row) => row.commit.oid));

const showLayout = (before: GraphLayout, next: GraphLayout): RowTransitions => ({
  received: next,
  shown: next,
  entering: before.rows.length === 0 ? NO_COMMITS : commitsMissingFrom(next, commitOids(before)),
  leaving: NO_COMMITS,
});

/**
 * Animates the commits that a read adds or removes. Removed commits fade out first. Then the new
 * rows show: the other rows slide to their place, and added commits fade in. The first rows of a
 * list show at once, and a reduced motion setting skips the fade-out.
 */
function useRowTransitions(layout: GraphLayout): RowTransitions {
  const [state, setState] = useState<RowTransitions>(() => ({
    received: layout,
    shown: layout,
    entering: NO_COMMITS,
    leaving: NO_COMMITS,
  }));
  if (state.received !== layout) {
    const leaving = commitsMissingFrom(state.shown, commitOids(layout));
    const instant =
      leaving.size === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setState(instant ? showLayout(state.shown, layout) : { ...state, received: layout, leaving });
  }
  useEffect(() => {
    if (state.shown === state.received) return;
    const timer = setTimeout(
      () => setState((current) => showLayout(current.shown, current.received)),
      LEAVE_MS,
    );
    return () => clearTimeout(timer);
  }, [state.received, state.shown]);
  return state;
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
  const { shown, entering, leaving } = useRowTransitions(layout);
  const { graph, scroller } = useGraphView(shown.laneCount, rowWidth);
  const order = useHistoryColumnsStore((state) => state.order);
  const hidden = useHistoryColumnsStore((state) => state.hidden);
  const columns = useMemo(() => visibleHistoryColumns({ order, hidden }), [hidden, order]);
  const [selectedOid, setSelectedOid] = useState<string | null>(null);
  const selectedButton = useRef<HTMLButtonElement | null>(null);
  const onSelect = useCallback((oid: string, button: HTMLButtonElement) => {
    selectedButton.current = button;
    setSelectedOid((current) => (current === oid ? null : oid));
  }, []);
  const closeDetails = useCallback(() => setSelectedOid(null), []);
  const selectedRow = selectedOid
    ? (shown.rows.find((row) => row.commit.oid === selectedOid) ?? null)
    : null;
  // A commit that leaves the list takes its selection with it, so its card cannot open again.
  if (selectedOid !== null && (!selectedRow || leaving.has(selectedOid))) setSelectedOid(null);
  const rowsLength = shown.rows.length;
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
      <HistoryColumnsHeader columns={columns} graphWidth={graph.viewWidth} />
      <List
        aria-label={`Commits of ${currentLabel} compared with ${targetLabel}`}
        className="h-0 min-h-0 flex-1 overflow-x-hidden"
        defaultHeight={400}
        rowComponent={HistoryRowView}
        rowCount={shown.rows.length + (footer.kind === "end" ? 0 : 1)}
        rowHeight={ROW_HEIGHT}
        rowKey={historyRowKey}
        rowProps={{
          rows: shown.rows,
          entering,
          leaving,
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
