import type { GitCurrentBranch, GitHistoryComparison } from "@openducktor/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  memo,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { List } from "react-window";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import { gitHistoryQueryOptions } from "@/state/queries/git";
import { ROW_HEIGHT, useGraphView } from "./git-history-graph";
import { type GraphLayout, layoutHistoryGraph } from "./git-history-graph-model";
import {
  type HistoryFooter,
  HistoryLoading,
  HistoryMessage,
  HistoryRefreshFailure,
  historyFooter,
  RetainedHistoryMessage,
} from "./git-history-messages";
import { HistoryRowView } from "./git-history-row";

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
  const layout = useMemo(() => layoutHistoryGraph(commits), [commits]);
  const currentLabel = checkout.detached ? "Detached HEAD" : (checkout.name ?? "Current branch");

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

  const footer = historyFooter({
    isFetchingNextPage: history.isFetchingNextPage,
    isFetchNextPageError: history.isFetchNextPageError,
    isRefetchError: history.isRefetchError,
    hasNextPage: history.hasNextPage,
    error: history.error,
    // A page load during a refresh joins that refresh instead of cancelling it.
    loadNext: () => void history.fetchNextPage({ cancelRefetch: false }),
  });
  return (
    <HistoryCommitList
      comparison={firstPage.comparison}
      layout={layout}
      currentLabel={currentLabel}
      targetLabel={targetLabel}
      footer={footer}
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

function HistoryCommitList({
  comparison,
  layout,
  currentLabel,
  targetLabel,
  footer,
  refreshFailure,
}: {
  comparison: GitHistoryComparison;
  layout: GraphLayout;
  currentLabel: string;
  targetLabel: string;
  footer: HistoryFooter;
  refreshFailure: ReactNode;
}): ReactElement {
  const [measure, rowWidth] = useObservedWidth();
  const { setOffset, scroller, ...graph } = useGraphView(layout.laneCount, rowWidth);
  return (
    <div
      ref={measure}
      className="@container/history flex h-full min-h-0 flex-col"
      data-testid="agent-studio-git-history"
    >
      {refreshFailure}
      <List
        aria-label={`Commits of ${currentLabel} compared with ${targetLabel}`}
        className="h-0 min-h-0 flex-1 overflow-x-hidden"
        defaultHeight={400}
        rowComponent={HistoryRowView}
        rowCount={layout.rows.length + (footer.kind === "end" ? 0 : 1)}
        rowHeight={ROW_HEIGHT}
        rowProps={{
          rows: layout.rows,
          graph,
          comparison,
          currentLabel,
          targetLabel,
          footer,
          nowMs: Date.now(),
        }}
        overscanCount={8}
        onRowsRendered={({ stopIndex }) => {
          if (stopIndex >= layout.rows.length - 10 && footer.kind === "more") footer.load();
        }}
      />
      {graph.viewWidth < graph.width ? (
        <div
          ref={scroller}
          role="region"
          aria-label="Commit graph lanes"
          tabIndex={0}
          className="shrink-0 overflow-x-auto overflow-y-hidden border-t border-border/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          style={{ width: graph.viewWidth }}
          onScroll={(event) => setOffset(event.currentTarget.scrollLeft)}
          data-testid="agent-studio-git-history-graph-scroll"
        >
          <div className="h-px" style={{ width: graph.width }} />
        </div>
      ) : null}
    </div>
  );
}
