import type { WorkspaceRecord } from "@openducktor/contracts";
import { sessionSourceIssueText } from "@openducktor/frontend-core/sessions/navigation/session-navigation-entry-labels";
import {
  type SessionNavigationEntry,
  type SessionNavigationGroupId,
  type SessionNavigationSourceIssue,
  scopeSessionNavigationModel,
} from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";
import { workspaceCatalogQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import { useTerminalTransport } from "@openducktor/frontend-core/terminals/use-terminal-transport";
import { FlashList } from "@shopify/flash-list";
import { useQuery } from "@tanstack/react-query";
import { type NativeStackNavigationOptions, Stack, useRouter } from "expo-router";
import { type ReactElement, useCallback, useMemo, useState } from "react";
import { Platform, ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useMobileWorkspaces } from "@/composition/workspace-selection";
import { useOpenWorkspaceChat } from "@/features/new-chat/use-open-workspace-chat";
import { useTerminalBridge } from "@/features/terminals/use-terminal-bridge";
import { NoOpenWorkspaceState } from "@/features/workspaces/no-open-workspace";
import { useCommandGate } from "@/host-session/active-session-context";
import { HostConnectionState, useHostUnavailable } from "@/host-session/host-connection-state";
import { routes } from "@/navigation/routes";
import { useTabBarSpace } from "@/navigation/tab-bar/tab-bar-metrics";
import { useSearchBarColors } from "@/navigation/stack-theme";
import { useAppTheme } from "@/theme/app-theme-context";
import { Button } from "@/ui/button";
import { SegmentedControl } from "@/ui/fields";
import { IconButton } from "@/ui/icon-button";
import { KEEP_TOP_VISIBLE } from "@/ui/list-position";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { ListRefreshControl } from "@/ui/refresh-control";
import { Screen } from "@/ui/screen";
import { EmptyState, ErrorState } from "@/ui/states";
import { Callout } from "@/ui/callout";
import { Text } from "@/ui/text";
import { type PullRefresh, usePullRefresh } from "@/ui/use-pull-refresh";
import { SessionCommandsContext } from "./session-commands";
import { SessionGroupHeader } from "./session-group-header";
import { SessionListSkeleton } from "./session-list-skeleton";
import {
  buildSessionListItems,
  type SessionListItem,
  type SessionsScreenState,
  sessionEntryDestination,
  sessionsScreenState,
} from "./session-list-model";
import { SessionRow } from "./session-row";
import { useSwipeRowGroup } from "./swipe-row";
import { useSessionActions } from "./use-session-actions";
import {
  type SessionScope,
  useAllSessionNavigation,
  useSessionListGrouping,
} from "./session-navigation-provider";

const keyOf = (item: SessionListItem): string => item.key;
const typeOf = (item: SessionListItem): string => item.type;
const NO_COLLAPSED: ReadonlySet<SessionNavigationGroupId> = new Set();

function SourceIssue({
  issue,
  onRetry,
}: {
  issue: SessionNavigationSourceIssue;
  onRetry: (issue: SessionNavigationSourceIssue) => void;
}): ReactElement {
  return (
    <View style={styles.issue}>
      <Callout
        tone="warning"
        title="Session list is incomplete"
        message={sessionSourceIssueText(issue)}
        action={
          // Live status recovers through its own stream, so only reads offer Retry.
          issue.source === "live_status" ? null : (
            <Button
              label="Try Again"
              size="sm"
              variant="outline"
              accessibilityLabel={`Try again for ${issue.workspace.workspaceName}`}
              onPress={() => onRetry(issue)}
            />
          )
        }
      />
    </View>
  );
}

/**
 * The desktop note under the list of every workspace: the closed workspaces and the incomplete
 * removals that it does not list. Reopening and removal happen on the desktop or web app.
 */
function UnlistedWorkspacesNote(): ReactElement | null {
  const catalog = useQuery(workspaceCatalogQueryOptions()).data;
  const closed = catalog?.closedWorkspaces ?? [];
  const removals = catalog?.incompleteRemovals ?? [];
  if (closed.length === 0 && removals.length === 0) return null;
  return (
    <View style={styles.unlisted}>
      {closed.length > 0 ? (
        <Text variant="footnote" style={styles.footerText}>
          {`Not listed because they are closed: ${closed
            .map((workspace) => workspace.workspaceName)
            .join(", ")}.`}
        </Text>
      ) : null}
      {removals.map((removal) => (
        <Text key={removal.workspace.workspaceId} variant="footnote" style={styles.footerText}>
          {`${removal.workspace.workspaceName} is not listed because its removal is incomplete. Finish it on the desktop or web app.`}
        </Text>
      ))}
    </View>
  );
}

/**
 * The header actions: the grouping switch and the archived chats. The create button of the tab
 * bar creates tasks and chats.
 */
function SessionsHeaderActions({
  workspace,
  grouped,
  groupingDisabled,
  onToggleGrouping,
}: {
  workspace: WorkspaceRecord | null;
  grouped: boolean;
  groupingDisabled: boolean;
  onToggleGrouping: () => void;
}): ReactElement {
  const router = useRouter();
  return (
    <View style={styles.headerActions}>
      <IconButton
        icon={grouped ? "list-tree" : "list"}
        color="label"
        accessibilityLabel={grouped ? "Show every session" : "Group sessions by task"}
        command
        disabled={groupingDisabled}
        onPress={onToggleGrouping}
      />
      <IconButton
        icon="archive"
        color="label"
        accessibilityLabel="Archived Chats"
        disabled={workspace === null}
        onPress={() => router.push(routes.archivedChats())}
      />
    </View>
  );
}

/**
 * The first screen: the session list of the desktop sidebar. Needs you, Running, and Recent hold
 * the task sessions and chats of the selected workspace or of every open workspace. A group folds
 * with a tap on its header.
 */
export function SessionsScreen(): ReactElement {
  const router = useRouter();
  const tabBarSpace = useTabBarSpace({ automaticInsets: true });
  // The shared terminal transport of the host connection, for the active command marks.
  const { controller: terminalController } = useTerminalTransport(useTerminalBridge());
  const { workspaces, selectedWorkspace, error, refreshWorkspaces } = useMobileWorkspaces();
  const [scope, setScope] = useState<SessionScope>("all");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(NO_COLLAPSED);
  // The model renders at background priority, so the screen state reads the workspace list that
  // built it, not the current one.
  const {
    model: everyModel,
    retrySource,
    refresh,
    workspacesLoading,
    workspaceCount,
  } = useAllSessionNavigation();
  const grouping = useSessionListGrouping();
  const workspaceId = selectedWorkspace?.workspaceId ?? null;
  // A pull reads the session sources of the workspaces that the list shows again.
  const refreshScope = useCallback(
    () => refresh(scope === "all" ? null : workspaceId),
    [refresh, scope, workspaceId],
  );
  const { pulling, pull } = usePullRefresh(refreshScope);
  // The list of the selected workspace filters the model of every workspace, so a scope switch
  // keeps every entry object and renders only the rows that it adds.
  const model = useMemo(
    () => (scope === "all" ? everyModel : scopeSessionNavigationModel(everyModel, workspaceId)),
    [everyModel, scope, workspaceId],
  );
  // While the host connection is down, the connection status explains every failed read, and the
  // reads run again after the reconnect.
  const { open: connected } = useCommandGate();
  // The list stays current under an open session, so a swipe back shows its current state. A live
  // change renders only the rows whose entry changed.
  const items = useMemo(() => {
    const next = buildSessionListItems(model, { collapsed, query });
    return connected ? next : next.filter((item) => item.type !== "issue");
  }, [collapsed, connected, model, query]);
  const runAction = useSessionActions();
  const swipeGroup = useSwipeRowGroup();
  const { openChat, pendingRecordId, failure, clearFailure } = useOpenWorkspaceChat();

  const toggleGroup = useCallback((groupId: SessionNavigationGroupId) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);
  const open = useCallback(
    (entry: SessionNavigationEntry) => {
      const destination = sessionEntryDestination(entry);
      if (destination.kind === "task") {
        router.push(routes.task(destination.workspaceId, destination.taskId));
        return;
      }
      // A chat without pending input opens, or starts first, through openChat.
      const focused = destination.kind === "session" && destination.params.focus !== undefined;
      if (entry.context.kind === "workspace" && !focused) {
        void openChat(entry.workspace, entry.context.session);
        return;
      }
      if (destination.kind === "session") router.push(routes.session(destination.params));
    },
    [openChat, router],
  );
  const rowState = useMemo(() => ({ pendingRecordId, failure }), [failure, pendingRecordId]);

  const renderItem = useCallback(
    ({ item }: { item: SessionListItem }): ReactElement => {
      if (item.type === "issue") return <SourceIssue issue={item.issue} onRetry={retrySource} />;
      if (item.type === "header") {
        return (
          <SessionGroupHeader
            groupId={item.groupId}
            label={item.label}
            count={item.count}
            collapsed={item.collapsed}
            onToggle={toggleGroup}
          />
        );
      }
      const { entry } = item;
      const recordId = entry.context.kind === "workspace" ? entry.context.session.id : null;
      return (
        <SessionRow
          entry={entry}
          starting={recordId !== null && rowState.pendingRecordId === recordId}
          failure={
            recordId !== null && rowState.failure?.recordId === recordId
              ? rowState.failure.failure
              : null
          }
          swipeGroup={swipeGroup}
          onOpen={open}
          onAction={runAction}
          onDismissFailure={clearFailure}
        />
      );
    },
    [clearFailure, open, retrySource, rowState, runAction, swipeGroup, toggleGroup],
  );

  const grouped = grouping.grouping === "task";
  const { changeGrouping, disabled: groupingDisabled } = grouping;
  const searchColors = useSearchBarColors();
  const options = useMemo(
    (): NativeStackNavigationOptions => ({
      title: "Sessions",
      headerLargeTitleEnabled: Platform.OS === "ios",
      headerRight: () => (
        <SessionsHeaderActions
          workspace={selectedWorkspace}
          grouped={grouped}
          groupingDisabled={groupingDisabled}
          onToggleGrouping={() => changeGrouping(grouped ? "none" : "task")}
        />
      ),
      headerSearchBarOptions: {
        ...searchColors,
        placeholder: "Search sessions",
        autoCapitalize: "none",
        onChangeText: (event) => setQuery(event.nativeEvent.text),
        onCancelButtonPress: () => setQuery(""),
      },
    }),
    [changeGrouping, grouped, groupingDisabled, searchColors, selectedWorkspace],
  );

  const scopeOptions = useMemo(
    () => [
      {
        value: "current" as const,
        label: selectedWorkspace?.workspaceName ?? "No workspace",
        disabled: selectedWorkspace === null,
      },
      { value: "all" as const, label: "All workspaces" },
    ],
    [selectedWorkspace],
  );
  const header = useMemo(
    () =>
      workspaces.length > 1 ? (
        <View style={styles.scope}>
          <SegmentedControl
            label="Session list scope"
            options={scopeOptions}
            value={scope}
            onChange={setScope}
          />
        </View>
      ) : null,
    [scope, scopeOptions, workspaces.length],
  );

  const hostUnavailable = useHostUnavailable();
  const state = sessionsScreenState({
    hostUnavailable,
    workspacesLoading,
    workspaceCount,
    model,
  });
  const searching = query.trim().length > 0;
  return (
    <Screen background="sidebar">
      <Stack.Screen options={options} />
      <SessionCommandsContext value={terminalController}>
        {/* A wide window, such as a phone in landscape, keeps the rows at a readable width. */}
        <View style={styles.column}>
          {state === "list" ? (
            <FlashList
              data={items}
              keyExtractor={keyOf}
              getItemType={typeOf}
              renderItem={renderItem}
              // A row holds its swipe, menu, and press gestures, so it takes a moment to render. The
              // list renders about one screen ahead, so a fast fling does not show empty space.
              drawDistance={SESSION_LIST_DRAW_DISTANCE}
              extraData={rowState}
              ListHeaderComponent={header}
              contentInsetAdjustmentBehavior="automatic"
              contentContainerStyle={[styles.listContent, { paddingBottom: tabBarSpace }]}
              // New rows above show at once while the list is at the top, and keep their place below.
              maintainVisibleContentPosition={KEEP_TOP_VISIBLE}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              onScrollBeginDrag={swipeGroup.closeOpenRow}
              refreshControl={<ListRefreshControl refreshing={pulling} onRefresh={pull} />}
              ListEmptyComponent={
                searching ? (
                  <EmptyState
                    icon="search-x"
                    title="No Results"
                    message={`No session matches “${query.trim()}”. Search by title, workspace, role, or task ID.`}
                  />
                ) : null
              }
              ListFooterComponent={
                <SessionListFooter loading={model.isLoading} showsUnlisted={scope === "all"} />
              }
            />
          ) : (
            <SessionsScreenStateView
              state={state}
              header={header}
              workspaceId={workspaceId}
              workspacesError={error}
              onRetryWorkspaces={refreshWorkspaces}
              refresh={{ pulling, pull }}
            />
          )}
        </View>
      </SessionCommandsContext>
    </Screen>
  );
}

/** The Sessions screen while it has no list to show. */
function SessionsScreenStateView({
  state,
  header,
  workspaceId,
  workspacesError,
  onRetryWorkspaces,
  refresh,
}: {
  state: Exclude<SessionsScreenState, "list">;
  /** The scope control above the list. */
  header: ReactElement | null;
  workspaceId: string | null;
  workspacesError: string | null;
  onRetryWorkspaces: () => void;
  /** The pull to refresh of the session sources, as on the list. */
  refresh: PullRefresh;
}): ReactElement {
  switch (state) {
    case "host_unavailable":
      return <HostConnectionState />;
    case "loading":
      return <SessionListSkeleton header={header} />;
    case "no_workspace":
      return workspacesError ? (
        <ErrorState
          title="Workspaces did not load"
          message={workspacesError}
          onRetry={onRetryWorkspaces}
        />
      ) : (
        <NoOpenWorkspaceState />
      );
    case "no_sessions":
      return <NoSessionsState header={header} workspaceId={workspaceId} refresh={refresh} />;
  }
}

/** No session yet. A pull reads the session sources again, as on the list. */
function NoSessionsState({
  header,
  workspaceId,
  refresh,
}: {
  header: ReactElement | null;
  workspaceId: string | null;
  refresh: PullRefresh;
}): ReactElement {
  const router = useRouter();
  return (
    <ScrollView
      contentContainerStyle={styles.grow}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<ListRefreshControl refreshing={refresh.pulling} onRefresh={refresh.pull} />}
    >
      {header}
      <EmptyState
        icon="messages-square"
        title="No Sessions Yet"
        message="Start with New Task or New Chat. Sessions that run, wait for you, or finished recently show here."
        action={
          workspaceId ? (
            <>
              <Button
                label="New Task"
                icon="plus"
                onPress={() => router.push(routes.newTask(workspaceId))}
              />
              <Button
                label="New Chat"
                icon="message-circle-plus"
                variant="outline"
                onPress={() => router.push(routes.newChat(workspaceId))}
              />
            </>
          ) : null
        }
      />
    </ScrollView>
  );
}

