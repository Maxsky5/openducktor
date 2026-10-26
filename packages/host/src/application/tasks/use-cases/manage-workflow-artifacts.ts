import type { TaskChangeSet, TaskMetadataArtifact } from "@openducktor/contracts";
import type { TaskWorkflow, TaskWorkflowArtifact } from "@openducktor/workflows";
import { Effect } from "effect";
import { HostValidationError } from "../../../effect/host-errors";
import { requireTaskEventInput } from "../support/task-workflow-events";
import type { WorkflowArtifactWrite } from "../../../ports/task-repository-ports";
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
      ? Effect.succeed(undefined)
      : Effect.fail(
          new HostValidationError({
            field: "verdict",
            message: `${artifact.label} has no verdicts. Save it without a verdict.`,
          }),
        );
  }
  const declared = artifact.verdicts.find((candidate) => candidate.id === verdict);
  return declared && submit
    ? Effect.succeed(declared)
    : Effect.fail(
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
    return Effect.gen(function* () {
      const { repoPath, taskId, code } = input;
      yield* requireWorkflowArtifact(taskWorkflows.forRepo(repoPath), code);
      const metadata = yield* taskStore.getTaskMetadata({ repoPath, taskId });
      return metadata.artifacts[code] ?? { markdown: "" };
    });
  },

  /** An artifact and the transition of its event commit together. A draft sends no event. */
  workflowArtifactSave(
    input: WorkflowArtifactSaveInput,
  ): Effect.Effect<WorkflowArtifactSaveResult, TaskServiceError> {
    return Effect.gen(function* () {
      const { repoPath, taskId, code, markdown, submit, sourceTool, updatedBy } = input;
      const workflow = taskWorkflows.forRepo(repoPath);
      const artifact = yield* requireWorkflowArtifact(workflow, code);
      yield* requireRoleWrites(workflow, code, updatedBy);
      const verdict = yield* requireVerdict(artifact, input.verdict, submit);
      const save: WorkflowArtifactWrite = {
        repoPath,
        taskId,
        code,
        markdown,
        sourceTool,
        updatedBy,
      };
      const eventId = submit ? workflow.artifactSubmitEvent(code, verdict?.id) : undefined;
      if (eventId !== undefined) {
        const current = yield* taskStore.getTask({ repoPath, taskId });
        const decision = yield* requireTaskEventInput(
          `Saving the ${artifact.label} is`,
          workflow,
          eventId,
          current,
          { repoPath, taskId, code, issueType: current.issueType, status: current.status },
        );
        if (verdict) save.verdict = verdict.id;
        if (decision.kind === "transition") {
          save.status = decision.to;
          save.cause = decision.cause;
        }
      }
      const saved = yield* taskStore.saveWorkflowArtifact(save);
      return { artifact: saved.artifact, changes: { taskIds: [taskId], removedTaskIds: [] } };
    });
  },
});
