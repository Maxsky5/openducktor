import {
  createDefaultNotificationSettings,
  promptOverrideKey,
  ROLE_INSTRUCTIONS_PROMPT_ID,
  type NotificationSettings,
} from "@openducktor/contracts";
import { specPlanBuildWorkflow } from "../src/builtin/spec-plan-build/workflow";

/** A summary in which no Spec, Plan, Build artifact is present. */
export const emptyArtifactSummary = () => specPlanBuildWorkflow.emptyArtifactSummary();

/** The default notification settings, with the notifications of the Spec, Plan, Build workflow. */
export const createSpecPlanBuildNotificationSettings = (): NotificationSettings =>
  createDefaultNotificationSettings(specPlanBuildWorkflow.notificationDefaults());

/** The override key of a prompt of the Spec, Plan, Build workflow. */
export const specPlanBuildPromptKey = (promptId: string): string =>
  promptOverrideKey({
    ownerKind: "workflow",
    ownerId: specPlanBuildWorkflow.definition.id,
    promptId,
  });

/** The override key of the system prompt of a role. */
export const rolePromptKey = (roleId: string): string =>
  promptOverrideKey({ ownerKind: "role", ownerId: roleId, promptId: ROLE_INSTRUCTIONS_PROMPT_ID });

/** The override keys of every prompt of the Spec, Plan, Build workflow and its roles. */
export const SPEC_PLAN_BUILD_PROMPT_OVERRIDE_KEYS: readonly string[] =
  specPlanBuildWorkflow.prompts.templates.map(({ key }) => key);

export { BUILTIN_ROLE_IDS } from "../src/builtin/roles/ids";

/** The reference of the current Spec, Plan, Build revision, as a new object. */
export const specPlanBuildReference = () => ({ ...specPlanBuildWorkflow.reference });