/** The end of the list: more sessions that load, and the workspaces that the list leaves out. */
function SessionListFooter({
  loading,
  showsUnlisted,
}: {
  loading: boolean;
  showsUnlisted: boolean;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <>
      {loading ? (
        <View style={styles.footer} accessibilityRole="progressbar">
          <LoaderSpinner size={14} color={theme.desktop.sidebarMutedForeground} />
          <Text variant="footnote" style={styles.footerText}>
            Loading more sessions…
          </Text>
        </View>
      ) : null}
      {showsUnlisted ? <UnlistedWorkspacesNote /> : null}
    </>
  );
}

const SESSION_LIST_DRAW_DISTANCE = 1000;

const styles = StyleSheet.create((theme) => ({
  column: { flex: 1, width: "100%", maxWidth: 760, alignSelf: "center" },
  grow: { flexGrow: 1 },
  scope: {
    paddingHorizontal: theme.layout.screenPadding,
    paddingTop: theme.space.sm,
    paddingBottom: theme.space.xs,
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: theme.space.xs },
  issue: { paddingHorizontal: theme.layout.screenPadding, paddingTop: theme.space.md },
  listContent: { paddingBottom: theme.space.xxxl },
  // The desktop status line: a turning loader and `text-sidebar-muted-foreground`.
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.space.sm,
    padding: theme.space.lg,
  },
  footerText: { color: theme.desktop.sidebarMutedForeground },
  // The desktop note: `rounded-lg border border-sidebar-border px-2.5 py-2 text-xs`.
  unlisted: {
    gap: 6,
    marginHorizontal: theme.layout.screenPadding,
    marginTop: theme.space.md,
    paddingHorizontal: 10,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.sidebarBorder,
  },
}));
