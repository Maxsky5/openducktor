import {
  BUILTIN_PROMPT_TEMPLATE_LABELS,
  BUILTIN_PROMPT_TEMPLATE_DESCRIPTIONS,
} from "./prompt-metadata";
import { createTaskWorkflow } from "../task-workflow/task-workflow";
import { resolveWorkflowBoard } from "../workflow-catalog";
import { BUILTIN_BOARD_LAYOUT } from "./board";
import { BUILTIN_DEFINITION } from "./definition";
import { PROMPT_TEMPLATES } from "./prompt-templates";
import { BUILTIN_ROLES } from "./roles";

/** The built-in role system prompts. The role catalog owns them, not the workflow. */
const roleSystemPromptIds = new Set(BUILTIN_ROLES.map(({ systemPrompt }) => systemPrompt.id));

/** The task workflow of the built-in definition and its prompt templates. */
export const builtinTaskWorkflow = createTaskWorkflow(
  BUILTIN_DEFINITION,
  Object.values(PROMPT_TEMPLATES)
    .filter(({ id }) => !roleSystemPromptIds.has(id))
    .map((template) => ({
      ...template,
      label: BUILTIN_PROMPT_TEMPLATE_LABELS[template.id],
      description: BUILTIN_PROMPT_TEMPLATE_DESCRIPTIONS[template.id],
    })),
  BUILTIN_ROLES,
);

/** The production board of a workspace that uses only the built-in workflow. */
export const BUILTIN_BOARD = resolveWorkflowBoard(BUILTIN_BOARD_LAYOUT, [builtinTaskWorkflow]);
