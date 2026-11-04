import {
  createDefaultNotificationSettings,
  promptOverrideKey,
  ROLE_INSTRUCTIONS_PROMPT_ID,
  type NotificationSettings,
} from "@openducktor/contracts";
import { builtinTaskWorkflow } from "../src/builtin/task-workflow";

/** A summary in which no built-in workflow artifact is present. */
export const emptyArtifactSummary = () => builtinTaskWorkflow.emptyArtifactSummary();

/** The default notification settings, with the notifications of the built-in workflow. */
export const createBuiltinNotificationSettings = (): NotificationSettings =>
  createDefaultNotificationSettings(builtinTaskWorkflow.notificationDefaults());

/** The override key of a prompt of the built-in workflow. */
export const builtinWorkflowPromptKey = (promptId: string): string =>
  promptOverrideKey({
    ownerKind: "workflow",
    ownerId: builtinTaskWorkflow.definition.id,
    promptId,
  });

/** The override key of the system prompt of a role. */
export const rolePromptKey = (roleId: string): string =>
  promptOverrideKey({ ownerKind: "role", ownerId: roleId, promptId: ROLE_INSTRUCTIONS_PROMPT_ID });

/** The override keys of every prompt of the built-in workflow and its roles. */
export const BUILTIN_PROMPT_OVERRIDE_KEYS: readonly string[] =
  builtinTaskWorkflow.prompts.templates.map(({ key }) => key);

export { BUILTIN_ROLE_IDS } from "../src/builtin/ids";
