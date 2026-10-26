import type { WorkspaceRecord, WorkspaceSession } from "@openducktor/contracts";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useMinuteClock } from "@openducktor/frontend-core/lib/relative-time";
import { workspaceSessionListQueryOptions } from "@openducktor/frontend-core/queries/workspace-sessions";
import { workspaceSessionTitle } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import {
  ARCHIVED_CHATS_TEXT,
  filterWorkspaceSessions,
  useRestoreWorkspaceSession,
} from "@openducktor/frontend-core/workspace-sessions/archived-workspace-sessions";
import { FlashList } from "@shopify/flash-list";
import { useQuery } from "@tanstack/react-query";
import { type NativeStackNavigationOptions, Stack } from "expo-router";
import { type ReactElement, useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SelectedWorkspaceGate } from "@/features/workspaces/no-open-workspace";
import { WorkspaceHeaderTitle } from "@/features/workspaces/workspace-header-title";
import { useSearchBarColors } from "@/navigation/stack-theme";
import { Button } from "@/ui/button";
import { Screen } from "@/ui/screen";
import { EmptyState, ErrorState } from "@/ui/states";
import { Callout } from "@/ui/callout";
import { Text } from "@/ui/text";
import { KEEP_TOP_VISIBLE } from "@/ui/list-position";
import { ArchivedChatRow } from "./archived-chat-row";
import { ChatListSkeleton } from "./chat-list-skeleton";
import { ChatSectionHeader } from "./chat-section-header";
import { type ArchivedChatItem, archivedChatItems, startOfLocalDay } from "./chat-sections";
import { useTabBarSpace } from "@/navigation/tab-bar/tab-bar-metrics";
import { ListRefreshControl } from "@/ui/refresh-control";
import { usePullRefresh } from "@/ui/use-pull-refresh";

const keyOf = (item: ArchivedChatItem): string => item.key;
const typeOf = (item: ArchivedChatItem): string => item.type;

const ARCHIVED_SKELETON = <ChatListSkeleton header={<ArchivedListHeader />} />;

type RestoreState = {
  pendingId: string | null;
  failure: { sessionId: string; error: Error } | null;
};

function ArchivedChatList({
  workspace,
  filter,
}: {
  workspace: WorkspaceRecord;
  filter: string;
}): ReactElement {
  const tabBarSpace = useTabBarSpace({ automaticInsets: true });
  const { feedback } = useClientConnection();
  const now = useMinuteClock();
  const archived = useQuery(workspaceSessionListQueryOptions(workspace.workspaceId, true));
  const restore = useRestoreWorkspaceSession({
    workspaceId: workspace.workspaceId,
    repoPath: workspace.repoPath,
  });
  const [restoreState, setRestoreState] = useState<RestoreState>({
    pendingId: null,
    failure: null,
  });
  const records = useMemo(
    () => (archived.data ? filterWorkspaceSessions(archived.data, filter) : []),
    [archived.data, filter],
  );
  // The sections change at midnight, not with every minute of the clock.
  const today = startOfLocalDay(now);
  const items = useMemo(() => archivedChatItems(records, today), [records, today]);
  const { mutate } = restore;
  const restoreChat = useCallback(
    (record: WorkspaceSession) => {
      setRestoreState({ pendingId: record.id, failure: null });
      mutate(record.id, {
        onSuccess: () => {
          setRestoreState({ pendingId: null, failure: null });
          feedback.show("success", `${workspaceSessionTitle(record)} is restored.`);
        },
        onError: (error) =>
          setRestoreState({ pendingId: null, failure: { sessionId: record.id, error } }),
      });
    },
    [feedback, mutate],
  );
  const { refetch } = archived;
  const { pulling: refreshing, pull: refresh } = usePullRefresh(refetch);
  const busy = restoreState.pendingId !== null || archived.isFetching;
  const rowState = useMemo(() => ({ restoreState, busy }), [busy, restoreState]);
  const renderItem = useCallback(
    ({ item, index }: { item: ArchivedChatItem; index: number }) => {
      if (item.type === "header") {
        return (
          <ChatSectionHeader sectionId={item.sectionId} count={item.count} first={index === 0} />
        );
      }
      const { record } = item;
      const { failure, pendingId } = rowState.restoreState;
      return (
        <ArchivedChatRow
          record={record}
          restoring={pendingId === record.id}
          busy={rowState.busy}
          failure={failure?.sessionId === record.id ? failure.error : null}
          onRestore={restoreChat}
        />
      );
    },
    [restoreChat, rowState],
  );

  if (archived.isPending) return ARCHIVED_SKELETON;
  if (archived.data === undefined) {
    return (
      <ErrorState
        title="Archived chats did not load"
        message={errorMessage(archived.error)}
        onRetry={() => void refetch()}
      />
    );
  }
  const notice = archived.error ? (
    <View style={styles.notice}>
      <Callout
        tone="warning"
        title="Archived chats could not refresh"
        message={errorMessage(archived.error)}
        action={
          <Button
            label="Try Again"
            size="sm"
            variant="gray"
            disabled={archived.isFetching}
            onPress={refresh}
          />
        }
      />
    </View>
  ) : null;
  if (records.length === 0) {
    return (
      <View style={styles.fill}>
        {notice}
        <ListWorkspace />
        {archived.data.length === 0 ? (
          <EmptyState
            icon="archive"
            title="No Archived Chats"
            message={`Chats that you archive in ${workspace.workspaceName} show here. Restore one to use it again.`}
          />
        ) : (
          <EmptyState
            icon="search-x"
            title="No Results"
            message={`No archived chat of ${workspace.workspaceName} matches “${filter.trim()}”.`}
          />
        )}
      </View>
    );
  }
  return (
    <FlashList
      data={items}
      keyExtractor={keyOf}
      getItemType={typeOf}
      renderItem={renderItem}
      extraData={rowState}
      contentInsetAdjustmentBehavior="automatic"
      maintainVisibleContentPosition={KEEP_TOP_VISIBLE}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.listContent, { paddingBottom: tabBarSpace }]}
      ListHeaderComponent={
        <View>
          {notice}
          <ArchivedListHeader />
        </View>
      }
      refreshControl={<ListRefreshControl refreshing={refreshing} onRefresh={refresh} />}
    />
  );
}

