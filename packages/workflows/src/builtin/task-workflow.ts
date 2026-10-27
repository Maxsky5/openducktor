import { createTaskWorkflow } from "../task-workflow/task-workflow";
import { BUILTIN_DEFINITION } from "./definition";
import { PROMPT_TEMPLATES } from "./prompt-templates";

/** The task workflow of the built-in definition and its prompt templates. */
export const builtinTaskWorkflow = createTaskWorkflow(
  BUILTIN_DEFINITION,
  Object.values(PROMPT_TEMPLATES),
);
