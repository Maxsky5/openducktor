import type { TaskMetadataArtifact } from "@openducktor/contracts";
import { Effect } from "effect";
import { canSetSpecFromStatus } from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";
import { workflowArtifactChange } from "../artifact-changes";
import { TaskMutationProgressFailure } from "../task-mutation-progress-failure";
import type {
  CreateTaskServiceInput,
  TaskService,
  TaskServiceError,
  TaskSetPlanResult,
} from "../task-service";
import { createSetPlanUseCase } from "./set-plan";

type WorkflowArtifactUseCases = Pick<
  TaskService,
  "specGet" | "saveSpecArtifact" | "planGet" | "savePlanArtifact" | "qaGetReport"
> & {
  setSpec(
    input: Parameters<TaskService["setSpec"]>[0],
  ): Effect.Effect<TaskMetadataArtifact, TaskServiceError | TaskMutationProgressFailure>;
  setPlan(
    input: Parameters<TaskService["setPlan"]>[0],
  ): Effect.Effect<TaskSetPlanResult, TaskServiceError | TaskMutationProgressFailure>;
};

export const createWorkflowArtifactUseCases = ({
  taskStore,
}: CreateTaskServiceInput): WorkflowArtifactUseCases => ({
  specGet(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const metadata = yield* taskStore.getTaskMetadata({ repoPath, taskId });

      return metadata.spec;
    });
  },

  setSpec(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId, markdown } = input;
      const currentTasks = yield* taskStore.listTasks({ repoPath });
      const current = currentTasks.find((task) => task.id === taskId);
      if (!current) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `Task not found: ${taskId}`,
            details: { repoPath, taskId },
          }),
        );
      }
      if (!canSetSpecFromStatus(current.status)) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `set_spec is only allowed from open/spec_ready/ready_for_dev/in_progress/blocked/ai_review/human_review (current: ${current.status})`,
            details: { repoPath, taskId, status: current.status },
          }),
        );
      }

      const artifact = yield* taskStore.setSpecArtifact({ repoPath, taskId, markdown });
      if (current.status === "open") {
        const transition = yield* Effect.result(
          taskStore.transitionTask({ repoPath, taskId, status: "spec_ready" }),
        );
        if (transition._tag === "Failure") {
          return yield* Effect.fail(
            new TaskMutationProgressFailure({
              operation: "set-spec",
              artifactChanges: [workflowArtifactChange(taskId, "spec")],
              changes: { taskIds: [taskId], removedTaskIds: [] },
              failure: transition.failure,
            }),
          );
        }
      }

      return artifact;
    });
  },

  saveSpecArtifact(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId, markdown } = input;
      yield* taskStore.getTask({ repoPath, taskId });

      return yield* taskStore.setSpecArtifact({ repoPath, taskId, markdown });
    });
  },

  planGet(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const metadata = yield* taskStore.getTaskMetadata({ repoPath, taskId });

      return metadata.plan;
    });
  },

  setPlan: createSetPlanUseCase(taskStore),

  savePlanArtifact(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId, markdown } = input;
      yield* taskStore.getTask({ repoPath, taskId });

      return yield* taskStore.setPlanArtifact({ repoPath, taskId, markdown });
    });
  },

  qaGetReport(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const metadata = yield* taskStore.getTaskMetadata({ repoPath, taskId });

      if (!metadata.qaReport) {
        return { markdown: "" };
      }

      const result: TaskMetadataArtifact = {
        markdown: metadata.qaReport.markdown,
      };
      if (metadata.qaReport.updatedAt !== undefined) {
        result.updatedAt = metadata.qaReport.updatedAt;
      }
      if (metadata.qaReport.revision !== undefined) {
        result.revision = metadata.qaReport.revision;
      }
      if (metadata.qaReport.error !== undefined) {
        result.error = metadata.qaReport.error;
      }
      return result;
    });
  },
});
