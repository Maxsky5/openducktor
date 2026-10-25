import { type BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import type { PullRequestReviewActivity } from "@openducktor/contracts";
import { useMinuteClock } from "@openducktor/frontend-core/lib/relative-time";
import { repositoryGitProviderContextQueryOptionsOrSkip } from "@openducktor/frontend-core/queries/git-provider-context";
import {
  type PullRequestReviewContextQueryInput,
  pullRequestReviewContextQueryOptions,
} from "@openducktor/frontend-core/queries/pull-request-review";
import {
  type PullRequestCommentAuthorFilter,
  useHideResolvedComments,
} from "@openducktor/frontend-core/review/pull-request-comment-filters";
import { TASK_EXECUTION_CI_PANEL_COPY } from "@openducktor/frontend-core/review/task-execution-ci-panel-copy";
import { FlashList, type ListRenderItem } from "@shopify/flash-list";
import { useQuery } from "@tanstack/react-query";
import { Stack, useIsFocused } from "expo-router";
import { type ReactElement, useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTaskOwnerResolution } from "@/features/work-owner/use-task-owner-resolution";
import { useWorkOwnerRef } from "@/features/work-owner/use-work-owner-ref";
import type { WorkOwnerRef } from "@/features/work-owner/work-owner-params";
import { useCommandGate } from "@/host-session/active-session-context";
import { useLinkOpener } from "@/rich-content/links/use-link-opener";
import { useAppTheme } from "@/theme/app-theme-context";
import { IconButton } from "@/ui/icon-button";
import { Screen, useScreenEndSpace } from "@/ui/screen";
import { Callout } from "@/ui/callout";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { ListRefreshControl } from "@/ui/refresh-control";
import { usePullRefresh } from "@/ui/use-pull-refresh";
import { CiCommentCard } from "./checks-comment-card";
import {
  buildChecksListItems,
  type ChecksListItem,
  type ChecksSections,
  type CiChecksStateAction,
  ciChecksViewState,
  ciReviewAvailability,
  ciReviewQueryInput,
  commentChoiceKey,
  isCommentOpen,
  type LoadedPullRequestReviewContext,
  OPEN_CHECKS_SECTIONS,
} from "./checks-model";
import { ChecksPanelState, PullRequestChip } from "./checks-parts";
import { CheckRow, ChecksHeaderRow, ChecksListNote, CommentsHeaderRow } from "./checks-rows";

const STATE_ACTION_LABELS = {
  retry: { label: "Retry", pendingLabel: "Retrying" },
  refresh: { label: "Refresh", pendingLabel: "Refreshing" },
} as const satisfies Record<CiChecksStateAction, { label: string; pendingLabel: string }>;

const INACTIVE_QUERY_INPUT: PullRequestReviewContextQueryInput = {
  repoPath: "__inactive_pr_review__",
  taskId: "__inactive__",
};

/**
 * The CI Checks view of a task, as the desktop CI panel: the pull request, its checks, and its
 * review comments. Read-only.
 */
export function ChecksScreen(): ReactElement {
  const ownerRef = useWorkOwnerRef();
  if (ownerRef?.kind !== "task") {
    return (
      <Screen>
        <Stack.Screen options={{ title: "CI Checks" }} />
        <ChecksPanelState
          kind="empty"
          title="Incomplete Link"
          message="CI Checks belong to a task. Open them again from the task."
        />
      </Screen>
    );
  }
  return <ChecksForTask ownerRef={ownerRef} />;
}

function ChecksForTask({
  ownerRef,
}: {
  ownerRef: Extract<WorkOwnerRef, { kind: "task" }>;
}): ReactElement {
  const { resolution, retry } = useTaskOwnerResolution(ownerRef);
  if (resolution.status === "ready") {
    return (
      <ChecksContent repoPath={resolution.owner.workspace.repoPath} task={resolution.owner.task} />
    );
  }
  return (
    <Screen>
      <Stack.Screen options={{ title: "CI Checks" }} />
      {resolution.status === "loading" ? (
        <ChecksPanelState {...TASK_EXECUTION_CI_PANEL_COPY.loading} />
      ) : (
        <ChecksPanelState
          kind="error"
          title={resolution.title}
          message={resolution.message}
          action={{ label: "Retry", pendingLabel: "Retrying", pending: false, onPress: retry }}
        />
      )}
    </Screen>
  );
}

function ChecksContent({ repoPath, task }: { repoPath: string; task: TaskCard }): ReactElement {
  const focused = useIsFocused();
  const gate = useCommandGate();
  const provider = useQuery(repositoryGitProviderContextQueryOptionsOrSkip(repoPath));
  const providerRead = {
    data: provider.data,
    error: provider.error,
    isPending: provider.isPending,
  };
  const availability = ciReviewAvailability(providerRead, task.pullRequest);
  const queryInput = ciReviewQueryInput({
    repoPath,
    taskId: task.id,
    pullRequest: task.pullRequest,
    unavailableReason: availability.unavailableReason,
  });
  const review = useQuery({
    ...pullRequestReviewContextQueryOptions(queryInput ?? INACTIVE_QUERY_INPUT),
    enabled: focused && queryInput !== null,
  });
  const state = ciChecksViewState({
    provider: providerRead,
    pullRequest: task.pullRequest,
    review: { data: review.data, error: review.error, isPending: review.isPending },
  });
  const { refetch: refetchProvider } = provider;
  const { refetch: refetchReview } = review;
  const isFetching = provider.isFetching || review.isFetching;
  const readsReview = queryInput !== null;
  // Refresh reads the provider again too, so a failed provider read can recover.
  const refresh = useCallback(
    () => Promise.all([refetchProvider(), readsReview ? refetchReview() : null]),
    [readsReview, refetchProvider, refetchReview],
  );
  const pressRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);
  // The pull gesture shows its own progress. Reads that start on focus show none.
  const { pulling, pull: pullRefresh } = usePullRefresh(refresh);
  const headerRight = useCallback(
    () =>
      queryInput ? (
        <IconButton
          icon="refresh"
          accessibilityLabel={isFetching ? "Refreshing CI checks" : "Refresh CI checks"}
          onPress={pressRefresh}
          command
          disabled={isFetching}
        />
      ) : null,
    [isFetching, pressRefresh, queryInput],
  );
  let content: ReactElement;
  if (state.kind === "loaded") {
    content = (
      <LoadedChecks
        context={state.context}
        refreshError={state.refreshError}
        refreshing={pulling}
        onRefresh={gate.open ? pullRefresh : undefined}
      />
    );
  } else if (state.kind === "loading") {
    content = <ChecksPanelState {...state.copy} />;
  } else {
    content = (
      <ChecksPanelState
        {...state.copy}
        action={
          state.action === null
            ? undefined
            : { ...STATE_ACTION_LABELS[state.action], pending: isFetching, onPress: pressRefresh }
        }
      />
    );
  }
  return (
    <Screen>
      <Stack.Screen options={{ title: "CI Checks", headerRight }} />
      {content}
    </Screen>
  );
}

