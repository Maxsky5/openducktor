import type { WorkspaceRecord } from "@openducktor/contracts";
import type { KanbanColumnId } from "@openducktor/workflows";
import {
  type TaskWorkflowAction,
  type BuiltinTaskCard as TaskCardData,
  type BuiltinRoleId as AgentRole,
} from "@openducktor/workflows";
import { type NativeStackNavigationOptions, Stack, useRouter } from "expo-router";
import { type ReactElement, useCallback, useMemo, useState } from "react";
import { useWindowDimensions, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MergedPullRequestNotice } from "@/features/workflow/pull-requests/merged-pull-request-notice";
import { useTaskActions } from "@/features/workflow/use-task-actions";
import { SelectedWorkspaceGate } from "@/features/workspaces/no-open-workspace";
import { WorkspaceHeaderTitle } from "@/features/workspaces/workspace-header-title";
import { HostConnectionState, useHostUnavailable } from "@/host-session/host-connection-state";
import { routes } from "@/navigation/routes";
import { useSearchBarColors } from "@/navigation/stack-theme";
import { useAppTheme } from "@/theme/app-theme-context";
import { ActionMenu } from "@/ui/action-menu";
import { Button } from "@/ui/button";
import { IconButton } from "@/ui/icon-button";
import { Screen } from "@/ui/screen";
import { Icon } from "@/ui/icon";
import { EmptyState, ErrorState } from "@/ui/states";
import { Callout } from "@/ui/callout";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { useAnnounce } from "@/ui/use-announce";
import { usePullRefresh } from "@/ui/use-pull-refresh";
import { useWideLayout } from "@/ui/use-wide-layout";
import { useRunCreateAction, useWorkspaceCreateActions } from "../create-actions";
import { TaskDetailsView } from "../details/task-details-view";
import { BoardFilterButton } from "./board-filter-button";
import { filterSummary } from "./board-filter-controls";
import { type HeaderSearch, useHeaderSearch, useHeaderSearchText } from "./header-search";
import { resolveSelectedColumnId } from "./board-columns";
import { BoardFilterSheet } from "./board-filter-sheet";
import { BoardPager } from "./board-pager";
import { BoardSkeleton } from "./board-skeleton";
import { BoardWide, BoardWidePlaceholder } from "./board-wide";
import type { TaskCardModel } from "./task-card-model";
import { useBoardAvailability } from "./use-board-availability";
import { type TaskBoardView, taskBoardView } from "./task-board-state";
import { useTaskBoard } from "./use-task-board";

/** The board menu closes by itself after a choice. */
const keepMenu = (): void => {};

/** Wider screens also show the task details next to the board. */
const DETAIL_PANE_WIDTH = 1000;

function BoardHeaderActions({
  workspace,
  onRefresh,
}: {
  workspace: WorkspaceRecord;
  onRefresh: () => void;
}): ReactElement {
  // Import runs as the create fan runs it, so a blocked task store or provider says why.
  const importAction = useWorkspaceCreateActions(workspace).find(({ id }) => id === "import");
  const runCreateAction = useRunCreateAction(workspace.workspaceId, keepMenu);
  return (
    <View style={styles.headerActions}>
      <ActionMenu
        title="Tasks"
        items={[
          { id: "refresh", title: "Refresh Tasks", icon: "refresh" },
          { id: "import", title: importAction?.accessibilityLabel ?? "Import", icon: "arrow-down" },
        ]}
        onSelect={(id) => {
          if (id === "refresh") onRefresh();
          if (id === "import" && importAction) runCreateAction(importAction);
        }}
      >
        <IconButton
          icon="more"
          color="label"
          accessibilityLabel="More task actions"
          onPress={() => {}}
        />
      </ActionMenu>
    </View>
  );
}