/** The workspace of the list and what the list is for, above the list and its skeleton. */
function ArchivedListHeader(): ReactElement {
  return (
    <>
      <ListWorkspace />
      <Text variant="footnote" tone="secondary" style={styles.description}>
        {ARCHIVED_CHATS_TEXT.description}
      </Text>
    </>
  );
}

/**
 * The workspace of the list, which also opens the workspace switcher. The list shows one
 * workspace, also while the Sessions list shows every workspace.
 */
function ListWorkspace(): ReactElement {
  return (
    <View style={styles.workspace}>
      <WorkspaceHeaderTitle />
    </View>
  );
}

/**
 * Archived Workspace Sessions of the selected workspace in group cards by the day of their archive.
 * The workspace above the list switches the workspace. Restore makes a chat usable again.
 */
export function ArchivedChatsScreen(): ReactElement {
  const [filter, setFilter] = useState("");
  const searchColors = useSearchBarColors();
  const options = useMemo(
    (): NativeStackNavigationOptions => ({
      title: "Archived Chats",
      headerSearchBarOptions: {
        ...searchColors,
        placeholder: "Search Archived Chats",
        autoCapitalize: "none",
        onChangeText: (event) => setFilter(event.nativeEvent.text),
        onCancelButtonPress: () => setFilter(""),
      },
    }),
    [searchColors],
  );
  return (
    <Screen>
      <Stack.Screen options={options} />
      <SelectedWorkspaceGate loading={ARCHIVED_SKELETON}>
        {(workspace) => (
          <ArchivedChatList key={workspace.workspaceId} workspace={workspace} filter={filter} />
        )}
      </SelectedWorkspaceGate>
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  fill: { flex: 1 },
  notice: { paddingHorizontal: theme.layout.screenPadding, paddingTop: theme.space.md },
  workspace: {
    alignItems: "flex-start",
    paddingHorizontal: theme.layout.screenPadding,
    paddingTop: theme.space.sm,
  },
  description: {
    paddingHorizontal: theme.layout.screenPadding + 4,
    paddingTop: theme.space.md,
    paddingBottom: theme.space.xs,
  },
  listContent: { paddingBottom: theme.space.xxxl },
}));
