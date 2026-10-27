import { type BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import type { WorkspaceRecord } from "@openducktor/contracts";
import {
  TasksStateContext,
  useRequiredContext,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { repositoryGitProviderContextQueryOptions } from "@openducktor/frontend-core/queries/git-provider-context";
import { loadAgentSessionListFromQuery } from "@openducktor/frontend-core/queries/agent-sessions";
import { gitProviderReadError } from "@openducktor/frontend-core/review/git-provider-health";
import { canDetectTaskPullRequest } from "@openducktor/frontend-core/tasks/presentation/task-display";
import { resolveTaskPullRequestActions } from "@openducktor/frontend-core/tasks/pull-requests/pull-request-presentation";
import { FlashList, type ListRenderItem } from "@shopify/flash-list";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type NativeStackNavigationOptions, Stack, useRouter } from "expo-router";
import { type ReactElement, useCallback, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { TaskReadError } from "@/features/workflow/close/task-close-content";
import { useTaskOwnerResolution } from "@/features/work-owner/use-task-owner-resolution";
import type { ResolvedTaskOwner } from "@/features/work-owner/work-owner-model";
import { routes } from "@/navigation/routes";
import { useTabBarSpace } from "@/navigation/tab-bar/tab-bar-metrics";
import { useListViewport, ViewportProvider } from "@/rich-content/viewport/use-in-viewport";
import { useAppTheme } from "@/theme/app-theme-context";
import { ErrorState, LoadingState } from "@/ui/states";
import { ListRefreshControl } from "@/ui/refresh-control";
import { useScreenEndSpace } from "@/ui/screen";
import { usePullRefresh } from "@/ui/use-pull-refresh";
import { useCompactHeight } from "@/ui/use-wide-layout";
import { useRepoTask } from "@/features/work-owner/use-repo-task";
import { buildDocumentRows } from "../documents/document-rows";
import { useTaskDescriptionSource } from "../documents/use-task-document-sources";
import { TaskPrimaryAction } from "./task-actions-panel";
import {
  buildTaskDetailsRows,
  type DetailsRow,
  detailsRowKey,
  detailsRowType,
  useCollapsedDetailsSections,
} from "./task-details-rows";
import { TaskDetailsRowView, type TaskDetailsRowContext } from "./task-details-row-view";
import { type SummaryPullRequestActions, TaskSummary } from "./task-summary";
import { taskWorkflowSteps } from "./task-workflow-model";
import { TaskWorkflowRail } from "./task-workflow-rail";
import { useTaskSessionGroups } from "./use-task-session-groups";
import { useTaskDetailsActions } from "./use-task-details-actions";
import { useTaskWorkspaceScope } from "./use-task-workspace-scope";

/**
 * The navigation bar takes the card color of the details header under it, so both read as one
 * band, as the desktop details header. The cards below sit on the grouped background.
 */
const detailsHeaderOptions = (
  header: string,
  background: string,
): NativeStackNavigationOptions => ({
  headerStyle: { backgroundColor: header },
  headerLargeStyle: { backgroundColor: header },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: background },
});

/**
 * Task details: the task, its next workflow action, its description, its facts, its sessions,
 * and its work views. Other actions are in the actions menu. `embedded` shows it next to the
 * board on wide screens, where the menu shows next to the title.
 */
export function TaskDetailsView({
  workspaceId,
  taskId,
  embedded = false,
}: {
  workspaceId: string;
  taskId: string;
  embedded?: boolean;
}): ReactElement {
  const ownerRef = useMemo(
    () => ({ kind: "task" as const, workspaceId, taskId }),
    [taskId, workspaceId],
  );
  const { resolution, retry } = useTaskOwnerResolution(ownerRef);
  // A Delete that the user confirmed here keeps its task on screen until the screen leaves, also
  // when the task stream removes the task before the host replies. The confirmation then closes in
  // place, and the screen leaves once, without a Task Not Found state.
  const [deleting, setDeleting] = useState<ResolvedTaskOwner | null>(null);
  const theme = useAppTheme();
  const grouped = theme.colors.groupedBackground;
  const card = theme.desktop.card;
  const stateOptions = useMemo(
    () => ({ ...detailsHeaderOptions(card, grouped), title: taskId }),
    [card, grouped, taskId],
  );
  const content = (owner: ResolvedTaskOwner) => (
    <TaskDetailsContent
      workspace={owner.workspace}
      task={owner.task}
      embedded={embedded}
      onDeleteStarted={() => setDeleting(owner)}
      onDeleteFailed={() => setDeleting(null)}
    />
  );
  if (resolution.status !== "ready" && deleting) return content(deleting);
  if (resolution.status === "loading") {
    return (
      <>
        {embedded ? null : <Stack.Screen options={stateOptions} />}
        <LoadingState label={resolution.label} />
      </>
    );
  }
  if (resolution.status === "error") {
    return (
      <>
        {embedded ? null : <Stack.Screen options={stateOptions} />}
        {resolution.canRetry ? (
          <ErrorState title={resolution.title} message={resolution.message} onRetry={retry} />
        ) : (
          <ErrorState title={resolution.title} message={resolution.message} />
        )}
      </>
    );
  }
  return content(resolution.owner);
}

function TaskDetailsContent({
  workspace,
  task,
  embedded,
  onDeleteStarted,
  onDeleteFailed,
}: {
  workspace: WorkspaceRecord;
  task: TaskCard;
  embedded: boolean;
  /** The user confirmed Delete, and it runs. */
  onDeleteStarted: () => void;
  /** The Delete failed, and its confirmation closed. */
  onDeleteFailed: () => void;
}): ReactElement {
  const router = useRouter();
  const theme = useAppTheme();
  // The embedded details sit next to the board, above the tab bar.
  const tabBarSpace = useTabBarSpace({ automaticInsets: true });
  const screenEndSpace = useScreenEndSpace(theme.space.huge);
  const endSpace = embedded ? tabBarSpace : screenEndSpace;
  const { workspaceId, repoPath } = workspace;
  const {
    refreshTasks,
    unlinkPullRequest,
    unlinkingPullRequestTaskIds,
    syncPullRequests,
    detectingPullRequestTaskIds,
  } = useRequiredContext(TasksStateContext, "TaskDetailsContent");
  // The list that holds the task.
  const tasks = useRepoTask(repoPath, task.id).tasks ?? EMPTY_TASKS;
  const scope = useTaskWorkspaceScope(workspaceId, { selectOnFocus: !embedded });
  const provider = useQuery(repositoryGitProviderContextQueryOptions(repoPath));
  const providerReadError = gitProviderReadError(provider.error);
  const queryClient = useQueryClient();
  const {
    groups: sessionGroups,
    summaries,
    records,
    isLoadingHistory,
    historyError,
  } = useTaskSessionGroups(repoPath, task.id);
  const workflowSteps = useMemo(
    () => taskWorkflowSteps(task, sessionGroups),
    [sessionGroups, task],
  );
  const description = useTaskDescriptionSource(task, workspaceId, repoPath);
  // A low window, such as a phone in landscape, keeps the summary in a pane beside the sections,
  // so the workflow and the main action stay in view.
  const split = useCompactHeight() && !embedded;
  const sections = useCollapsedDetailsSections();
  const rows = useMemo(
    () =>
      buildTaskDetailsRows({
        summaryInList: !split,
        descriptionRows: buildDocumentRows([description]),
        collapsed: sections.collapsed,
      }),
    [description, sections.collapsed, split],
  );

  const refetchHistory = useCallback(
    () => loadAgentSessionListFromQuery(queryClient, repoPath, task.id, { forceFresh: true }),
    [queryClient, repoPath, task.id],
  );
  const refreshDetails = useCallback(async () => {
    await Promise.all([refreshTasks(), refetchHistory()]);
  }, [refetchHistory, refreshTasks]);
  const { pulling: refreshing, pull: refresh } = usePullRefresh(refreshDetails);

  const pullRequestActions = resolveTaskPullRequestActions(task, provider.data, providerReadError);
  const unlinking = unlinkingPullRequestTaskIds.has(task.id);
  const { primary, runAction, menu, worktreeReadError, confirmations } = useTaskDetailsActions({
    workspace,
    task,
    tasks,
    summaries,
    records,
    scopeReady: scope.ready,
    showUnlink: pullRequestActions.showUnlink,
    unlinking,
    embedded,
    onDeleteStarted,
    onDeleteFailed,
  });
  const detecting = detectingPullRequestTaskIds.has(task.id);
  // As on desktop, Detect PR also waits for a completed Builder.
  const showDetect = pullRequestActions.showDetect && canDetectTaskPullRequest(task);
  const summaryPullRequest = useMemo<SummaryPullRequestActions>(
    () => ({
      showDetect,
      detectDisabledReason: showDetect ? pullRequestActions.detectDisabledReason : null,
      detecting,
      onDetect: () => {
        void syncPullRequests(task.id);
      },
      showUnlink: pullRequestActions.showUnlink,
      unlinking,
      onUnlink: () => {
        void unlinkPullRequest(task.id);
      },
      enabled: scope.ready,
    }),
    [
      detecting,
      pullRequestActions.detectDisabledReason,
      pullRequestActions.showUnlink,
      scope.ready,
      showDetect,
      syncPullRequests,
      task.id,
      unlinkPullRequest,
      unlinking,
    ],
  );
  const summary = useMemo(
    () => (
      <TaskSummary task={task} pullRequest={summaryPullRequest} accessory={embedded ? menu : null}>
        <TaskWorkflowRail workspaceId={workspaceId} taskTitle={task.title} steps={workflowSteps} />
        <TaskPrimaryAction
          taskTitle={task.title}
          action={primary}
          enabled={scope.ready}
          blockedReason={scope.blockedReason}
          onAction={(action) => runAction(action.action)}
          onEdit={() => router.push(routes.editTask(workspaceId, task.id))}
        />
        {worktreeReadError ? <TaskReadError read={worktreeReadError} /> : null}
      </TaskSummary>
    ),
    [
      embedded,
      menu,
      primary,
      router,
      runAction,
      scope.blockedReason,
      scope.ready,
      summaryPullRequest,
      task,
      workflowSteps,
      workspaceId,
      worktreeReadError,
    ],
  );

  const historyErrorText = historyError ? errorMessage(historyError) : null;
  const rowContext = useMemo<TaskDetailsRowContext>(
    () => ({
      workspaceId,
      task,
      summary,
      sessionGroups,
      isLoadingHistory,
      historyError: historyErrorText,
      sections,
    }),
    [historyErrorText, isLoadingHistory, sections, sessionGroups, summary, task, workspaceId],
  );
  const renderItem = useCallback<ListRenderItem<DetailsRow>>(
    ({ item }) => <TaskDetailsRowView row={item} context={rowContext} />,
    [rowContext],
  );

  const grouped = theme.colors.groupedBackground;
  const card = theme.desktop.card;
  const screenOptions = useMemo<NativeStackNavigationOptions>(
    () => ({ ...detailsHeaderOptions(card, grouped), title: task.id, headerRight: () => menu }),
    [card, grouped, menu, task.id],
  );

  // Document images and isolated pages load near this viewport.
  const viewport = useListViewport();

  return (
    <ViewportProvider value={viewport.store}>
      <View ref={viewport.frameRef} style={styles.root} onLayout={viewport.onFrameLayout}>
        {embedded ? null : <Stack.Screen options={screenOptions} />}
        <View style={styles.split}>
          {split ? (
            <>
              <ScrollView
                style={styles.summaryPane}
                // The safe area sets this end padding. It changes only on rotation.
                // react-doctor-disable-next-line react-doctor/rn-scrollview-dynamic-padding
                contentContainerStyle={{ paddingBottom: endSpace }}
              >
                {summary}
              </ScrollView>
              <View style={styles.paneDivider} />
            </>
          ) : null}
          <View style={styles.root}>
            <FlashList
              data={rows}
              renderItem={renderItem}
              keyExtractor={detailsRowKey}
              getItemType={detailsRowType}
              onScroll={viewport.onScroll}
              scrollEventThrottle={32}
              contentInsetAdjustmentBehavior="automatic"
              // The safe area sets this end padding. It changes only on rotation and moves no row.
              // react-doctor-disable-next-line react-doctor/rn-scrollview-dynamic-padding
              contentContainerStyle={{ paddingBottom: endSpace }}
              refreshControl={<ListRefreshControl refreshing={refreshing} onRefresh={refresh} />}
            />
          </View>
        </View>
        {confirmations}
      </View>
    </ViewportProvider>
  );
}

const EMPTY_TASKS: TaskCard[] = [];

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1 },
  split: { flex: 1, flexDirection: "row" },
  summaryPane: {
    flexGrow: 0,
    width: "42%",
    maxWidth: 420,
    backgroundColor: theme.desktop.card,
  },
  paneDivider: { width: theme.hairline, backgroundColor: theme.desktop.border },
}));
