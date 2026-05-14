import {
  canSetPlan,
  canSetSpecFromStatus,
  isActiveOrReviewStatus,
  normalizePlanSubtasks,
  validateEpicSubtasksReplaceable,
  validatePlanSubtaskRules,
} from "../../../domain/task";
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
  async specGet(input) {
    const { repoPath, taskId } = input;
    const metadata = await taskStore.getTaskMetadata({ repoPath, taskId });

    return metadata.spec;
  },

  async setSpec(input) {
    const { repoPath, taskId, markdown } = input;
    const currentTasks = await taskStore.listTasks({ repoPath });
    const current = currentTasks.find((task) => task.id === taskId);
    if (!current) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (!canSetSpecFromStatus(current.status)) {
      throw new Error(
        `set_spec is only allowed from open/spec_ready/ready_for_dev/in_progress/blocked/ai_review/human_review (current: ${current.status})`,
      );
    }

    const document = await taskStore.setSpecDocument({ repoPath, taskId, markdown });
    if (current.status === "open") {
      await taskStore.transitionTask({ repoPath, taskId, status: "spec_ready" });
    }

    return document;
  },

  async saveSpecDocument(input) {
    const { repoPath, taskId, markdown } = input;
    await taskStore.getTask({ repoPath, taskId });

    return taskStore.setSpecDocument({ repoPath, taskId, markdown });
  },

  async planGet(input) {
    const { repoPath, taskId } = input;
    const metadata = await taskStore.getTaskMetadata({ repoPath, taskId });

    return metadata.plan;
  },

  async setPlan(input) {
    const { repoPath, taskId, markdown, hasExplicitSubtasks } = input;
    const subtaskCreates = normalizePlanSubtasks(input.subtasks);
    const currentTasks = await taskStore.listTasks({ repoPath });
    const current = currentTasks.find((task) => task.id === taskId);
    if (!current) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (!canSetPlan(current)) {
      throw new Error(
        `set_plan is not allowed for issue type ${current.issueType} from status ${current.status}. feature/epic allow spec_ready/ready_for_dev/in_progress/blocked/ai_review/human_review; task/bug also allow open.`,
      );
    }

    const isActiveOrReview = isActiveOrReviewStatus(current.status);
    const shouldValidateSubtaskRules =
      current.issueType !== "epic" || !isActiveOrReview || hasExplicitSubtasks;
    const effectiveSubtaskCreates = current.issueType === "epic" ? subtaskCreates : [];
    if (shouldValidateSubtaskRules) {
      validatePlanSubtaskRules(current, currentTasks, subtaskCreates);
    }

    const shouldReplaceEpicSubtasks = current.issueType === "epic" && hasExplicitSubtasks;
    if (shouldReplaceEpicSubtasks) {
      validateEpicSubtasksReplaceable(current, currentTasks);
    }

    const document = await taskStore.setPlanDocument({ repoPath, taskId, markdown });

    if (shouldReplaceEpicSubtasks) {
      await replaceEpicPlanSubtasks(
        taskStore,
        repoPath,
        current,
        currentTasks,
        effectiveSubtaskCreates,
      );
    }

    if (current.status === "open" || current.status === "spec_ready") {
      await taskStore.transitionTask({ repoPath, taskId, status: "ready_for_dev" });
    }

    return document;
  },

  async savePlanDocument(input) {
    const { repoPath, taskId, markdown } = input;
    await taskStore.getTask({ repoPath, taskId });

    return taskStore.setPlanDocument({ repoPath, taskId, markdown });
  },

  async qaGetReport(input) {
    const { repoPath, taskId } = input;
    const metadata = await taskStore.getTaskMetadata({ repoPath, taskId });

    if (!metadata.qaReport) {
      return { markdown: "" };
    }

    return {
      markdown: metadata.qaReport.markdown,
      ...(metadata.qaReport.updatedAt !== undefined
        ? { updatedAt: metadata.qaReport.updatedAt }
        : {}),
      ...(metadata.qaReport.revision !== undefined ? { revision: metadata.qaReport.revision } : {}),
      ...(metadata.qaReport.error !== undefined ? { error: metadata.qaReport.error } : {}),
    };
  },
});
