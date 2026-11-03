import {
  workflowCatalogSchema,
  workflowDefinitionSchema,
  type BoardTaskOrder,
  type SharedBoardState,
  type WorkflowBoardDefinition,
  type WorkflowCatalog,
  type WorkflowDescriptor,
  type WorkflowReference,
} from "@openducktor/contracts";
import { deepFreeze } from "./deep-freeze";
import { createTaskWorkflow, type TaskWorkflow } from "./task-workflow/task-workflow";

/** Column order and task order of a board. The workflows that use a state give its metadata. */
export type WorkflowBoardLayout = {
  readonly states: readonly { readonly id: string; readonly taskOrder: BoardTaskOrder }[];
};

export const workflowReferenceKey = ({ id, revision }: WorkflowReference): string =>
  `${id}@${revision}`;

/** The prompt templates of a workflow with their settings labels and roles. */
export const workflowPromptTemplates = (workflow: TaskWorkflow): WorkflowDescriptor["templates"] =>
  workflow.prompts.templates.map((template) => ({
    ...template,
    label: template.label ?? template.id,
    description: template.description ?? "",
    roleIds: [...workflow.prompts.templateRoles(template.id)],
  }));

export const taskWorkflowDescriptor = (workflow: TaskWorkflow): WorkflowDescriptor => ({
  definition: workflowDefinitionSchema.parse(workflow.definition),
  templates: workflowPromptTemplates(workflow),
});

type SharedStateMetadata = Omit<SharedBoardState, "id" | "taskOrder">;
const sharedMetadata = (state: TaskWorkflow["definition"]["states"][number]) => ({
  label: state.label,
  title: state.title ?? state.label,
  shortLabel: state.shortLabel ?? state.label,
  terminal: state.terminal === true,
  tone: state.tone ?? "neutral",
});
const sameMetadata = (left: SharedStateMetadata, right: SharedStateMetadata) =>
  left.label === right.label &&
  left.title === right.title &&
  left.shortLabel === right.shortLabel &&
  left.terminal === right.terminal &&
  left.tone === right.tone;

/**
 * Checks a workflow inventory once: unique references, equal shared state metadata for each state
 * ID, and equal notification defaults for each notification kind. Returns the shared states.
 */
export const validateWorkflowInventory = (
  workflows: readonly TaskWorkflow[],
): ReadonlyMap<string, SharedStateMetadata> => {
  const references = new Set<string>();
  const states = new Map<string, { reference: string; metadata: SharedStateMetadata }>();
  const notifications = new Map<string, { reference: string; state: string; setting: string }>();
  for (const workflow of workflows) {
    const reference = workflowReferenceKey(workflow.reference);
    if (references.has(reference))
      throw new Error(`Duplicate workflow "${reference}". Fix the host inventory.`);
    references.add(reference);
    for (const state of workflow.definition.states) {
      const metadata = sharedMetadata(state);
      const previous = states.get(state.id);
      if (previous && !sameMetadata(previous.metadata, metadata))
        throw new Error(
          `Shared state "${state.id}" conflicts between workflows "${previous.reference}" and "${reference}". Use the same label, title, short label, terminal meaning, and tone.`,
        );
      if (!previous) states.set(state.id, { reference, metadata });
      if (state.notification) {
        const { kind, defaultSetting } = state.notification;
        const setting = JSON.stringify(defaultSetting);
        const prior = notifications.get(kind);
        if (prior && prior.setting !== setting)
          throw new Error(
            `Notification "${kind}" has conflicting defaults in "${prior.reference}" state "${prior.state}" and "${reference}" state "${state.id}". Use distinct kinds for distinct policies.`,
          );
        notifications.set(kind, { reference, state: state.id, setting });
      }
    }
  }
  return new Map([...states].map(([id, { metadata }]) => [id, metadata]));
};

/** Resolves a board layout against the workflows of its workspace. Every state has one column. */
export const resolveWorkflowBoard = (
  layout: WorkflowBoardLayout,
  workflows: readonly TaskWorkflow[],
): WorkflowBoardDefinition => {
  const metadata = validateWorkflowInventory(workflows);
  const positions = new Set<string>();
  for (const { id } of layout.states) {
    if (positions.has(id))
      throw new Error(`Board repeats state "${id}". Give each shared state one position.`);
    positions.add(id);
  }
  for (const workflow of workflows)
    for (const { id } of workflow.definition.states)
      if (!positions.has(id))
        throw new Error(
          `Board is missing state "${id}" used by workflow "${workflowReferenceKey(workflow.reference)}". Add it at an explicit position.`,
        );
  return deepFreeze({
    states: layout.states.map(({ id, taskOrder }) => {
      const shared = metadata.get(id);
      if (!shared)
        throw new Error(`Board state "${id}" belongs to no workspace workflow. Remove it.`);
      return { id, ...shared, taskOrder };
    }),
  });
};

/** A host catalog with each definition compiled once. */
export type CompiledWorkflowCatalog = {
  readonly hostInstanceId: string;
  readonly workflows: ReadonlyMap<string, TaskWorkflow>;
};

/** Parses, compiles, and checks a host catalog. */
export const compileWorkflowCatalog = (source: WorkflowCatalog): CompiledWorkflowCatalog => {
  const catalog = workflowCatalogSchema.parse(source);
  const workflows = catalog.workflows.map(({ definition, templates }) =>
    createTaskWorkflow(definition, templates),
  );
  validateWorkflowInventory(workflows);
  return {
    hostInstanceId: catalog.hostInstanceId,
    workflows: new Map(
      workflows.map((workflow) => [workflowReferenceKey(workflow.reference), workflow]),
    ),
  };
};

export const requireCatalogWorkflow = (
  catalog: CompiledWorkflowCatalog,
  reference: WorkflowReference,
): TaskWorkflow => {
  const workflow = catalog.workflows.get(workflowReferenceKey(reference));
  if (!workflow)
    throw new Error(
      `Workflow "${workflowReferenceKey(reference)}" is unavailable on host "${catalog.hostInstanceId}". Reconnect to an updated host.`,
    );
  return workflow;
};
