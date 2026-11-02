import type { TaskChangeSet, TaskMetadataArtifact } from "@openducktor/contracts";
import type { TaskWorkflow, TaskWorkflowArtifact } from "@openducktor/workflows";
import { Effect, Result } from "effect";
import {
  HostValidationError,
  type HostValidationErrorAggregate,
} from "../../../effect/host-errors";
import { decideTaskEventInput, decisionTransition } from "../support/task-workflow-events";
import type { AtomicWorkflowArtifactWrite, TaskRecord } from "../../../ports/task-repository-ports";
import type { WorkflowArtifactInput, WorkflowArtifactSaveInput } from "../task-inputs";
import type { CreateTaskServiceInput, TaskServiceError } from "../task-service";

export type WorkflowArtifactSaveResult = {
  artifact: TaskMetadataArtifact;
  changes: TaskChangeSet;
};

/** The workflow artifact with this code, or an error that lists the workflow codes. */
const requireWorkflowArtifact = (workflow: TaskWorkflow, code: string) => {
  const artifact = workflow.artifact(code);
  return artifact
    ? Effect.succeed(artifact)
    : Effect.fail(
        new HostValidationError({
          field: "code",
          message: `Unknown workflow artifact ${code}. Use one of ${workflow.definition.artifacts.map(({ id }) => id).join(", ")}.`,
          details: { code },
        }),
      );
};

const requireVerdict = (
  artifact: TaskWorkflowArtifact,
  verdict: string | undefined,
  submit: boolean,
) => {
  if (artifact.kind !== "review") {
    return verdict === undefined
      ? Result.succeed(undefined)
      : Result.fail(
          new HostValidationError({
            field: "verdict",
            message: `${artifact.label} has no verdicts. Save it without a verdict.`,
          }),
        );
  }
  const declared = artifact.verdicts.find((candidate) => candidate.id === verdict);
  return declared && submit
    ? Result.succeed(declared)
    : Result.fail(
        new HostValidationError({
          field: "verdict",
          message: `Submit the ${artifact.label} with one verdict: ${artifact.verdicts.map(({ id }) => id).join(" or ")}.`,
        }),
      );
};

/** A session saves only the workflow artifacts that its role writes. A person saves any of them. */
const requireRoleWrites = (workflow: TaskWorkflow, code: string, updatedBy: string) =>
  updatedBy === "user" ||
  (workflow.hasRole(updatedBy) && workflow.role(updatedBy).writes.includes(code))
    ? Effect.void
    : Effect.fail(
        new HostValidationError({
          field: "code",
          message: `The ${updatedBy} role cannot write the ${code} workflow artifact.`,
        }),
      );

export const createWorkflowArtifactUseCases = ({
  taskStore,
  taskWorkflows,
}: CreateTaskServiceInput) => ({
  workflowArtifactGet(
    input: WorkflowArtifactInput,
  ): Effect.Effect<TaskMetadataArtifact, TaskServiceError> {
    return taskStore.getWorkflowArtifact(input);
  },

  /** An artifact and the transition of its event commit together. A draft sends no event. */
  workflowArtifactSave(
    input: WorkflowArtifactSaveInput,
  ): Effect.Effect<WorkflowArtifactSaveResult, TaskServiceError> {
    return Effect.gen(function* () {
      const { repoPath, taskId, code, markdown, submit, sourceTool, updatedBy } = input;
      const current = yield* taskStore.getTask(input);
      const workflow = taskWorkflows.forTask(current);
      const artifact = yield* requireWorkflowArtifact(workflow, code);
      yield* requireRoleWrites(workflow, code, updatedBy);
      const verdict = yield* Effect.fromResult(requireVerdict(artifact, input.verdict, submit));
      const save: AtomicWorkflowArtifactWrite<HostValidationErrorAggregate> = {
        workspaceId: input.workspaceId,
        repoPath,
        taskId,
        code,
        markdown,
        sourceTool,
        updatedBy,
        decide: (current: TaskRecord) => {
          const workflow = taskWorkflows.forTask(current);
          const artifact = workflow.artifact(code);
          if (
            !artifact ||
            (updatedBy !== "user" &&
              (!workflow.hasRole(updatedBy) || !workflow.role(updatedBy).writes.includes(code)))
          ) {
            return Result.fail(
              new HostValidationError({
                field: "code",
                message: `The ${updatedBy} role cannot write the ${code} workflow artifact.`,
              }),
            );
          }
          const checkedVerdict = requireVerdict(artifact, input.verdict, submit);
          if (checkedVerdict._tag === "Failure") return Result.fail(checkedVerdict.failure);
          const eventId = submit
            ? workflow.artifactSubmitEvent(code, checkedVerdict.success?.id)
            : undefined;
          return eventId === undefined
            ? Result.succeed({ status: current.status, workflowId: workflow.definition.id })
            : Result.map(
                decideTaskEventInput(
                  `Saving the ${artifact.label} is`,
                  workflow,
                  eventId,
                  current,
                  { repoPath, taskId, code, issueType: current.issueType, status: current.status },
                ),
                (decision) => ({
                  ...decisionTransition(decision),
                  workflowId: workflow.definition.id,
                }),
              );
        },
      };
      if (verdict) save.verdict = verdict.id;
      const saved = yield* taskStore.saveWorkflowArtifact<HostValidationErrorAggregate>(save);
      return { artifact: saved.artifact, changes: { taskIds: [taskId], removedTaskIds: [] } };
    });
  },
});
