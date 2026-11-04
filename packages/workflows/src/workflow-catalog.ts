import {
  agentRoleDefinitionSchema,
  type AgentRoleDefinition,
  type CompiledAgentRoleDefinition,
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
  workflow.workflowTemplates.map((template) => ({
    ...template,
    label: template.label ?? template.id,
    description: template.description ?? "",
    roleIds: [...workflow.prompts.templateRoles(template.id)],
  }));

export const taskWorkflowDescriptor = (workflow: TaskWorkflow): WorkflowDescriptor => ({
  definition: workflowDefinitionSchema.parse(workflow.definition),
  templates: workflowPromptTemplates(workflow),
});

/** The catalog role of a bound role, without what the workflow lets it write. */
const catalogRole = ({
  writes: _writes,
  defaultArtifact: _defaultArtifact,
  ...role
}: TaskWorkflow["roles"][number]) => role;

/** The catalog form of the roles that the workflows bind, once each, in first-use order. */
export const workflowRoleCatalog = (
  workflows: readonly TaskWorkflow[],
): readonly AgentRoleDefinition[] => {
  const roles = new Map<string, AgentRoleDefinition>();
  for (const workflow of workflows)
    for (const role of workflow.roles.map(catalogRole))
      if (!roles.has(role.id)) roles.set(role.id, agentRoleDefinitionSchema.parse(role));
  return [...roles.values()];
};

type SharedStateMetadata = Omit<SharedBoardState, "id" | "taskOrder">;
const sharedMetadata = (state: TaskWorkflow["definition"]["states"][number]) => ({
  label: state.label,
  title: state.title ?? state.label,
  shortLabel: state.shortLabel ?? state.label,
  terminal: state.terminal === true,
  tone: state.tone ?? "neutral",
});

/** The latest revision of each workflow, in first-use order. */
export const latestWorkflowRevisions = (
  workflows: readonly TaskWorkflow[],
): readonly TaskWorkflow[] => {
  const latest = new Map<string, TaskWorkflow>();
  for (const workflow of workflows) {
    const known = latest.get(workflow.reference.id);
    if (!known || known.reference.revision < workflow.reference.revision)
      latest.set(workflow.reference.id, workflow);
  }
  return [...latest.values()];
};

/** Remembers the value of each key, and fails when a second owner gives the key another value. */
const sameValueCheck = <Value, Owner>(
  conflict: (key: string, prior: Owner, current: Owner) => string,
) => {
  const values = new Map<string, { encoded: string; owner: Owner }>();
  return (key: string, value: Value, owner: Owner): void => {
    const encoded = JSON.stringify(value);
    const prior = values.get(key);
    if (prior && prior.encoded !== encoded) throw new Error(conflict(key, prior.owner, owner));
    if (!prior) values.set(key, { encoded, owner });
  };
};

/** The shared metadata of each state ID, from the first workflow that uses it. */
const sharedStates = (workflows: readonly TaskWorkflow[]) => {
  const states = new Map<string, SharedStateMetadata>();
  for (const workflow of workflows)
    for (const state of workflow.definition.states)
      if (!states.has(state.id)) states.set(state.id, sharedMetadata(state));
  return states;
};

/**
 * Checks a workflow inventory once: unique references, one catalog role for each role ID, equal
 * shared state metadata for each state ID, and equal notification defaults for each notification
 * kind. Prompt IDs are local to the workflow that owns them, so workflows cannot conflict there.
 */
export const validateWorkflowInventory = (workflows: readonly TaskWorkflow[]): void => {
  const references = new Set<string>();
  const checkRole = sameValueCheck<CompiledAgentRoleDefinition, string>(
    (id, prior, current) =>
      `Role "${id}" differs between workflows "${prior}" and "${current}". Bind one catalog role.`,
  );
  const checkState = sameValueCheck<SharedStateMetadata, string>(
    (id, prior, current) =>
      `Shared state "${id}" conflicts between workflows "${prior}" and "${current}". Use the same label, title, short label, terminal meaning, and tone.`,
  );
  const checkNotification = sameValueCheck<
    NonNullable<TaskWorkflow["definition"]["states"][number]["notification"]>["defaultSetting"],
    { reference: string; state: string }
  >(
    (kind, prior, current) =>
      `Notification "${kind}" has conflicting defaults in "${prior.reference}" state "${prior.state}" and "${current.reference}" state "${current.state}". Use distinct kinds for distinct policies.`,
  );
  for (const workflow of workflows) {
    const reference = workflowReferenceKey(workflow.reference);
    if (references.has(reference))
      throw new Error(`Duplicate workflow "${reference}". Fix the host inventory.`);
    references.add(reference);
    for (const role of workflow.roles.map(catalogRole)) checkRole(role.id, role, reference);
    for (const state of workflow.definition.states) {
      checkState(state.id, sharedMetadata(state), reference);
      if (state.notification)
        checkNotification(state.notification.kind, state.notification.defaultSetting, {
          reference,
          state: state.id,
        });
    }
  }
};

/**
 * Resolves a board layout against the workflows of its workspace. Every state has one column. The
 * workflows come from an inventory that `validateWorkflowInventory` checked.
 */
export const resolveWorkflowBoard = (
  layout: WorkflowBoardLayout,
  workflows: readonly TaskWorkflow[],
): WorkflowBoardDefinition => {
  const metadata = sharedStates(workflows);
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
  readonly roles: readonly AgentRoleDefinition[];
  readonly workflows: ReadonlyMap<string, TaskWorkflow>;
};

/** Parses, compiles, and checks a host catalog. */
export const compileWorkflowCatalog = (source: WorkflowCatalog): CompiledWorkflowCatalog => {
  const catalog = workflowCatalogSchema.parse(source);
  const workflows = catalog.workflows.map(({ definition, templates }) =>
    createTaskWorkflow(definition, templates, catalog.roles),
  );
  validateWorkflowInventory(workflows);
  return {
    hostInstanceId: catalog.hostInstanceId,
    roles: catalog.roles,
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
