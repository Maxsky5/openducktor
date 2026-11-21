import type { WorkflowReference, WorkspaceWorkflowContext } from "@openducktor/contracts";
import {
  resolveWorkspaceBoard,
  workflowReferenceKey,
  type BoardWorkflow,
  type TaskWorkflow,
} from "@openducktor/workflows";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";

/** The rule of a workflow that not every workspace can use. */
export type WorkflowAvailabilityRule = {
  readonly workflowId: string;
  readonly mode: "only" | "except";
  readonly workspaceIds: readonly string[];
};

/** Whether a workspace can use a workflow. A workflow without a rule is available to all. */
const isAvailableIn = (rule: WorkflowAvailabilityRule | undefined, workspaceId: string) =>
  rule === undefined || (rule.mode === "only") === rule.workspaceIds.includes(workspaceId);

/** The versions of a workflow after `after` and before `before`, both excluded. */
export type DisplayVersionRange = {
  readonly workflowId: string;
  readonly after: number;
  readonly before: number;
};

const byName = (left: TaskWorkflow, right: TaskWorkflow) =>
  left.definition.label.localeCompare(right.definition.label) ||
  left.reference.id.localeCompare(right.reference.id);

/**
 * The workflows that a workspace offers for a new task: the built-in workflow and the latest version
 * of each listed custom workflow, when its rule allows the workspace. The host default comes first,
 * then the others by name. The default is available to every workspace, so it is always there.
 */
export const orderAvailableWorkflows = (
  workspaceId: string,
  {
    defaultWorkflowId,
    rules,
    listedIds,
  }: {
    readonly defaultWorkflowId: string;
    readonly rules: readonly WorkflowAvailabilityRule[];
    /** The custom workflows that the library lists. A deleted workflow keeps only its versions. */
    readonly listedIds: ReadonlySet<string>;
  },
  builtin: TaskWorkflow,
  latest: ReadonlyMap<string, TaskWorkflow>,
) =>
  Effect.gen(function* () {
    const ruleOf = new Map(rules.map((rule) => [rule.workflowId, rule]));
    const available = [
      builtin,
      ...[...latest].filter(([id]) => listedIds.has(id)).map(([, workflow]) => workflow),
    ].filter((workflow) => isAvailableIn(ruleOf.get(workflow.reference.id), workspaceId));
    const defaultWorkflow = available.find(({ reference }) => reference.id === defaultWorkflowId);
    if (!defaultWorkflow)
      return yield* new HostValidationError({
        field: "workflowId",
        message: `The default workflow "${defaultWorkflowId}" is not available in this repository. Choose another default workflow on the Workflows page.`,
        details: { workspaceId, workflowId: defaultWorkflowId },
      });
    const ordered: [TaskWorkflow, ...TaskWorkflow[]] = [
      defaultWorkflow,
      ...available.filter((workflow) => workflow !== defaultWorkflow).sort(byName),
    ];
    return ordered;
  });

/**
 * The versions between an active older version and the latest version of its workflow, when the
 * older version has a state that the latest version dropped. The newest of them that declares such
 * a state gives its column display. Most boards have no such state and need no range.
 */
export const displayVersionRanges = (
  active: readonly TaskWorkflow[],
  latest: ReadonlyMap<string, TaskWorkflow>,
): DisplayVersionRange[] => {
  const oldest = new Map<string, number>();
  for (const workflow of active) {
    const newest = latest.get(workflow.reference.id);
    if (!newest || newest.reference.revision <= workflow.reference.revision) continue;
    const declared = new Set(newest.definition.states.map(({ id }) => id));
    if (workflow.definition.states.every(({ id }) => declared.has(id))) continue;
    const known = oldest.get(workflow.reference.id);
    if (known === undefined || workflow.reference.revision < known)
      oldest.set(workflow.reference.id, workflow.reference.revision);
  }
  return [...oldest].map(([workflowId, after]) => ({
    workflowId,
    after,
    before: latest.get(workflowId)!.reference.revision,
  }));
};