/** The search and filter state of the board while a search or a filter hides tasks. */
function ActiveFilterBar({
  summary,
  onClear,
}: {
  summary: string;
  onClear: () => void;
}): ReactElement {
  const theme = useAppTheme();
  useAnnounce(summary);
  return (
    <View style={styles.filterBar}>
      <Icon name="filter" size={14} colorValue={theme.desktop.mutedForeground} />
      <Text
        variant="footnote"
        weight="medium"
        accessibilityLiveRegion="polite"
        style={styles.filterSummary}
        numberOfLines={1}
      >
        {summary}
      </Text>
      <Touchable
        feedback="opacity"
        onPress={onClear}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Clear the search and filters"
        style={styles.clear}
      >
        <Icon name="x" size={14} colorValue={theme.desktop.mutedForeground} />
        <Text variant="footnote" weight="medium" style={styles.clearLabel}>
          Clear
        </Text>
      </Touchable>
    </View>
  );
}

/** The Tasks tab: the board of the selected workspace. */
export function TaskBoardScreen(): ReactElement {
  const search = useHeaderSearch();
  return (
    <Screen background="grouped">
      <Stack.Screen options={{ title: "Tasks", headerTitle: () => <WorkspaceHeaderTitle /> }} />
      <SelectedWorkspaceGate>
        {(workspace) => (
          <TaskBoardContent key={workspace.workspaceId} workspace={workspace} search={search} />
        )}
      </SelectedWorkspaceGate>
    </Screen>
  );
}

function TaskBoardContent({
  workspace,
  search,
}: {
  workspace: WorkspaceRecord;
  search: HeaderSearch;
}): ReactElement {
  const router = useRouter();
  const { width } = useWindowDimensions();
  // Tablets and wide landscape show several columns side by side.
  const wide = useWideLayout();
  const withDetails = width >= DETAIL_PANE_WIDTH;
  const board = useTaskBoard(workspace);
  const hostUnavailable = useHostUnavailable();
  const { creationBlockedReason } = useBoardAvailability(workspace);
  const actions = useTaskActions({ workspace, tasks: board.allTasks });
  const [chosenColumn, setChosenColumn] = useState<KanbanColumnId | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const selectedColumn = resolveSelectedColumnId(board.columns, chosenColumn);
  const shownTaskId =
    withDetails && selectedTaskId && board.allTasks.some((task) => task.id === selectedTaskId)
      ? selectedTaskId
      : null;
  const { filter } = board;

  const onOpenDetails = useCallback(
    (task: TaskCardData) => {
      if (withDetails) {
        setSelectedTaskId(task.id);
        return;
      }
      router.push(routes.task(workspace.workspaceId, task.id));
    },
    [router, withDetails, workspace.workspaceId],
  );
  const { runAction, openSession } = actions;
  const onAction = useCallback(
    (
      task: TaskCardData,
      action: TaskWorkflowAction,
      sessionOptionsByRole: TaskCardModel["sessionOptionsByRole"],
    ) => runAction(task, action, (role: AgentRole) => sessionOptionsByRole[role]),
    [runAction],
  );
  // Refresh Tasks in the menu shows the same list progress as a pull.
  const { pulling, pull: onPull } = usePullRefresh(board.refresh);
  const canCreate = creationBlockedReason === null;
  const onNewTask = useMemo(
    () => (canCreate ? () => router.push(routes.newTask(workspace.workspaceId)) : null),
    [canCreate, router, workspace.workspaceId],
  );

  const listProps = useMemo(
    () => ({
      sessions: board.sessions,
      selectedTaskId: shownTaskId,
      isRefreshing: pulling,
      onRefresh: onPull,
      onNewTask,
      onOpenDetails,
      onAction,
      onOpenSession: openSession,
    }),
    [board.sessions, onAction, onNewTask, onOpenDetails, onPull, openSession, pulling, shownTaskId],
  );

  const ready = board.state.status === "ready" && board.allTasks.length > 0;
  const onSearchText = useHeaderSearchText(search, filter);
  const headerRight = useCallback(
    () => <BoardHeaderActions workspace={workspace} onRefresh={onPull} />,
    [onPull, workspace],
  );
  const openFilters = useCallback(() => setFiltersOpen(true), []);
  const filterButton = useMemo(
    () => <BoardFilterButton filter={filter.value} onPress={openFilters} />,
    [filter.value, openFilters],
  );
  const searchColors = useSearchBarColors();
  const screenOptions = useMemo(() => {
    const options: NativeStackNavigationOptions = { headerRight };
    if (ready) {
      options.headerSearchBarOptions = {
        ...searchColors,
        placeholder: "Search tasks",
        hideWhenScrolling: false,
        autoCapitalize: "none",
        ref: search.bar,
        onChangeText: (event) => onSearchText(event.nativeEvent.text),
        onCancelButtonPress: () => onSearchText(""),
      };
    }
    return options;
  }, [headerRight, onSearchText, ready, search.bar, searchColors]);

  const view = taskBoardView({
    state: board.state,
    hostUnavailable,
    taskCount: board.allTasks.length,
    filterActive: filter.isActive,
    matchingCount: board.matchingTasks.length,
    columnCount: board.columns.length,
  });

  return (
    <View style={styles.root}>
      <Stack.Screen options={screenOptions} />
      <View style={styles.board}>
        <MergedPullRequestNotice />
        <BoardNotices
          creationBlockedReason={board.allTasks.length > 0 ? creationBlockedReason : null}
          historyError={board.historyError}
        />
        {ready && filter.isActive ? (
          <ActiveFilterBar
            summary={filterSummary(board.matchingTasks.length, board.allTasks.length)}
            onClear={filter.onClear}
          />
        ) : null}
        <View style={styles.content}>
          {view.kind === "board" ? (
            <BoardLanes
              wide={wide}
              columns={board.columns}
              selectedColumn={selectedColumn}
              onSelectColumn={setChosenColumn}
              filterButton={filterButton}
              listProps={listProps}
            />
          ) : (
            <BoardStatus
              view={view}
              wide={wide}
              columns={board.columns}
              selectedColumn={selectedColumn}
              onSelectColumn={setChosenColumn}
              creationBlockedReason={creationBlockedReason}
              filterButton={filterButton}
              onRetry={onPull}
              onNewTask={() => router.push(routes.newTask(workspace.workspaceId))}
              onClearFilters={filter.onClear}
            />
          )}
        </View>
      </View>
      {withDetails ? (
        <View style={styles.detail}>
          <TaskDetailPane workspaceId={workspace.workspaceId} taskId={shownTaskId} />
        </View>
      ) : null}
      <BoardFilterSheet
        visible={filtersOpen}
        filter={filter}
        onClose={() => setFiltersOpen(false)}
      />
      {actions.confirmations}
    </View>
  );
}

