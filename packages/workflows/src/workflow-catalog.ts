import {
  TASK_CLOSED_STATE,
  TASK_OPEN_STATE,
  type AgentRoleDefinition,
  workflowCatalogSchema,
  workflowDefinitionSchema,
  type BoardTaskOrder,
  type WorkflowBoardDefinition,
  type WorkflowCatalog,
  type WorkflowDescriptor,
  type WorkflowReference,
} from "@openducktor/contracts";
import { deepFreeze } from "./deep-freeze";
import { columnOrder } from "./library/column-order";
import { createTaskWorkflow, type TaskWorkflow } from "./task-workflow/task-workflow";

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

/**
 * A workflow version on a board, and whether it is the latest version of its workflow. A
 * display-only version gives the display of its states and adds no column.
 */
export type BoardWorkflow = {
  readonly workflow: TaskWorkflow;
  readonly latest: boolean;
  readonly displayOnly?: boolean;
};

const boardDisplay = (state: TaskWorkflow["definition"]["states"][number]) => ({
  label: state.label,
  title: state.title ?? state.label,
  shortLabel: state.shortLabel ?? state.label,
  tone: state.tone ?? "neutral",
});

const taskOrderOf = (stateId: string): BoardTaskOrder =>
  stateId === TASK_OPEN_STATE ? "priority_then_created" : "updated";

/**
 * The board of a workspace. The caller passes the versions in board order: the default workflow
 * first, then the other workflows by name; each workflow gives its latest version, then its older
 * versions, newest first.
 *
 * `open` is the first column and `closed` the last. The default workflow gives the first order.
 * Each workflow reads its states in board order. A run of its states that the board does not show
 * yet goes between the nearest earlier and the nearest later state of that run that the board
 * shows, spread evenly across that gap, so an early state of a workflow stays early on the board
 * and a late state stays late. States at the same place keep the order in which they came.
 * Display-only versions add no column. A column takes its display from the first latest version
 * that declares the state, else from the first version that declares it.
 */
export const resolveWorkspaceBoard = (
  workflows: readonly BoardWorkflow[],
): WorkflowBoardDefinition => {
  /** The place of each column, from `open` at 0 to `closed` at 1. `closed` is always last. */
  const places = new Map<string, number>([[TASK_OPEN_STATE, 0]]);
  const CLOSED_PLACE = 1;
  const display = new Map<
    string,
    { latest: boolean; state: TaskWorkflow["definition"]["states"][number] }
  >();
  /** Puts a run of new states between two places, spread evenly across the gap. */
  const placeRun = (run: readonly string[], after: number, before: number) => {
    // A later state that the board shows earlier gives no gap: the run then fills the gap after
    // the earlier state.
    const limit =
      before > after
        ? before
        : Math.min(...[...places.values()].filter((place) => place > after), CLOSED_PLACE);
    run.forEach((id, index) => {
      places.set(id, after + ((limit - after) * (index + 1)) / (run.length + 1));
    });
  };
  for (const { workflow, latest, displayOnly } of workflows) {
    const states = columnOrder(workflow.definition.states).map(({ state }) => state);
    for (const state of states) {
      const known = display.get(state.id);
      if (!known || (latest && !known.latest)) display.set(state.id, { latest, state });
    }
    if (displayOnly) continue;
    let after = 0;
    let run: string[] = [];
    for (const { id } of states) {
      const place = id === TASK_CLOSED_STATE ? CLOSED_PLACE : places.get(id);
      if (place === undefined) {
        run.push(id);
        continue;
      }
      if (run.length > 0) placeRun(run, after, place);
      run = [];
      after = Math.max(after, places.get(id) ?? after);
    }
    if (run.length > 0) placeRun(run, after, CLOSED_PLACE);
  }
  // A sort is stable, so states at the same place keep the order in which they came. The
  // tolerance keeps the rounding of fractions, such as 0.6 + 0.2 < 0.8, out of that tie.
  const order = [...places]
    .toSorted(([, left], [, right]) => (Math.abs(left - right) < 1e-9 ? 0 : left - right))
    .map(([id]) => id);
  order.push(TASK_CLOSED_STATE);
  return deepFreeze({
    states: order.map((id) => {
      const known = display.get(id);
      if (!known)
        throw new Error(
          `No workspace workflow declares state "${id}". Fix the workflow inventory.`,
        );
      return { id, ...boardDisplay(known.state), taskOrder: taskOrderOf(id) };
    }),
  });
};

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

/** Checks a workflow inventory once: each workflow version appears once. */
export const validateWorkflowInventory = (workflows: readonly TaskWorkflow[]): void => {
  const references = new Set<string>();
  for (const workflow of workflows) {
    const reference = workflowReferenceKey(workflow.reference);
    if (references.has(reference))
      throw new Error(`Duplicate workflow "${reference}". Fix the host inventory.`);
    references.add(reference);
  }
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
