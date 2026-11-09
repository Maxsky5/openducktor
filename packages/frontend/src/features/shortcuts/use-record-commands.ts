import { workflowShortcutActionId, type ShortcutActionId } from "@openducktor/contracts";
import { Pencil } from "lucide-react";
import { useCommandPalettePageCommands } from "../command-palette/command-palette-context";
import type { PaletteChat, PaletteTask } from "../command-palette/command-palette-types";
import type { PaletteTaskView } from "../command-palette/command-palette-task-model";
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
          const id: ShortcutActionId =
            command.kind === "workflow"
              ? workflowShortcutActionId(entry.item.task.taskWorkflow.definition.id, command.action)
              : command.kind === "core"
                ? command.action.id === "reset_task"
                  ? "task-reset"
                  : "task-close"
                : command.kind === "copy_id"
                  ? "task-copy-id"
                  : command.kind === "open_session"
                    ? "task-latest-session"
                    : `task-${command.kind}`;
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
              id: `chat-${action.key === "read-state" ? (unread ? "read" : "unread") : action.key === "copy-working-directory" ? "copy-path" : action.key === "copy-external-session-id" ? "copy-id" : action.key}` as const,
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