type BoardListProps = Omit<
  Parameters<typeof BoardPager>[0],
  "columns" | "selectedId" | "onSelect" | "toolbar"
>;

/** The lanes: side by side on a wide screen, else one lane at a time in a pager. */
function BoardLanes({
  wide,
  columns,
  selectedColumn,
  onSelectColumn,
  filterButton,
  listProps,
}: {
  wide: boolean;
  columns: Parameters<typeof BoardPager>[0]["columns"];
  selectedColumn: KanbanColumnId | null;
  onSelectColumn: (column: KanbanColumnId) => void;
  filterButton: ReactElement;
  listProps: BoardListProps;
}): ReactElement {
  if (wide) {
    return (
      <>
        <View style={styles.toolbar}>{filterButton}</View>
        <BoardWide columns={columns} {...listProps} />
      </>
    );
  }
  return (
    <BoardPager
      columns={columns}
      selectedId={selectedColumn}
      onSelect={onSelectColumn}
      toolbar={filterButton}
      {...listProps}
    />
  );
}

/** The Tasks tab without lanes: a load, a failure, or why the board shows no task. */
function BoardStatus({
  view,
  wide,
  columns,
  selectedColumn,
  onSelectColumn,
  creationBlockedReason,
  filterButton,
  onRetry,
  onNewTask,
  onClearFilters,
}: {
  view: Exclude<TaskBoardView, { kind: "board" }>;
  wide: boolean;
  /** The lanes before their tasks load, for the board skeleton. */
  columns: Parameters<typeof BoardPager>[0]["columns"];
  selectedColumn: KanbanColumnId | null;
  onSelectColumn: (column: KanbanColumnId) => void;
  creationBlockedReason: string | null;
  filterButton: ReactElement;
  onRetry: () => void;
  onNewTask: () => void;
  onClearFilters: () => void;
}): ReactElement {
  switch (view.kind) {
    case "host_unavailable":
      return <HostConnectionState />;
    case "loading":
      // The layout of `BoardLanes`.
      return wide ? (
        <>
          <View style={styles.toolbar}>{filterButton}</View>
          <BoardWidePlaceholder columns={columns} />
        </>
      ) : (
        <BoardSkeleton
          columns={columns}
          selectedColumn={selectedColumn}
          onSelectColumn={onSelectColumn}
          toolbar={filterButton}
        />
      );
    case "error":
      return <ErrorState title={view.title} message={view.message} onRetry={onRetry} />;
    case "no_tasks":
      return (
        <EmptyState
          icon="clipboard-list"
          title="No Tasks Yet"
          message={
            creationBlockedReason ?? "Create a task, or import issues from your Git provider."
          }
          action={
            <Button
              label="New Task"
              icon="plus"
              disabled={creationBlockedReason !== null}
              onPress={onNewTask}
            />
          }
        />
      );
    case "no_results":
      // The filters stay in reach, so the user can change one of them.
      return (
        <>
          <View style={styles.toolbar}>{filterButton}</View>
          <EmptyState
            icon="search-x"
            title="No Results"
            message="No tasks match your search or filters."
            action={<Button label="Clear Filters" variant="tinted" onPress={onClearFilters} />}
          />
        </>
      );
    case "no_lanes":
      return (
        <EmptyState
          icon="clipboard-list"
          title="No Tasks to Show"
          message="Every lane is empty. The board hides empty lanes and older Done tasks."
        />
      );
  }
}

