import { TASK_CLOSED_STATE, type WorkflowDocumentDefinition } from "@openducktor/contracts";
import { eventSenders } from "./event-senders";

/** One step from a blank workflow to a published one, and whether the workflow already did it. */
export type GettingStartedStep = {
  readonly id: "columns" | "connect" | "triggers" | "agent" | "publish";
  readonly title: string;
  readonly how: string;
  readonly done: boolean;
};

/**
 * The steps that turn a workflow into one that tasks can use. Each step reads the document, so
 * the list follows every edit, an undo too, and nothing else stores it.
 */
export const gettingStartedSteps = (
  definition: WorkflowDocumentDefinition,
  {
    published,
    hasDraft,
    errorCount = 0,
  }: { published: boolean; hasDraft: boolean; errorCount?: number },
): GettingStartedStep[] => {
  const senders = eventSenders(definition);
  const leaves = new Set(definition.events.flatMap(({ from }) => from));
  const stuck = definition.states.filter(({ id }) => id !== TASK_CLOSED_STATE && !leaves.has(id));
  return [
    {
      id: "columns",
      title: "Add states",
      // No break inside a button name.
      how: "One state per board column. Use Add\u00a0a\u00a0state.",
      done: definition.states.length > 2,
    },
    {
      id: "connect",
      title: "Connect them",
      how:
        stuck.length > 0
          ? `Drag from any dot of “${stuck[0]!.label || stuck[0]!.id}” onto the next state.`
          : "Drag from any dot of a state onto the next state.",
      done: definition.events.length > 0 && stuck.length === 0,
    },
    {
      id: "triggers",
      title: "Add triggers",
      how: "Open a transition, then add a button or turn on Agents.",
      done: definition.events.length > 0 && definition.events.every(({ id }) => senders.has(id)),
    },
    {
      id: "agent",
      title: "Add an agent step",
      how: "Under Steps, add an agent step.",
      done: definition.steps.some(({ kind }) => kind === "agent"),
    },
    // Problems block the publication, so the step names them while they last.
    errorCount > 0
      ? {
          id: "publish",
          title: `Fix ${errorCount === 1 ? "1 problem" : `${errorCount} problems`}`,
          how: "The bar at the bottom lists them. Then publish.",
          done: false,
        }
      : {
          id: "publish",
          title: "Publish",
          how: "Publish also turns it on for this repository.",
          done: published && !hasDraft,
        },
  ];
};
