import { type ResolvedTaskCard, workflowRoleIcon } from "@openducktor/workflows";
import type { AgentStudioQuickActionOption } from "@openducktor/frontend-core/sessions/start/agent-studio-quick-actions";
import { formatElapsedAgo } from "@openducktor/frontend-core/lib/relative-time";
import type { TaskSessionGroup } from "@/features/tasks/details/task-sessions-model";
import {
  coreTaskActionIcon,
  taskActionIcon,
} from "@/features/tasks/presentation/task-action-paint";
import type { ActionMenuItem } from "@/ui/action-menu";

/**
 * The desktop session selector as a menu: the sessions of the task in Workflow Role order, newest
 * first. Each session has the desktop name, such as "Builder #2", its start time, and its status.
 * The session on the screen has a check mark.
 */
export const sessionHistoryItems = (
  groups: readonly TaskSessionGroup[],
  currentKey: string,
  now: number,
): ActionMenuItem[] =>
  groups.flatMap((group) =>
    group.rows.map((row) => ({
      id: row.key,
      title: row.label,
      role: group.iconHint,
      detail: `${formatElapsedAgo(now - Date.parse(row.startedAt))} · ${row.statusLabel}`,
      checked: row.key === currentKey,
    })),
  );

/**
 * The desktop quick actions as menu items, primary action first. Each session action shows the
 * icon of its role, the pull request action shows the pull request icon, and a task action shows
 * its workflow icon. A disabled action tells why under its name. Each action follows the command
 * gate.
 */
export const quickActionItems = (
  options: readonly AgentStudioQuickActionOption[],
  task: ResolvedTaskCard | null,
): ActionMenuItem[] =>
  task
    ? options.map((option) => {
        const item: ActionMenuItem = {
          id: option.id,
          title: option.label,
          disabled: option.disabled,
          // As the desktop marker, the merged Close Task names its target.
          detail:
            option.kind === "task_action" && option.mergedTarget
              ? `Merged into ${option.mergedTarget}`
              : option.disabledReason,
          command: true,
        };
        if (option.kind === "task_action")
          item.icon =
            option.taskAction.kind === "core"
              ? coreTaskActionIcon(option.taskAction.action)
              : taskActionIcon(option.taskAction.action, task);
        else if (task.taskWorkflow.launchAction(option.launchActionId).context === "pull_request") {
          item.icon = "git-pull-request";
        } else item.role = workflowRoleIcon(task.taskWorkflow, option.role);
        return item;
      })
    : [];