/** The notices above the board: blocked task creation and a session history that did not load. */
function BoardNotices({
  creationBlockedReason,
  historyError,
}: {
  creationBlockedReason: string | null;
  historyError: string | null;
}): ReactElement {
  return (
    <>
      {creationBlockedReason ? (
        <View style={styles.notice}>
          <Callout tone="warning" title="New tasks are blocked" message={creationBlockedReason} />
        </View>
      ) : null}
      {historyError ? (
        <View style={styles.notice}>
          <Callout
            tone="warning"
            title="Session history did not load"
            message={`${historyError} Cards show only live sessions. Pull to refresh.`}
          />
        </View>
      ) : null}
    </>
  );
}

/** The details of the selected task on a wide screen. */
function TaskDetailPane({
  workspaceId,
  taskId,
}: {
  workspaceId: string;
  taskId: string | null;
}): ReactElement {
  if (!taskId) {
    return (
      <EmptyState
        icon="clipboard-list"
        title="No Task Selected"
        message="Select a task to see its details."
      />
    );
  }
  return <TaskDetailsView key={taskId} workspaceId={workspaceId} taskId={taskId} embedded />;
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, flexDirection: "row" },
  board: { flex: 1 },
  content: { flex: 1 },
  notice: { paddingHorizontal: theme.space.md, paddingTop: theme.space.sm },
  filterBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    minHeight: 36,
    paddingHorizontal: theme.layout.screenPadding,
    borderBottomWidth: theme.hairline,
    borderBottomColor: theme.desktop.border,
    backgroundColor: theme.desktop.muted,
  },
  filterSummary: { flex: 1, color: theme.desktop.foreground },
  clear: { flexDirection: "row", alignItems: "center", gap: 4 },
  clearLabel: { color: theme.desktop.mutedForeground },
  toolbar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: theme.space.md,
    paddingTop: theme.space.md,
  },
  detail: {
    width: 440,
    borderLeftWidth: theme.hairline,
    borderLeftColor: theme.colors.separator,
    backgroundColor: theme.colors.groupedBackground,
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: theme.space.xs },
}));
