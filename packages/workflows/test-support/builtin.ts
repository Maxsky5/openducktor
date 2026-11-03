import {
  createDefaultNotificationSettings,
  type NotificationSettings,
} from "@openducktor/contracts";
import { builtinTaskWorkflow } from "../src/builtin/task-workflow";

/** A summary in which no built-in workflow artifact is present. */
export const emptyArtifactSummary = () => builtinTaskWorkflow.emptyArtifactSummary();

/** The default notification settings, with the notifications of the built-in workflow. */
export const createBuiltinNotificationSettings = (): NotificationSettings =>
  createDefaultNotificationSettings(builtinTaskWorkflow.notificationDefaults());

export { BUILTIN_PROMPT_TEMPLATE_IDS, BUILTIN_ROLE_IDS } from "../src/builtin/ids";
