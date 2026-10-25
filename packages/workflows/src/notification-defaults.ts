import type {
  CompiledWorkflowDefinition,
  NotificationKindSetting,
  WorkflowNotificationKind,
} from "@openducktor/contracts";

/** The default setting of each notification that the states of the workflow send. */
export const workflowNotificationDefaults = (
  definition: CompiledWorkflowDefinition,
): Partial<Record<WorkflowNotificationKind, NotificationKindSetting>> =>
  Object.fromEntries(
    definition.states.flatMap(({ notification }) =>
      notification ? [[notification.kind, { ...notification.defaultSetting }]] : [],
    ),
  );
