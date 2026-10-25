import { describe, expect, test } from "bun:test";
import type {
  TaskApprovalApprovalModalModel,
  TaskApprovalCompletionModalModel,
} from "../approval/task-approval-types";
import { buildWorkflowPendingState, getApprovingTaskId } from "./task-workflow-pending-state";

const noop = (): void => {};

const approvalModal = (
  overrides: Partial<TaskApprovalApprovalModalModel> = {},
): TaskApprovalApprovalModalModel => ({
  open: true,
  taskId: "TASK-1",
  isSubmitting: false,
  errorMessage: null,
  errorOutcomeUnknown: false,
  onOpenChange: noop,
  stage: "approval",
  isLoading: false,
  mode: "direct_merge",
  mergeMethod: "merge_commit",
  pullRequestDraftMode: "manual",
  pullRequestSupported: false,
  pullRequestAvailable: false,
  pullRequestUnavailableReason: null,
  hasUncommittedChanges: false,
  uncommittedFileCount: 0,
  pullRequestUrl: null,
  title: "",
  body: "",
  squashCommitMessage: "",
  squashCommitMessageTouched: false,
  hasSuggestedSquashCommitMessage: false,
  targetBranch: null,
  onModeChange: noop,
  onMergeMethodChange: noop,
  onPullRequestDraftModeChange: noop,
  onTitleChange: noop,
  onBodyChange: noop,
  onSquashCommitMessageChange: noop,
  onConfirm: noop,
  ...overrides,
});

const completionModal = (isSubmitting: boolean): TaskApprovalCompletionModalModel => ({
  open: true,
  taskId: "TASK-2",
  isSubmitting,
  errorMessage: null,
  errorOutcomeUnknown: false,
  onOpenChange: noop,
  stage: "complete_direct_merge",
  targetBranch: null,
  publishTarget: null,
  publicationPreview: null,
  onSkipDirectMergeCompletion: noop,
  onCompleteDirectMerge: noop,
});

describe("getApprovingTaskId", () => {
  test("names the task while its approval loads or submits", () => {
    expect(getApprovingTaskId(null)).toBeNull();
    expect(getApprovingTaskId(approvalModal())).toBeNull();
    expect(getApprovingTaskId(approvalModal({ isLoading: true }))).toBe("TASK-1");
    expect(getApprovingTaskId(approvalModal({ isSubmitting: true }))).toBe("TASK-1");
    expect(getApprovingTaskId(completionModal(false))).toBeNull();
    expect(getApprovingTaskId(completionModal(true))).toBe("TASK-2");
  });
});

describe("buildWorkflowPendingState", () => {
  test("names only the tasks whose actions submit", () => {
    expect(
      buildWorkflowPendingState({
        isSessionStarting: true,
        taskApprovalModal: approvalModal({ isSubmitting: true }),
        humanReviewFeedbackModal: { taskId: "TASK-3", isSubmitting: true },
        resetImplementationModal: { taskId: "TASK-4", isSubmitting: false },
      }),
    ).toEqual({
      isSessionStarting: true,
      approvingTaskId: "TASK-1",
      requestingChangesTaskId: "TASK-3",
      resettingImplementationTaskId: null,
    });
    expect(
      buildWorkflowPendingState({
        isSessionStarting: false,
        taskApprovalModal: null,
        humanReviewFeedbackModal: null,
        resetImplementationModal: { taskId: "TASK-4", isSubmitting: true },
      }),
    ).toEqual({
      isSessionStarting: false,
      approvingTaskId: null,
      requestingChangesTaskId: null,
      resettingImplementationTaskId: "TASK-4",
    });
  });
});
