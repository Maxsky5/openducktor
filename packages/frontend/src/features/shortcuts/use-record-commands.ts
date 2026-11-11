import { workflowShortcutActionId, type ShortcutActionId } from "@openducktor/contracts";
import { Pencil } from "lucide-react";
import { useCommandPalettePageCommands } from "../command-palette/command-palette-context";
import type { PaletteChat, PaletteTask } from "../command-palette/command-palette-types";
import type {
  PaletteTaskCommand,
  PaletteTaskView,
} from "../command-palette/command-palette-task-model";
import type { CommandPaletteRunners } from "../command-palette/use-command-palette-runners";
import { paletteChatActions } from "../command-palette/command-palette-chat-actions";
import { useSessionUnreadKey } from "@openducktor/frontend-core/sessions/navigation/session-read-state";
import { workspaceSessionReadKey } from "@openducktor/frontend-core/sessions/navigation/session-read-keys";

export function useRecordCommands(
  entry: { kind: "task"; item: PaletteTask } | { kind: "chat"; item: PaletteChat } | null,
  view: PaletteTaskView | null,
  runners: CommandPaletteRunners,
  paletteOnly: boolean,
): void {
  const unread = useSessionUnreadKey(
    entry?.kind === "chat"
      ? workspaceSessionReadKey(entry.item.workspace.workspaceId, entry.item.session)
      : null,
  );
  const commands =
    entry?.kind === "task" && view
      ? view.actions.flatMap((action) => {
          const command = action.command;
          if (command.kind === "open_session" && action.key !== "latest")
            return entry.item.task.taskWorkflow.definition.actions
              .filter(
                (declared) =>
                  entry.item.task.taskWorkflow.viewActionRole(declared.id) === command.session.role,
              )
              .map((declared) => ({
                id: workflowShortcutActionId(
                  entry.item.task.taskWorkflow.definition.id,
                  declared.id,
                ),
                label: declared.label ?? action.label,
                icon: Pencil,
                keywords: action.keywords,
                target: { kind: "task" as const, key: entry.item.key },
                paletteOnly,
                disabledReason: () => (action.disabled ? "This task action is unavailable." : null),
                run: () => runners.runTaskCommand(entry.item, command, view),
              }));
          const id = taskCommandId(entry.item.task.taskWorkflow.definition.id, command);
          return [
            {
              id,
              label: action.label,
              icon: Pencil,
              keywords: action.keywords,
              target: { kind: "task" as const, key: entry.item.key },
              paletteOnly,
              disabledReason: () => (action.disabled ? "This task action is unavailable." : null),
              run: () => runners.runTaskCommand(entry.item, command, view),
            },
          ];
        })
      : entry?.kind === "chat"
        ? paletteChatActions(entry.item, unread, runners.chatHandlers(entry.item)).map(
            (action) => ({
              id: chatCommandId(action.key, unread),
              label: action.label,
              icon: Pencil,
              keywords: action.keywords,
              target: { kind: "chat" as const, key: entry.item.key },
              paletteOnly,
              disabledReason: () => (action.disabled ? "This chat action is unavailable." : null),
              run: action.run,
            }),
          )
        : [];
  useCommandPalettePageCommands(commands);
}

const taskCommandId = (workflowId: string, command: PaletteTaskCommand): ShortcutActionId => {
  switch (command.kind) {
    case "workflow":
      return workflowShortcutActionId(workflowId, command.action);
    case "core":
      return command.action.id === "reset_task" ? "task-reset" : "task-close";
    case "copy_id":
      return "task-copy-id";
    case "open_session":
      return "task-latest-session";
    case "edit":
    case "details":
    case "delete":
      return `task-${command.kind}`;
  }
};

const chatShortcutIds = {
  open: "chat-open",
  rename: "chat-rename",
  archive: "chat-archive",
  "copy-working-directory": "chat-copy-path",
  "copy-external-session-id": "chat-copy-id",
} as const;

const chatCommandId = (
  key: ReturnType<typeof paletteChatActions>[number]["key"],
  unread: boolean,
): ShortcutActionId => {
  if (key === "read-state") return unread ? "chat-read" : "chat-unread";
  return chatShortcutIds[key];
};
