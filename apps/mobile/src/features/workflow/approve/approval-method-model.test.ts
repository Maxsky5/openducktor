import { describe, expect, test } from "bun:test";
import type { TaskApprovalApprovalModalModel } from "@openducktor/frontend-core/tasks/approval/task-approval-types";
import type {
  TaskApprovalImpact,
  TaskWorktreeImpact,
} from "@openducktor/frontend-core/tasks/details/use-task-close-impact";
import { approvalChoices as choicesOf } from "./approval-method-model";

const worktree: TaskWorktreeImpact = {
  isLoading: false,
  isReady: true,
  error: null,
  retry: () => {},
  worktreePaths: ["/worktrees/TASK-1"],
  branchNames: ["odt/TASK-1"],
  uncommittedFileCount: 0,
  terminalCount: 0,
};

const impact: TaskApprovalImpact = {
  worktree,
  close: {
    ...worktree,
    taskId: "TASK-1",
    taskTitle: "Task",
    mergeStatus: null,
    activeSessionCount: 0,
  },
};

const approvalChoices = (approval: TaskApprovalApprovalModalModel, isPreparing = false) =>
  choicesOf(approval, impact, isPreparing);

const model = (patch: Partial<TaskApprovalApprovalModalModel>): TaskApprovalApprovalModalModel => ({
  open: true,
  taskId: "TASK-1",
  taskTitle: "Task",
  isSubmitting: false,
  errorMessage: null,
  errorOutcomeUnknown: false,
  removeWorktree: true,
  onRemoveWorktreeChange: () => {},
  onOpenChange: () => {},
  stage: "approval",
  isLoading: false,
  mode: "direct_merge",
  mergeMethod: "merge_commit",
  pullRequestDraftMode: "generate_ai",
  pullRequestSupported: true,
  pullRequestAvailable: true,
  pullRequestUnavailableReason: null,
  approvalContextError: null,
  hasUncommittedChanges: false,
  uncommittedFileCount: 0,
  pullRequestUrl: null,
  title: "",
  body: "",
  squashCommitMessage: "",
  squashCommitMessageTouched: false,
  hasSuggestedSquashCommitMessage: false,
  targetBranch: null,
  onModeChange: () => {},
  onMergeMethodChange: () => {},
  onPullRequestDraftModeChange: () => {},
  onTitleChange: () => {},
  onBodyChange: () => {},
  onSquashCommitMessageChange: () => {},
  onConfirm: () => {},
  ...patch,
});

describe("approvalChoices", () => {
  test("offers Direct Merge methods and merges locally", () => {
    const choices = approvalChoices(model({}));
    expect(choices.modes.map((mode) => mode.label)).toEqual([
      "Direct Merge",
      "Pull Request",
      "Close Task",
    ]);
    expect(choices.mergeMethods?.map((method) => method.label)).toEqual([
      "Merge Commit",
      "Squash",
      "Rebase",
    ]);
    expect(choices.draftModes).toBeNull();
    expect(choices.confirmLabel).toBe("Merge Locally");
    expect(choices.confirmDisabled).toBe(false);
    expect(choices.confirmBlockedReason).toBeNull();
  });

  test("a squash merge needs its commit message", () => {
    const choices = approvalChoices(
      model({ mergeMethod: "squash", squashCommitMessageTouched: true }),
    );
    expect(choices.showSquashMessage).toBe(true);
    expect(choices.confirmDisabled).toBe(true);
    expect(choices.squashMessageError).toBe(true);
    expect(choices.confirmBlockedReason).toBe("Write the squash commit message.");
  });

  test("a pull request is written manually or generated with AI", () => {
    const manual = approvalChoices(model({ mode: "pull_request", pullRequestDraftMode: "manual" }));
    expect(manual.draftModes?.map((mode) => mode.label)).toEqual([
      "Write Manually",
      "Generate With AI",
    ]);
    expect(manual.showPullRequestFields).toBe(true);
    expect(manual.confirmLabel).toBe("Create Pull Request");
    expect(manual.confirmDisabled).toBe(true);
    expect(manual.confirmBlockedReason).toBe("Write the pull request title and description.");
    const generated = approvalChoices(model({ mode: "pull_request" }));
    expect(generated.confirmLabel).toBe("Start PR Generation");
    expect(generated.confirmDisabled).toBe(false);
  });

  test("uncommitted changes block a merge but not a close", () => {
    const choices = approvalChoices(
      model({ hasUncommittedChanges: true, uncommittedFileCount: 2 }),
    );
    expect(choices.confirmDisabled).toBe(true);
    expect(choices.confirmBlockedReason).toBe(
      "Commit or discard the uncommitted changes to merge.",
    );
    const close = approvalChoices(
      model({ mode: "close_task", hasUncommittedChanges: true, uncommittedFileCount: 2 }),
    );
    expect(close.confirmLabel).toBe("Close Task");
    expect(close.confirmDisabled).toBe(false);
    expect(close.mergeMethods).toBeNull();
  });

  test("keeps only Close Task when the approval context read fails", () => {
    const choices = approvalChoices(model({ approvalContextError: "The worktree is detached." }));
    expect(choices.modes.filter((mode) => !mode.disabled).map((mode) => mode.value)).toEqual([
      "close_task",
    ]);
    expect(choices.confirmDisabled).toBe(true);
    expect(choices.confirmBlockedReason).toBe(
      "Close Task does not merge code, so it stays available.",
    );
  });

  test("gives no blocked reason while the approval loads or submits", () => {
    expect(approvalChoices(model({}), true).confirmBlockedReason).toBeNull();
    expect(
      approvalChoices(model({ isSubmitting: true, hasUncommittedChanges: true }))
        .confirmBlockedReason,
    ).toBeNull();
  });

  test("explains why a pull request cannot run now", () => {
    const choices = approvalChoices(
      model({
        mode: "pull_request",
        pullRequestAvailable: false,
        pullRequestUnavailableReason: "GitHub is signed out.",
      }),
    );
    expect(choices.pullRequestUnavailable).toBe("Pull request unavailable: GitHub is signed out.");
    expect(choices.modes.find((mode) => mode.value === "pull_request")?.disabled).toBe(true);
    expect(choices.confirmDisabled).toBe(true);
    expect(choices.confirmBlockedReason).toBe(
      "Pull Request is not available now. Use Direct Merge, or try again later.",
    );
  });

  test("hides Pull Request when the provider does not support it", () => {
    expect(
      approvalChoices(model({ pullRequestSupported: false })).modes.map((mode) => mode.value),
    ).toEqual(["direct_merge", "close_task"]);
  });
});
