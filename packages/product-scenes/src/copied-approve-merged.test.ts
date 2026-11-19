import { describe, expect, test } from "bun:test";
import { CLOSE_TASK_DIALOG_TEXT, mergedStatusText } from "./replicas/tasks/CloseTaskDialog";
import {
  BOARD,
  CLOSED_FEEDBACK,
  MERGED_CARD,
  MERGED_TIP,
  TARGET,
  TASK_IDENTITY,
} from "./scenes/approve-merged/sample";
import { importProduct, readProduct } from "./test-support/product-source";
import { reviewTask, type TaskCard } from "./test-support/review-task";
type Footer = {
  leadingCoreAction: { label: string; emphasis: string; confirmation: string } | null;
  shortcuts: readonly { label: string }[];
  actions: { primaryAction: string | null };
};
type TargetBranch = { branch: string; remote: string };
/** A saved session of the task, with the fields that the footer reads. */
type SavedSession = {
  externalSessionId: string;
  runtimeKind: string;
  taskId: string;
  role: string;
  status: string;
  startedAt: string;
  sessionAssociation: { kind: string; workspaceId: string; taskId: string; role: string };
};

// SAFETY: kanban-task-footer.ts exports this function, and a missing export fails the test.
const { getTaskFooter } = await importProduct<{
  getTaskFooter: (inputs: {
    task: TaskCard;
    taskSessions: readonly never[];
    historicalSessions: readonly unknown[];
    hasActiveSession: boolean;
    taskActivityState: string;
    mergedTarget: string | undefined;
  }) => Footer;
}>("packages/frontend-core/src/tasks/board/kanban-task-footer.ts");
// SAFETY: task-close-copy.ts exports these values, and a missing export fails the test.
const close = await importProduct<{
  TASK_CLOSE_COPY: {
    title: string;
    description: string;
    removeWorktreeLabel: string;
    closeNotes: readonly string[];
  };
  taskCloseConfirmLabel: (isPending: boolean) => string;
}>("packages/frontend-core/src/tasks/details/task-close-copy.ts");
// SAFETY: task-merge-status.ts exports this function, and a missing export fails the test.
const { describeTaskMergeStatus } = await importProduct<{
  describeTaskMergeStatus: (status: {
    taskId: string;
    targetBranch: TargetBranch;
    result: { kind: "merged"; branchOid: string; checkedAt: string };
  }) => { kind: string; text: string };
}>("packages/frontend-core/src/tasks/presentation/task-merge-status.ts");
// SAFETY: target-branch.ts exports this function, and a missing export fails the test.
const { canonicalTargetBranch } = await importProduct<{
  canonicalTargetBranch: (target: TargetBranch) => string;
}>("packages/frontend-core/src/lib/target-branch.ts");
// The card, the dialog, and the close have some words in their markup, so the test reads them as
// text.
const markup = (
  await Promise.all([
    readProduct("packages/frontend/src/components/features/kanban/kanban-task-card.tsx"),
    readProduct(
      "packages/frontend/src/components/features/task-details/task-close-confirm-dialog.tsx",
    ),
    readProduct(
      "packages/frontend/src/components/features/task-details/task-close-confirm-content.tsx",
    ),
    readProduct("packages/frontend-core/src/tasks/operations/use-task-mutation-commands.ts"),
  ])
).join("\n");

/** A saved session of `role` on the task. */
const session = (role: string, task: TaskCard): SavedSession => ({
  externalSessionId: `${role}-1`,
  runtimeKind: "codex",
  taskId: task.id,
  role,
  status: "idle",
  startedAt: "2026-02-22T12:00:00.000Z",
  sessionAssociation: { kind: "workflow", workspaceId: "w", taskId: task.id, role },
});

describe("the close of a merged task copied from the app", () => {
  test("the merged card leads with Close Task, which opens the close confirmation", () => {
    const task = reviewTask(TASK_IDENTITY.id);
    const footer = getTaskFooter({
      task,
      taskSessions: [],
      historicalSessions: ["build", "qa"].map((role) => session(role, task)),
      hasActiveSession: false,
      taskActivityState: "idle",
      mergedTarget: TARGET,
    });
    expect(footer.leadingCoreAction).toMatchObject({
      label: MERGED_CARD.action,
      emphasis: "warning",
      confirmation: "close",
    });
    expect(footer.actions.primaryAction).toBeNull();
    expect(footer.shortcuts.map(({ label }) => label)).toEqual([...MERGED_CARD.links]);
    expect(BOARD.human_review?.[0]).toBe(MERGED_CARD);
  });

  test("the Merged badge and the dialog show the merge status of the target branch", () => {
    const targetBranch = { branch: "main", remote: "origin" };
    expect(canonicalTargetBranch(targetBranch)).toBe(TARGET);
    expect(markup).toContain(MERGED_TIP.replace(TARGET, "{target}"));
    const status = describeTaskMergeStatus({
      taskId: TASK_IDENTITY.id,
      targetBranch,
      result: { kind: "merged", branchOid: "a1b2c3d", checkedAt: "2026-02-22T12:00:00.000Z" },
    });
    expect(status).toEqual({ kind: "merged", text: mergedStatusText(TARGET) });
  });

  test("the dialog uses the words of the app", () => {
    const text = CLOSE_TASK_DIALOG_TEXT;
    expect(close.TASK_CLOSE_COPY.title).toBe(text.title);
    expect(close.TASK_CLOSE_COPY.description).toBe(text.description);
    expect(close.TASK_CLOSE_COPY.removeWorktreeLabel).toBe(text.removeWorktree);
    expect(close.TASK_CLOSE_COPY.closeNotes).toEqual(text.closeNotes);
    expect(close.taskCloseConfirmLabel(false)).toBe(text.confirm);
    expect(close.taskCloseConfirmLabel(true)).toBe(text.closing);
    expect(markup).toContain(`loadingLabel="${text.loading}"`);
    for (const words of [text.noUncommittedChanges, text.worktreeDetails, text.cancel])
      expect(markup).toContain(words);
    expect(markup).toContain(`>${text.afterClosing}<`);
  });

  test("the close shows the success toast of the app", () => {
    expect(markup).toContain(`successTitle: "${CLOSED_FEEDBACK.title}"`);
    expect(markup).toContain(
      `\`${CLOSED_FEEDBACK.description.replace(TASK_IDENTITY.id, "${taskId}")}\``,
    );
  });
});