function LoadedChecks({
  context,
  refreshError,
  refreshing,
  onRefresh,
}: {
  context: LoadedPullRequestReviewContext;
  refreshError: string | null;
  refreshing: boolean;
  /** Undefined while host commands are closed, so the list has no pull to refresh. */
  onRefresh: (() => void) | undefined;
}): ReactElement {
  const theme = useAppTheme();
  const endSpace = useScreenEndSpace(theme.space.xxxl);
  const openLink = useLinkOpener(undefined);
  const now = useMinuteClock();
  const [filter, setFilter] = useState<PullRequestCommentAuthorFilter>("all");
  const { hideResolved, setHideResolved } = useHideResolvedComments();
  const [sections, setSections] = useState<ChecksSections>(OPEN_CHECKS_SECTIONS);
  const [openChecks, setOpenChecks] = useState<ReadonlySet<string>>(() => new Set());
  const [commentChoices, setCommentChoices] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  const items = useMemo(
    () => buildChecksListItems(context, filter, hideResolved, sections),
    [context, filter, hideResolved, sections],
  );
  const toggleChecks = useCallback(
    () => setSections((current) => ({ ...current, checks: !current.checks })),
    [],
  );
  const toggleComments = useCallback(
    () => setSections((current) => ({ ...current, comments: !current.comments })),
    [],
  );
  const toggleCheck = useCallback((key: string) => {
    setOpenChecks((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const toggleComment = useCallback((comment: PullRequestReviewActivity) => {
    setCommentChoices((current) => {
      const next = new Map(current);
      next.set(commentChoiceKey(comment), !isCommentOpen(comment, current));
      return next;
    });
  }, []);
  const renderItem = useCallback<ListRenderItem<ChecksListItem>>(
    ({ item }) => {
      switch (item.kind) {
        case "checks_header":
          return (
            <ChecksHeaderRow
              aggregateStatus={item.aggregateStatus}
              summary={item.summary}
              open={item.open}
              onToggle={toggleChecks}
            />
          );
        case "no_checks":
          return <ChecksListNote text="No checks reported." inset />;
        case "check":
          return (
            <CheckRow
              rowKey={item.key}
              check={item.check}
              open={openChecks.has(item.key)}
              now={now}
              onToggle={toggleCheck}
              onOpenLink={openLink}
            />
          );
        case "comments_header":
          return (
            <CommentsHeaderRow
              total={item.total}
              counts={item.counts}
              open={item.open}
              filter={filter}
              hideResolved={hideResolved}
              onToggle={toggleComments}
              onFilterChange={setFilter}
              onHideResolvedChange={setHideResolved}
            />
          );
        case "no_comments":
          return <ChecksListNote text={item.text} inset={false} />;
        case "comment":
          return (
            <CiCommentCard
              comment={item.comment}
              open={isCommentOpen(item.comment, commentChoices)}
              now={now}
              onToggle={toggleComment}
              onOpenLink={openLink}
            />
          );
      }
    },
    [
      commentChoices,
      filter,
      hideResolved,
      now,
      openChecks,
      openLink,
      setHideResolved,
      toggleCheck,
      toggleChecks,
      toggleComment,
      toggleComments,
    ],
  );
  return (
    <FlashList
      data={items}
      renderItem={renderItem}
      keyExtractor={keyOf}
      getItemType={typeOf}
      extraData={renderItem}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        onRefresh ? <ListRefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined
      }
      ListHeaderComponent={
        <>
          {refreshError ? (
            <View style={styles.notice}>
              <Callout
                tone="destructive"
                title="Refresh failed"
                message={`${refreshError} The list shows the last loaded checks.`}
              />
            </View>
          ) : null}
          <PullRequestHeader context={context} onOpen={openLink} />
        </>
      }
      // The safe area sets this end padding. It changes only on rotation and moves no row.
      // react-doctor-disable-next-line react-doctor/rn-scrollview-dynamic-padding
      contentContainerStyle={{ paddingBottom: endSpace }}
    />
  );
}

const keyOf = (item: ChecksListItem): string => item.key;
const typeOf = (item: ChecksListItem): string => item.kind;

/**
 * The pull request above the checks, as the desktop CI panel header: the title, the pull request
 * link with its status, and the time of the last read.
 */
function PullRequestHeader({
  context,
  onOpen,
}: {
  context: LoadedPullRequestReviewContext;
  onOpen: (url: string) => void;
}): ReactElement {
  const { pullRequest } = context;
  const openPullRequest = () => onOpen(pullRequest.url);
  return (
    <View style={styles.header}>
      <Touchable
        feedback="opacity"
        onPress={openPullRequest}
        accessibilityRole="link"
        accessibilityLabel={pullRequest.title}
        accessibilityHint="Opens the pull request in the device browser."
      >
        <Text variant="body" weight="medium" numberOfLines={3} style={styles.title}>
          {pullRequest.title}
        </Text>
      </Touchable>
      <View style={styles.meta}>
        <PullRequestChip
          state={pullRequest.state}
          number={pullRequest.number}
          onPress={openPullRequest}
        />
        <Text variant="caption2" weight="regular" tabular style={styles.updated}>
          {`Updated ${new Date(context.refreshedAt).toLocaleTimeString()}`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  notice: { paddingHorizontal: theme.layout.screenPadding, paddingTop: theme.space.sm },
  header: {
    gap: theme.space.sm,
    paddingHorizontal: theme.layout.screenPadding,
    paddingTop: theme.space.sm,
    paddingBottom: theme.space.md,
    borderBottomWidth: theme.hairline,
    borderBottomColor: theme.desktop.border,
  },
  title: { color: theme.desktop.foreground },
  meta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.space.sm },
  updated: { color: theme.desktop.mutedForeground },
}));
