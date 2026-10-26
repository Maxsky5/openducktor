import type { TaskActionTone } from "@openducktor/frontend-core/tasks/board/task-action-presentation";
import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ActionMenu, type ActionMenuItem } from "@/ui/action-menu";
import { Button, type ButtonVariant } from "@/ui/button";
import { IconButton } from "@/ui/icon-button";
import { Text } from "@/ui/text";
import { useAnnounce } from "@/ui/use-announce";
import { taskActionSendsCommand } from "@/features/workflow/task-action-routing";
import { TASK_ACTION_ICONS, taskActionRole } from "../presentation/task-action-paint";
import type { TaskDetailsAction } from "./task-details-model";

/** The desktop primary action variants: violet for the next step, outlined for other starts. */
const ACTION_VARIANTS = {
  prominent: "filled",
  neutral: "outline",
  destructive: "destructive",
  warning: "outline",
} as const satisfies Record<TaskActionTone, ButtonVariant>;

/**
 * The actions of the task details, as the desktop details footer: Edit, then the next workflow
 * action as the wide button. A workflow action that needs the live host follows the command gate.
 */
export function TaskPrimaryAction({
  taskTitle,
  action,
  enabled,
  blockedReason,
  onAction,
  onEdit,
}: {
  taskTitle: string;
  action: TaskDetailsAction | null;
  /** False while the task belongs to another workspace than the selected one. */
  enabled: boolean;
  blockedReason: string | null;
  onAction: (action: TaskDetailsAction) => void;
  onEdit: () => void;
}): ReactElement {
  // A disabled action says why under the buttons, so the reason does not depend on a screen reader.
  const reason =
    blockedReason ?? (action?.disabled ? "The session of this action is not found yet." : null);
  useAnnounce(reason);
  return (
    <View style={styles.root}>
      <View style={styles.row}>
        <Button
          label="Edit"
          icon="pencil-line"
          variant="outline"
          disabled={!enabled}
          accessibilityLabel={`Edit ${taskTitle}`}
          onPress={onEdit}
          fill={action === null}
        />
        {action ? (
          <Button
            label={action.label}
            icon={TASK_ACTION_ICONS[action.action]}
            roleIcon={taskActionRole(action.action) ?? undefined}
            variant={ACTION_VARIANTS[action.tone]}
            fill
            disabled={!enabled || action.disabled}
            command={taskActionSendsCommand(action.action)}
            accessibilityLabel={`${action.label} for ${taskTitle}`}
            onPress={() => onAction(action)}
          />
        ) : null}
      </View>
      {reason ? (
        <Text variant="footnote" tone="secondary" accessibilityLiveRegion="polite">
          {reason}
        </Text>
      ) : null}
    </View>
  );
}

/** The trigger of the task actions menu: Edit, the other workflow actions, and Delete. */
export function TaskActionsMenu({
  taskTitle,
  items,
  onSelect,
}: {
  taskTitle: string;
  items: readonly ActionMenuItem[];
  onSelect: (id: string) => void;
}): ReactElement {
  return (
    <ActionMenu title={taskTitle} items={items} onSelect={onSelect}>
      <IconButton
        icon="more"
        accessibilityLabel={`More actions for ${taskTitle}`}
        onPress={() => {}}
      />
    </ActionMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { gap: theme.space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
}));
