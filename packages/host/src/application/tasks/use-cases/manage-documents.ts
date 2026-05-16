import { Effect } from "effect";
import {
  canSetPlan,
  canSetSpecFromStatus,
  isActiveOrReviewStatus,
  normalizePlanSubtasks,
  validateEpicSubtasksReplaceable,
  validatePlanSubtaskRules,
} from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";
import { replaceEpicPlanSubtasks } from "../support/planning-rules";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskDocumentUseCases = ({
  taskStore,
}: CreateTaskServiceInput): Pick<
  TaskService,
  | "specGet"
  | "setSpec"
  | "saveSpecDocument"
  | "planGet"
  | "setPlan"
  | "savePlanDocument"
  | "qaGetReport"
> => ({
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

  setPlan(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId, markdown, hasExplicitSubtasks } = input;
      const subtaskCreates = normalizePlanSubtasks(input.subtasks);
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
      if (!canSetPlan(current)) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `set_plan is not allowed for issue type ${current.issueType} from status ${current.status}. feature/epic allow spec_ready/ready_for_dev/in_progress/blocked/ai_review/human_review; task/bug also allow open.`,
            details: { repoPath, taskId, issueType: current.issueType, status: current.status },
          }),
        );
      }

      const isActiveOrReview = isActiveOrReviewStatus(current.status);
      const shouldValidateSubtaskRules =
        current.issueType !== "epic" || !isActiveOrReview || hasExplicitSubtasks;
      const effectiveSubtaskCreates = current.issueType === "epic" ? subtaskCreates : [];
      if (shouldValidateSubtaskRules) {
        yield* Effect.try({
          try: () => validatePlanSubtaskRules(current, currentTasks, subtaskCreates),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
      }

      const shouldReplaceEpicSubtasks = current.issueType === "epic" && hasExplicitSubtasks;
      if (shouldReplaceEpicSubtasks) {
        yield* Effect.try({
          try: () => validateEpicSubtasksReplaceable(current, currentTasks),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
      }

      const document = yield* taskStore.setPlanDocument({ repoPath, taskId, markdown });

      if (shouldReplaceEpicSubtasks) {
        yield* replaceEpicPlanSubtasks(
          taskStore,
          repoPath,
          current,
          currentTasks,
          effectiveSubtaskCreates,
        );
      }

      if (current.status === "open" || current.status === "spec_ready") {
        yield* taskStore.transitionTask({ repoPath, taskId, status: "ready_for_dev" });
      }

      return document;
    });
  },

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
