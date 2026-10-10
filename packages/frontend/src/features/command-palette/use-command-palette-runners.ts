import { useSessionMenu } from "@/components/layout/sidebar/session-menu-provider";
import {
  useSetSessionUnreadKey,
  workspaceSessionReadKey,
} from "@/features/session-navigation/session-read-state";
import { buildSessionNavigationHref } from "@/features/session-navigation/session-navigation-target";
import { useRequiredTaskWorkflowActions } from "@/features/task-workflow/task-workflow-actions-context";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { useWorkspaceState } from "@/state/app-state-provider";
import type { PaletteChatHandlers } from "./command-palette-chat-actions";
import { taskCommandIntent } from "./command-palette-task-commands";
import {
  buildPaletteTaskView,
  type PaletteTaskCommand,
  type PaletteTaskView,
} from "./command-palette-task-model";
import type { PaletteAction, PaletteChat, PaletteTask } from "./command-palette-types";
import { type CommandPaletteData, liveStateOf } from "./use-command-palette-data";
import type { WorkspaceIntent } from "./use-workspace-intent-runner";

export type CommandPaletteRunners = {
  runAction: (action: PaletteAction) => void;
  runTaskCommand: (
    task: PaletteTask,
    command: PaletteTaskCommand,
    taskView: PaletteTaskView,
  ) => void;
  /** Open the latest session or the details. Does nothing while the saved sessions load. */
  openTask: (task: PaletteTask) => void;
  openChat: (chat: PaletteChat) => void;
  renameChat: (chat: PaletteChat) => void;
  chatHandlers: (chat: PaletteChat) => PaletteChatHandlers;
};

/**
 * Each command closes the palette first, then runs in the workspace of its row. A copy needs no
 * workspace, so it copies at once and closes the palette. Chat actions other than Open chat work
 * in any workspace, as in the sidebar menu.
 */
export function useCommandPaletteRunners({
  close,
  runAfterClose,
  runIntent,
  taskViewOf,
  previousFocus,
}: {
  close: () => void;
  runAfterClose: (run: () => void) => void;
  runIntent: (intent: WorkspaceIntent) => void;
  taskViewOf: (task: PaletteTask) => PaletteTaskView;
  /** The element that had focus before the palette opened. Chat dialogs return focus there. */
  previousFocus: () => HTMLElement | null;
}): CommandPaletteRunners {
  const { copyToClipboard: copyTaskId } = useCopyToClipboard({ successMessage: "Task ID copied" });
  const { copyToClipboard: copyChatValue } = useCopyToClipboard({
    successMessage: "Copied to clipboard",
    getSuccessDescription: (value) => value,
  });
  const { requestDialog } = useSessionMenu();
  const setUnread = useSetSessionUnreadKey();
  const runAction = (action: PaletteAction): void => runAfterClose(action.run);
  /** Copy inside the key or click event, because a browser can ask for a user gesture. */
  const copyAndClose = (copy: (value: string) => Promise<boolean>, value: string): void => {
    void copy(value);
    close();
  };
  const runTaskCommand = (
    task: PaletteTask,
    command: PaletteTaskCommand,
    taskView: PaletteTaskView,
  ): void => {
    if (command.kind === "copy_id") {
      copyAndClose(copyTaskId, task.task.id);
      return;
    }
    runAfterClose(() => runIntent(taskCommandIntent(task, command, taskView)));
  };
  const openTask = (task: PaletteTask): void => {
    const taskView = taskViewOf(task);
    // The footer names why Enter waits while the saved sessions load.
    if (taskView.open) runTaskCommand(task, taskView.open, taskView);
  };
  const openChat = (chat: PaletteChat): void => {
    const workspaceId = chat.workspace.workspaceId;
    const href = buildSessionNavigationHref({
      kind: "workspace_session",
      workspaceId,
      sessionId: chat.session.id,
    });
    runAfterClose(() => runIntent({ workspaceId, run: ({ navigate }) => navigate(href) }));
  };
  const openChatDialog = (chat: PaletteChat, action: "rename" | "archive"): void => {
    runAfterClose(() =>
      requestDialog({
        action,
        workspace: chat.workspace,
        record: chat.session,
        onCloseAutoFocus: (event) => {
          // The dialog has no trigger, so it gives focus back to the element before the palette.
          event.preventDefault();
          const element = previousFocus();
          if (element?.isConnected) element.focus({ preventScroll: true });
        },
      }),
    );
  };
  const renameChat = (chat: PaletteChat): void => openChatDialog(chat, "rename");
  const chatHandlers = (chat: PaletteChat): PaletteChatHandlers => ({
    open: () => openChat(chat),
    setUnread: (unread) =>
      runAfterClose(() =>
        setUnread(workspaceSessionReadKey(chat.workspace.workspaceId, chat.session), unread),
      ),
    rename: () => renameChat(chat),
    archive: () => openChatDialog(chat, "archive"),
    copy: (value) => copyAndClose(copyChatValue, value),
  });
  return { runAction, runTaskCommand, openTask, openChat, renameChat, chatHandlers };
}

/** The task view of a row, with the pending workflow state when its workspace is active. */
export function usePaletteTaskViews(
  data: CommandPaletteData,
): (task: PaletteTask) => PaletteTaskView {
  const { kanbanPendingState } = useRequiredTaskWorkflowActions();
  const activeWorkspaceId = useWorkspaceState().activeWorkspace?.workspaceId ?? null;
  return (task) =>
    buildPaletteTaskView({
      task: task.task,
      sessions: data.sessionsByTaskKey.get(task.key),
      live: liveStateOf(data.live, task.workspace.workspaceId),
      pendingState:
        task.workspace.workspaceId === activeWorkspaceId ? kanbanPendingState : undefined,
    });
}
