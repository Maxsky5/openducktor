import type {
  WorkflowDocument,
  WorkflowLibrary,
  WorkflowProblem,
  WorkflowStateDefinition,
} from "@openducktor/contracts";
import {
  checkWorkflowDocument,
  type CompiledWorkflowCatalog,
  requireCatalogWorkflow,
  type WorkflowCheckContext,
  type WorkflowElementKey,
  type WorkflowReferenceIndex,
  workflowReferenceIndex,
} from "@openducktor/workflows";
import { type CanvasGraph, deriveCanvasGraph, type ProblemLevel } from "./canvas-graph";
import { eventNames, type ProblemTarget, problemTarget } from "./document-elements";

/** The fields that a state shares with the same state ID in another custom workflow. */
export type SharedStateDisplay = Pick<
  WorkflowStateDefinition,
  "label" | "title" | "shortLabel" | "tone"
>;

/** The check context of a draft, and the state IDs that other workflows use. */
export type EditorCheckContext = WorkflowCheckContext & {
  readonly sharedStateIds: ReadonlySet<string>;
  /** The display of each state ID of the other custom workflows. A new state copies it. */
  readonly sharedStates: ReadonlyMap<string, SharedStateDisplay>;
};

/**
 * The check context from the host catalog and library: the catalog roles, the latest version of
 * each other custom workflow, and the other workflow IDs while the workflow has no version. A
 * read-only view checks nothing, so it reads no other workflow.
 */
export const editorCheckContext = (
  catalog: CompiledWorkflowCatalog,
  library: WorkflowLibrary,
  workflowId: string,
  { published, readOnly }: { readonly published: boolean; readonly readOnly: boolean },
): EditorCheckContext => {
  const others = library.workflows.filter(({ id }) => id !== workflowId);
  const otherWorkflows = readOnly
    ? []
    : others.flatMap(({ id, source, latestVersion }) =>
        source === "custom" && latestVersion !== null
          ? [requireCatalogWorkflow(catalog, { id, revision: latestVersion }).definition]
          : [],
      );
  const sharedStateIds = new Set<string>();
  for (const workflow of catalog.workflows.values())
    if (workflow.reference.id !== workflowId)
      for (const { id } of workflow.definition.states) sharedStateIds.add(id);
  const sharedStates = new Map<string, SharedStateDisplay>();
  for (const workflow of otherWorkflows)
    for (const { id, label, title, shortLabel, tone } of workflow.states)
      if (!sharedStates.has(id)) sharedStates.set(id, { label, title, shortLabel, tone });
  return {
    roles: catalog.roles,
    otherWorkflows,
    sharedStates,
    takenWorkflowIds: published ? new Set() : new Set(others.map(({ id }) => id)),
    sharedStateIds,
  };
};

export type LocatedProblem = WorkflowProblem & { readonly target: ProblemTarget };

export type EditorView = {
  readonly index: WorkflowReferenceIndex;
  readonly problems: readonly LocatedProblem[];
  readonly problemsByElement: ReadonlyMap<WorkflowElementKey, readonly LocatedProblem[]>;
  /** The worst problem of each element with a problem. */
  readonly problemLevels: ReadonlyMap<WorkflowElementKey, ProblemLevel>;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly graph: CanvasGraph;
  /**
   * The name of each state, transition, button, step, artifact, and role by ID, as the editor shows
   * it, so a problem message names elements the same way. An ID that two kinds share is left out.
   */
  readonly elementNames: ReadonlyMap<string, string>;
};

const NO_PROBLEMS: readonly LocatedProblem[] = [];

const worse = (left: ProblemLevel | undefined, right: ProblemLevel): ProblemLevel =>
  left === "error" || right === "error" ? "error" : "warning";

const elementNamesOf = (
  definition: WorkflowDocument["definition"],
  context: EditorCheckContext,
): ReadonlyMap<string, string> => {
  const roleLabels = new Map(context.roles.map(({ id, label }) => [id, label]));
  const names = new Map<string, string>();
  const shared = new Set<string>();
  const add = (id: string, name: string) => {
    if (names.has(id) || shared.has(id)) {
      names.delete(id);
      shared.add(id);
    } else names.set(id, name);
  };
  for (const { id, label } of definition.states) add(id, label || id);
  for (const [id, name] of eventNames(definition, roleLabels)) add(id, name);
  for (const list of [definition.actions, definition.steps, definition.artifacts])
    for (const { id, label } of list) add(id, label || id);
  for (const { id } of definition.roles) add(id, roleLabels.get(id) ?? id);
  return names;
};

/**
 * Everything that a document snapshot gives the editor, derived once per snapshot: the reference
 * index, the problems with their elements, and the canvas graph. Host problems from a failed
 * publication replace the live problems of the same snapshot. A read-only view checks nothing.
 */
export const deriveEditorView = (
  document: WorkflowDocument,
  context: EditorCheckContext,
  options: { readonly check: boolean; readonly hostProblems: readonly WorkflowProblem[] | null },
): EditorView => {
  const index = workflowReferenceIndex(document.definition);
  const found = !options.check
    ? []
    : (options.hostProblems ?? checkWorkflowDocument(document, context));
  const problems = found.map((problem) => ({
    ...problem,
    target: problemTarget(document, problem.path),
  }));
  const problemsByElement = new Map<WorkflowElementKey, LocatedProblem[]>();
  const levels = new Map<WorkflowElementKey, ProblemLevel>();
  let errorCount = 0;
  for (const problem of problems) {
    const key = problem.target.key;
    const list = problemsByElement.get(key);
    if (list) list.push(problem);
    else problemsByElement.set(key, [problem]);
    levels.set(key, worse(levels.get(key), problem.severity));
    if (problem.severity === "error") errorCount += 1;
  }
  return {
    index,
    // The same empty list each time, so a panel of problems skips the render of a clean edit.
    problems: problems.length === 0 ? NO_PROBLEMS : problems,
    problemsByElement,
    problemLevels: levels,
    errorCount,
    warningCount: problems.length - errorCount,
    graph: deriveCanvasGraph(document, levels, context.sharedStateIds, problemsByElement),
    elementNames: elementNamesOf(document.definition, context),
  };
};
