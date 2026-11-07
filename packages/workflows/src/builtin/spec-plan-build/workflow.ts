import {
  SPEC_PLAN_BUILD_PROMPT_LABELS,
  SPEC_PLAN_BUILD_PROMPT_DESCRIPTIONS,
} from "./prompt-metadata";
import { createTaskWorkflow } from "../../task-workflow/task-workflow";
import { resolveWorkflowBoard } from "../../workflow-catalog";
import { SPEC_PLAN_BUILD_BOARD_LAYOUT } from "./board";
import { SPEC_PLAN_BUILD_DEFINITION } from "./definition";
import { SPEC_PLAN_BUILD_PROMPT_TEMPLATES } from "./prompt-templates";
import { BUILTIN_ROLES } from "../roles/roles";

/** The task workflow of the Spec, Plan, Build definition and its prompt templates. */
export const specPlanBuildWorkflow = createTaskWorkflow(
  SPEC_PLAN_BUILD_DEFINITION,
  Object.values(SPEC_PLAN_BUILD_PROMPT_TEMPLATES).map((template) => ({
    ...template,
    label: SPEC_PLAN_BUILD_PROMPT_LABELS[template.id],
    description: SPEC_PLAN_BUILD_PROMPT_DESCRIPTIONS[template.id],
  })),
  BUILTIN_ROLES,
);

/** The production board of a workspace that uses only the Spec, Plan, Build workflow. */
export const SPEC_PLAN_BUILD_BOARD = resolveWorkflowBoard(SPEC_PLAN_BUILD_BOARD_LAYOUT, [
  specPlanBuildWorkflow,
]);
