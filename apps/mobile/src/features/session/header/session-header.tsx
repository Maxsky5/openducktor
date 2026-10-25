import { type BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import type { PullRequest } from "@openducktor/contracts";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";

import { useMinuteClock } from "@openducktor/frontend-core/lib/relative-time";
import {
  PULL_REQUEST_STATE_LABELS,
  pullRequestLabel,
} from "@openducktor/frontend-core/tasks/pull-requests/pull-request-presentation";

import { type NativeStackNavigationOptions, Stack, useRouter } from "expo-router";
import { type ReactElement, useCallback, useMemo, useState } from "react";
import { useWindowDimensions, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { useTaskSessionGroups } from "@/features/tasks/details/use-task-session-groups";
import { pullRequestPaint } from "@/features/tasks/presentation/task-badge-paint";
import { routes, SINGLE_SHEET, switchedSessionParams } from "@/navigation/routes";
import { useClipboardCopy } from "@/platform/use-clipboard-copy";
import { useLinkOpener } from "@/rich-content/links/use-link-opener";
import { type ActionMenuItem, ActionMenu } from "@/ui/action-menu";
import type { IconName } from "@/ui/icon";
import { IconButton } from "@/ui/icon-button";
import { useRepoTask } from "@/features/work-owner/use-repo-task";
import { SessionSubagentsSheet, useSessionSubagentRows } from "../panels/session-subagents-sheet";
import { type SubagentRow, subagentsMenuDetail } from "../panels/subagent-rows";
import { type SessionTarget, useSessionTarget } from "../session-target";
import { useSessionFacts } from "../use-session-facts";
import { useSessionRuntimeInfo } from "../use-session-runtime-info";
import { quickActionItems, sessionHistoryItems } from "./session-header-menus";
import { sessionHeaderText } from "./session-header-text";
import { buildWorkViewLinks } from "./work-view-links";
import { SessionHeaderTitle } from "./session-header-title";
import { titleMaxWidth } from "./session-header-width";
import { SessionWorkflowRail } from "./session-workflow-rail";
import { useTaskQuickActions } from "./use-task-quick-actions";

const TASK_DETAILS_ID = "task-details";
const COPY_TASK_ID = "copy-task-id";
const RENAME_CHAT_ID = "rename-chat";
const COPY_DIRECTORY_ID = "copy-working-directory";
const ARCHIVE_CHAT_ID = "archive-chat";
const PULL_REQUEST_ID = "pull-request";
const SUBAGENTS_ID = "subagents";
const NO_SUBAGENTS: readonly SubagentRow[] = Object.freeze([]);

/**
 * The session menu: the task details and Copy Task ID of a task session, the pull request of the
 * task, Rename, Copy Working Directory, and Archive Chat of a chat, the work views, and the
 * Subagents of the session when it has some.
 */
const useSessionMenu = (
  target: SessionTarget,
  pullRequest: PullRequest | null,
  subagents: readonly SubagentRow[],
  openSubagents: () => void,
) => {
  const router = useRouter();
  const { copyText } = useClipboardCopy();
  const openLink = useLinkOpener(undefined);
  const { owner, readOnly, workspace, identity, workOwner } = target;
  const taskId = owner.kind === "task" ? owner.taskId : null;
  const links = useMemo(() => buildWorkViewLinks(workOwner), [workOwner]);
  const { workspaceId } = workspace;
  const openTask = useCallback(() => {
    if (taskId) router.push(routes.task(workspaceId, taskId));
  }, [router, taskId, workspaceId]);
  const copyTaskId = useCallback(() => {
    if (!taskId) return;
    void copyText(taskId, {
      copied: "Task ID copied.",
      detail: taskId,
      failed: "The task ID was not copied.",
    });
  }, [copyText, taskId]);
  // An active chat has the desktop chat header actions: Rename, Copy working directory, and
  // Archive. An archived chat restores from the notice above its composer or from Archived Chats.
  const chatId =
    owner.kind === "chat" && !readOnly && owner.record.archivedAt === null ? owner.record.id : null;
  const { workingDirectory } = identity;
  const copyWorkingDirectory = useCallback(() => {
    void copyText(workingDirectory, {
      copied: "Working directory copied.",
      detail: workingDirectory,
      failed: "The working directory was not copied.",
    });
  }, [copyText, workingDirectory]);
  const items = useMemo(() => {
    const menu: ActionMenuItem[] = [];
    if (taskId) {
      menu.push({ id: TASK_DETAILS_ID, title: "Task Details", icon: "clipboard-list" });
      menu.push({ id: COPY_TASK_ID, title: "Copy Task ID", icon: "copy" });
    }
    // The desktop session header links the pull request of the task.
    if (pullRequest) {
      menu.push({
        id: PULL_REQUEST_ID,
        title: pullRequestLabel(pullRequest),
        detail: PULL_REQUEST_STATE_LABELS[pullRequest.state],
        icon: pullRequestPaint(pullRequest).icon,
      });
    }
    if (chatId) {
      menu.push({ id: RENAME_CHAT_ID, title: "Rename", icon: "pencil", command: true });
      menu.push({ id: COPY_DIRECTORY_ID, title: "Copy Working Directory", icon: "copy" });
    }
    for (const link of links) menu.push({ id: link.key, title: link.label, icon: link.icon });
    if (subagents.length > 0) {
      menu.push({
        id: SUBAGENTS_ID,
        title: "Subagents",
        icon: "cpu",
        detail: subagentsMenuDetail(subagents),
      });
    }
    if (chatId) {
      menu.push({ id: ARCHIVE_CHAT_ID, title: "Archive Chat", icon: "archive", command: true });
    }
    return menu;
  }, [chatId, links, pullRequest, subagents, taskId]);
  const select = useCallback(
    (id: string) => {
      if (id === TASK_DETAILS_ID) {
        openTask();
        return;
      }
      if (id === COPY_TASK_ID) {
        copyTaskId();
        return;
      }
      if (id === COPY_DIRECTORY_ID) {
        copyWorkingDirectory();
        return;
      }
      if (id === SUBAGENTS_ID) {
        openSubagents();
        return;
      }
      if (id === PULL_REQUEST_ID && pullRequest) {
        openLink(pullRequest.url);
        return;
      }
      if (chatId && id === RENAME_CHAT_ID) {
        router.push(routes.renameChat(workspaceId, chatId));
        return;
      }
      if (chatId && id === ARCHIVE_CHAT_ID) {
        router.push(routes.archiveChat(workspaceId, chatId));
        return;
      }
      const link = links.find((entry) => entry.key === id);
      if (link) router.push(link.route);
    },
    [
      chatId,
      copyTaskId,
      copyWorkingDirectory,
      links,
      openLink,
      openSubagents,
      openTask,
      pullRequest,
      router,
      workspaceId,
    ],
  );
  return { items, select, openTask: taskId ? openTask : undefined };
};

/**
 * The session selector and the quick actions of the desktop session header, for the task of a
 * task session. Without a task, both menus are empty.
 */
const useTaskSessionMenus = ({
  target,
  taskId,
  task,
  sessionWorking,
}: {
  target: SessionTarget;
  /** The task of a task session that is not read-only, or null. */
  taskId: string | null;
  /** The loaded task of `taskId`, or null. */
  task: TaskCard | null;
  sessionWorking: boolean;
}) => {
  const router = useRouter();
  const { repoPath, identity } = target;
  const { workspaceId } = target.workspace;
  const { groups, summaries } = useTaskSessionGroups(repoPath, taskId);
  const now = useMinuteClock();
  const currentKey = agentSessionIdentityKey(identity);
  const historyItems = useMemo(
    () => sessionHistoryItems(groups, currentKey, now),
    [currentKey, groups, now],
  );
  const openHistorySession = useCallback(
    (key: string) => {
      if (key === currentKey) return;
      const row = groups.flatMap((group) => group.rows).find((entry) => entry.key === key);
      if (row) router.setParams(switchedSessionParams(workspaceId, row.identity));
    },
    [currentKey, groups, router, workspaceId],
  );
  const quickActions = useTaskQuickActions({ repoPath, task, summaries, sessionWorking });
  const quickItems = useMemo(() => quickActionItems(quickActions), [quickActions]);
  const runQuickAction = useCallback(
    (id: string) => {
      const option = quickActions.find((entry) => entry.id === id);
      if (!option || option.disabled || !taskId) return;
      // Apply Human Changes first asks for the feedback, as the desktop quick action does.
      router.push(
        option.requiresHumanFeedback
          ? routes.requestChanges(workspaceId, taskId)
          : routes.quickAction(workspaceId, taskId, option.launchActionId),
        SINGLE_SHEET,
      );
    },
    [quickActions, router, taskId, workspaceId],
  );
  return { historyItems, openHistorySession, quickItems, runQuickAction };
};

/**
 * The desktop session page header in the navigation bar. The title of a task session opens the
 * task details, as the desktop title button. A task session has the desktop session selector and
 * quick actions as two menus, and on a phone in portrait the desktop workflow rail under the bar,
 * which shows the role and the state of each session. A menu holds the task details and Copy Task ID of a task session,
 * Rename, Copy Working Directory, and Archive Chat of a chat, and the work views. The composer
 * shows the model and the context use; the runtime status shows above the composer.
 */
export function SessionHeader({
  showsRail,
}: {
  /** False when the side panel of a low or wide window shows the workflow rail. */
  showsRail: boolean;
}): ReactElement | null {
  const target = useSessionTarget();
  const { owner, readOnly, workspace, repoPath, identity } = target;
  const facts = useSessionFacts();
  const { modelCatalog } = useSessionRuntimeInfo();
  const taskId = owner.kind === "task" ? owner.taskId : null;
  const { task } = useRepoTask(repoPath, taskId);
  const { width } = useWindowDimensions();
  const { title, details, accessibilityLabel } = sessionHeaderText({
    owner,
    readOnly,
    sessionTitle: facts.title,
    taskTitle: task?.title ?? null,
    runtimeKind: identity.runtimeKind,
    selectedModel: facts.selectedModel,
    modelCatalog,
  });
  // A Subagent session only shows its own activity, so it lists no Subagents.
  const subagentRows = useSessionSubagentRows(identity);
  const [subagentsOpen, setSubagentsOpen] = useState(false);
  const openSubagents = useCallback(() => setSubagentsOpen(true), []);
  const closeSubagents = useCallback(() => setSubagentsOpen(false), []);
  const menu = useSessionMenu(
    target,
    task?.pullRequest ?? null,
    readOnly ? NO_SUBAGENTS : subagentRows,
    openSubagents,
  );
  // A Subagent session only shows its own activity, so it has no task menus.
  const workflowTaskId = readOnly ? null : taskId;
  const { historyItems, openHistorySession, quickItems, runQuickAction } = useTaskSessionMenus({
    target,
    taskId: workflowTaskId,
    task: workflowTaskId ? (task ?? null) : null,
    sessionWorking: facts.isWorking,
  });

  const actionCount = [historyItems, quickItems, menu.items].filter(
    (items) => items.length > 0,
  ).length;
  const maxWidth = titleMaxWidth(width, actionCount);
  const openTask = menu.openTask;
  const headerTitle = useCallback(
    () => (
      <SessionHeaderTitle
        title={title}
        maxWidth={maxWidth}
        accessibilityLabel={accessibilityLabel}
        linked={openTask !== undefined}
        onPress={openTask}
      />
    ),
    [accessibilityLabel, maxWidth, openTask, title],
  );
  const menuTitle = details.join(" · ");
  const menuItems = menu.items;
  const selectMenuItem = menu.select;
  const headerRight = useCallback(
    () => (
      <View style={styles.actions}>
        {historyItems.length > 0 ? (
          <HeaderMenu
            title="Task Sessions"
            icon="history"
            label="Task sessions"
            items={historyItems}
            onSelect={openHistorySession}
          />
        ) : null}
        {quickItems.length > 0 ? (
          <HeaderMenu
            title="Quick Actions"
            icon="zap"
            label="Quick actions"
            items={quickItems}
            onSelect={runQuickAction}
          />
        ) : null}
        {menuItems.length > 0 ? (
          <ActionMenu title={menuTitle} items={menuItems} onSelect={selectMenuItem}>
            <IconButton
              icon="more"
              variant="outline"
              accessibilityLabel="Session actions"
              onPress={() => {}}
            />
          </ActionMenu>
        ) : null}
      </View>
    ),
    [
      historyItems,
      menuItems,
      menuTitle,
      openHistorySession,
      quickItems,
      runQuickAction,
      selectMenuItem,
    ],
  );
  const options = useMemo<NativeStackNavigationOptions>(
    () => ({ title, headerTitle, headerRight }),
    [headerRight, headerTitle, title],
  );

  return (
    <>
      <Stack.Screen options={options} />
      {showsRail && owner.kind === "task" && !readOnly ? (
        <SessionWorkflowRail
          workspaceId={workspace.workspaceId}
          repoPath={repoPath}
          taskId={owner.taskId}
          role={owner.role}
          orientation="row"
        />
      ) : null}
      {readOnly ? null : (
        <SessionSubagentsSheet
          rows={subagentRows}
          visible={subagentsOpen}
          onClose={closeSubagents}
        />
      )}
    </>
  );
}

/** One header button that opens a menu, such as the task sessions. */
function HeaderMenu({
  title,
  icon,
  label,
  items,
  onSelect,
}: {
  title: string;
  icon: IconName;
  label: string;
  items: readonly ActionMenuItem[];
  onSelect: (id: string) => void;
}): ReactElement {
  return (
    <ActionMenu title={title} items={items} onSelect={onSelect}>
      <IconButton icon={icon} variant="outline" accessibilityLabel={label} onPress={() => {}} />
    </ActionMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  actions: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
}));
