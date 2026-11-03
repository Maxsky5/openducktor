import { type WorkflowDefinition, workflowDefinitionSchema } from "@openducktor/contracts";
import {
  createTaskWorkflow,
  type ResolvedTaskCard,
  type TaskPromptTemplate,
  type TaskWorkflow,
  workflowRoleCatalog,
} from "@openducktor/workflows";

/** A new task workflow from edited copies of the definition and prompt templates of a workflow. */
export const editTaskWorkflow = (
  workflow: TaskWorkflow,
  edit: (definition: WorkflowDefinition, templates: TaskPromptTemplate[]) => void,
): TaskWorkflow => {
  const definition = workflowDefinitionSchema.parse(workflow.definition);
  const templates = [...structuredClone(workflow.workflowTemplates)];
  edit(definition, templates);
  return createTaskWorkflow(definition, templates, workflowRoleCatalog([workflow]));
};

/** The task with its workflow rebuilt from edited copies of the definition and prompt templates. */
export const withEditedTaskWorkflow = (
  task: ResolvedTaskCard,
  edit: (definition: WorkflowDefinition, templates: TaskPromptTemplate[]) => void,
): ResolvedTaskCard => ({ ...task, taskWorkflow: editTaskWorkflow(task.taskWorkflow, edit) });
