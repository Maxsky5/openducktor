import {
  workflowIdSchema,
  type CompiledWorkflowDefinition,
  type TaskArtifactSummary,
  type TaskCard,
  type WorkflowInput,
} from "@openducktor/contracts";
import { z } from "zod";
import { WorkflowEvaluationError } from "../evaluate";

/** The task fields that a task workflow reads. */
export type TaskFacts = Pick<TaskCard, "id" | "status" | "issueType" | "artifactSummary">;

export type TaskInputs = {
  /** The task artifact summary is the artifact input. Extra entry fields do not affect evaluation. */
  input(task: TaskFacts): WorkflowInput;
  /**
   * Evaluation is pure, so task lists reuse results for tasks with equal inputs. The key numbers
   * the status, the issue type, and the state of each artifact. An input outside the definition
   * skips the cache, so evaluation reports it.
   */
  cached<T>(evaluate: (input: WorkflowInput) => T): (task: TaskFacts) => T;
  /** A summary in which no workflow artifact is present. */
  emptyArtifactSummary(): TaskArtifactSummary;
};

const issueTypesSchema = z.array(workflowIdSchema).min(1);

/**
 * The issue types of a task workflow. Tasks supply only the issue type, so the definition declares
 * one fact: the `issueType` enum.
 */
export const taskIssueTypes = (definition: CompiledWorkflowDefinition): readonly string[] => {
  const [fact, ...others] = definition.facts;
  const issueTypes = issueTypesSchema.safeParse(
    fact?.id === "issueType" && fact.type === "enum" ? fact.values : undefined,
  );
  if (!issueTypes.success || others.length > 0) {
    throw new WorkflowEvaluationError(
      "invalid_definition",
      `Task workflow "${definition.id}" must declare one fact: the issueType enum with non-blank string values.`,
    );
  }
  return issueTypes.data;
};

export const createTaskInputs = (definition: CompiledWorkflowDefinition): TaskInputs => {
  const { id: workflowId, revision: definitionRevision } = definition;
  const input = (task: TaskFacts): WorkflowInput => ({
    workflowId,
    definitionRevision,
    state: task.status,
    facts: { issueType: task.issueType },
    artifacts: task.artifactSummary,
  });

  const statusIndexes = new Map(definition.states.map(({ id }, index) => [id, index]));
  const issueTypeIndexes = new Map(
    taskIssueTypes(definition).map((value, index) => [value, index]),
  );
  /** Numbers absent, present without a verdict, and present with each verdict. */
  const artifactKeys = definition.artifacts.map((artifact) => {
    const verdicts = artifact.kind === "review" ? artifact.verdicts.map(({ id }) => id) : [];
    return {
      id: artifact.id,
      size: 2 + verdicts.length,
      verdictIndexes: new Map(verdicts.map((verdict, index) => [verdict, 2 + index])),
    };
  });
  const inputKey = (task: TaskFacts): number | undefined => {
    const status = statusIndexes.get(task.status);
    const issueType = issueTypeIndexes.get(task.issueType);
    if (status === undefined || issueType === undefined) return undefined;
    let key = status * issueTypeIndexes.size + issueType;
    for (const { id, size, verdictIndexes } of artifactKeys) {
      const state = task.artifactSummary[id];
      if (state === undefined) return undefined;
      let index = state.present ? 1 : 0;
      if (state.verdict !== undefined) {
        const verdictIndex = verdictIndexes.get(state.verdict);
        if (verdictIndex === undefined || !state.present) return undefined;
        index = verdictIndex;
      }
      key = key * size + index;
    }
    return key;
  };

  return {
    input,
    cached: <T>(evaluate: (input: WorkflowInput) => T) => {
      const cache = new Map<number, T>();
      return (task: TaskFacts): T => {
        const key = inputKey(task);
        if (key === undefined) return evaluate(input(task));
        let result = cache.get(key);
        if (result === undefined) {
          result = evaluate(input(task));
          cache.set(key, result);
        }
        return result;
      };
    },
    emptyArtifactSummary: () =>
      Object.fromEntries(definition.artifacts.map(({ id }) => [id, { present: false }])),
  };
};
