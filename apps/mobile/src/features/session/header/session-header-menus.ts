import type { AgentStudioQuickActionOption } from "@openducktor/frontend-core/sessions/start/agent-studio-quick-actions";
import { formatElapsedAgo } from "@openducktor/frontend-core/lib/relative-time";
import type { TaskSessionGroup } from "@/features/tasks/details/task-sessions-model";
import { TASK_ACTION_ICONS } from "@/features/tasks/presentation/task-action-paint";
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
      role: group.role,
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
): ActionMenuItem[] =>
  options.map((option) => {
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
    if (option.kind === "task_action") item.icon = TASK_ACTION_ICONS[option.taskAction];
    else if (option.launchActionId === "build_pull_request_generation") {
      item.icon = "git-pull-request";
    } else item.role = option.role;
    return item;
  });
