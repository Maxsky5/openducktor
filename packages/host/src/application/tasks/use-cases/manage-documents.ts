import { Effect } from "effect";
import { canSetSpecFromStatus } from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";
import type { TaskMutationProgressFailure } from "../task-mutation-progress-failure";
import type {
  CreateTaskServiceInput,
  TaskService,
  TaskServiceError,
  TaskSetPlanResult,
} from "../task-service";
import { createSetPlanUseCase } from "./set-plan";

type TaskDocumentUseCases = Omit<
  Pick<
    TaskService,
    "specGet" | "setSpec" | "saveSpecDocument" | "planGet" | "savePlanDocument" | "qaGetReport"
  >,
  "setPlan"
> & {
  setPlan(
    input: Parameters<TaskService["setPlan"]>[0],
  ): Effect.Effect<TaskSetPlanResult, TaskServiceError | TaskMutationProgressFailure>;
};

export const createTaskDocumentUseCases = ({
  taskStore,
}: CreateTaskServiceInput): TaskDocumentUseCases => ({
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

      const document = yield* taskStore.setSpecDocument({ repoPath, taskId, markdown });
      if (current.status === "open") {
        yield* taskStore.transitionTask({ repoPath, taskId, status: "spec_ready" });
      }

      return document;
    });
  },

  saveSpecDocument(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId, markdown } = input;
      yield* taskStore.getTask({ repoPath, taskId });

      return yield* taskStore.setSpecDocument({ repoPath, taskId, markdown });
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

  savePlanDocument(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId, markdown } = input;
      yield* taskStore.getTask({ repoPath, taskId });

      return yield* taskStore.setPlanDocument({ repoPath, taskId, markdown });
    });
  },

  qaGetReport(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const metadata = yield* taskStore.getTaskMetadata({ repoPath, taskId });

      if (!metadata.qaReport) {
        return { markdown: "" };
      }

      return {
        markdown: metadata.qaReport.markdown,
        ...(metadata.qaReport.updatedAt !== undefined
          ? { updatedAt: metadata.qaReport.updatedAt }
          : {}),
        ...(metadata.qaReport.revision !== undefined
          ? { revision: metadata.qaReport.revision }
          : {}),
        ...(metadata.qaReport.error !== undefined ? { error: metadata.qaReport.error } : {}),
      };
    });
  },
});