const uniqueReferences = (workflows: readonly TaskWorkflow[]): WorkflowReference[] => {
  const references = new Map<string, WorkflowReference>();
  for (const { reference } of workflows)
    references.set(workflowReferenceKey(reference), { ...reference });
  return [...references.values()];
};

/**
 * The board versions in board order: the default workflow first, then the other workflows by the
 * name of their latest version. Each workflow gives its latest version, then its older versions,
 * newest first. The latest version of a workflow without it among the members, and the given
 * display versions, are display-only: they give the display of the states that the members put on
 * the board, and add no column.
 */
const boardWorkflows = (
  members: readonly TaskWorkflow[],
  defaultWorkflowId: string,
  latest: ReadonlyMap<string, TaskWorkflow>,
  isLatest: (workflow: TaskWorkflow) => boolean,
  displayVersions: readonly TaskWorkflow[],
): BoardWorkflow[] => {
  const groups = new Map<string, Map<number, BoardWorkflow>>();
  for (const workflow of members) {
    const group = groups.get(workflow.reference.id) ?? new Map<number, BoardWorkflow>();
    group.set(workflow.reference.revision, { workflow, latest: isLatest(workflow) });
    groups.set(workflow.reference.id, group);
  }
  for (const [workflowId, group] of groups) {
    const newest = latest.get(workflowId);
    if (newest && !group.has(newest.reference.revision))
      group.set(newest.reference.revision, { workflow: newest, latest: true, displayOnly: true });
  }
  for (const workflow of displayVersions) {
    const group = groups.get(workflow.reference.id);
    if (group && !group.has(workflow.reference.revision))
      group.set(workflow.reference.revision, { workflow, latest: false, displayOnly: true });
  }
  const ordered = [...groups.values()].map((group) =>
    [...group.values()].sort(
      (left, right) => right.workflow.reference.revision - left.workflow.reference.revision,
    ),
  );
  ordered.sort((left, right) => {
    const leftDefault = left[0]!.workflow.reference.id === defaultWorkflowId;
    const rightDefault = right[0]!.workflow.reference.id === defaultWorkflowId;
    if (leftDefault !== rightDefault) return leftDefault ? -1 : 1;
    return byName(left[0]!.workflow, right[0]!.workflow);
  });
  return ordered.flat();
};

/**
 * The workflow choices of a workspace, from the versions that the database reads gave: the board,
 * every version in use, and the new task choices.
 */
export const composeWorkspaceWorkflows = ({
  builtin,
  latest,
  available,
  used,
  active,
  displayVersions,
}: {
  readonly builtin: TaskWorkflow;
  /** The latest version of each custom workflow, by workflow ID. */
  readonly latest: ReadonlyMap<string, TaskWorkflow>;
  /** The workflows that the workspace offers, the default first. */
  readonly available: readonly [TaskWorkflow, ...TaskWorkflow[]];
  /** The versions that the tasks of the workspace use. */
  readonly used: readonly TaskWorkflow[];
  /** The versions that the open tasks of the workspace use. */
  readonly active: readonly TaskWorkflow[];
  /** The versions of the `displayVersionRanges` of the active versions. */
  readonly displayVersions: readonly TaskWorkflow[];
}): Omit<WorkspaceWorkflowContext, "hostInstanceId"> => {
  const [defaultWorkflow] = available;
  const isLatest = (workflow: TaskWorkflow) =>
    workflow.reference.id === builtin.reference.id ||
    latest.get(workflow.reference.id)?.reference.revision === workflow.reference.revision;
  return {
    board: resolveWorkspaceBoard(
      boardWorkflows(
        [...available, ...active],
        defaultWorkflow.reference.id,
        latest,
        isLatest,
        displayVersions,
      ),
    ),
    workflows: uniqueReferences([...available, ...used]),
    newTaskWorkflows: available.map(({ reference }) => ({ ...reference })),
    newTaskWorkflow: { ...defaultWorkflow.reference },
  };
};
