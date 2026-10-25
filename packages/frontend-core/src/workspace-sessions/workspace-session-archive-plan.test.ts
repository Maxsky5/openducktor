import { describe, expect, test } from "bun:test";
import type { WorkspaceSessionArchivePreview } from "@openducktor/contracts";
import {
  workspaceSessionRecord,
  worktreeExecutionTarget,
} from "../test-support/workspace-session-fixtures";
import {
  canArchiveWorkspaceSession,
  isWorktreeChat,
  effectiveWorktreeRemoval,
  sharedWorktreeNotice,
  taskWorktreeNotice,
  type WorkspaceSessionArchivePreviewRead,
  worktreeArchiveConfirmation,
  worktreeArchiveNotice,
  worktreeArchiveWarnings,
} from "./workspace-session-archive-plan";

const repoChat = workspaceSessionRecord("repo");
const worktreeChat = workspaceSessionRecord("tree", { executionTarget: worktreeExecutionTarget() });

const previewData = (
  overrides: Partial<WorkspaceSessionArchivePreview> = {},
): WorkspaceSessionArchivePreview => ({
  branchName: "odt/chat",
  worktreeExists: true,
  hasUncommittedChanges: false,
  sharedWith: [],
  taskOwners: [],
  ...overrides,
});

const settled = (
  overrides: Partial<WorkspaceSessionArchivePreview> = {},
): WorkspaceSessionArchivePreviewRead => ({
  data: previewData(overrides),
  isSuccess: true,
  isFetching: false,
});

const pending: WorkspaceSessionArchivePreviewRead = {
  data: undefined,
  isSuccess: false,
  isFetching: true,
};

describe("canArchiveWorkspaceSession", () => {
  test("lets a repository chat archive at once, but not twice", () => {
    expect(isWorktreeChat(repoChat)).toBe(false);
    expect(
      canArchiveWorkspaceSession({
        record: repoChat,
        removeWorktree: true,
        preview: settled(),
        isArchiving: false,
        checking: false,
      }),
    ).toBe(true);
    expect(
      canArchiveWorkspaceSession({
        record: repoChat,
        removeWorktree: false,
        preview: settled(),
        isArchiving: true,
        checking: false,
      }),
    ).toBe(false);
  });

  test("waits for a current preview that names the branch before it removes a worktree", () => {
    const decide = (removeWorktree: boolean, preview: WorkspaceSessionArchivePreviewRead) =>
      canArchiveWorkspaceSession({
        record: worktreeChat,
        removeWorktree,
        preview,
        isArchiving: false,
        checking: preview.isFetching,
      });
    expect(decide(true, pending)).toBe(false);
    expect(decide(true, { ...settled(), isFetching: true })).toBe(false);
    expect(decide(true, settled({ branchName: null }))).toBe(false);
    expect(decide(true, settled())).toBe(true);
    expect(decide(false, settled())).toBe(true);
  });

  test("waits for the worktree check before any archive", () => {
    expect(
      canArchiveWorkspaceSession({
        record: worktreeChat,
        removeWorktree: false,
        preview: pending,
        isArchiving: false,
        checking: true,
      }),
    ).toBe(false);
  });
});

describe("worktreeArchiveConfirmation", () => {
  test("names the worktree and branch the user saw only when removal is on", () => {
    expect(worktreeArchiveConfirmation(worktreeChat, true, settled())).toEqual({
      workingDirectory: "/worktrees/alpha/chat",
      branchName: "odt/chat",
    });
    expect(worktreeArchiveConfirmation(worktreeChat, false, settled())).toBeUndefined();
    expect(worktreeArchiveConfirmation(worktreeChat, true, pending)).toBeUndefined();
  });
});

describe("worktreeArchiveNotice", () => {
  test("explains what stays on disk when removal is off", () => {
    expect(worktreeArchiveNotice(false, settled())).toEqual({
      kind: "keep",
      text: "The worktree and its branch will stay on disk.",
    });
    expect(worktreeArchiveNotice(false, settled({ worktreeExists: false })).kind).toBe("keep");
    expect(
      worktreeArchiveNotice(false, settled({ worktreeExists: false, branchName: null })),
    ).toMatchObject({
      text: "The worktree is missing. Restore the worktree at this path before restoring the chat.",
    });
  });

  test("names the branch that removal deletes", () => {
    expect(worktreeArchiveNotice(true, settled())).toMatchObject({
      kind: "delete_branch",
      branchName: "odt/chat",
    });
    expect(worktreeArchiveNotice(true, pending)).toMatchObject({
      kind: "delete_branch",
      branchName: null,
    });
    expect(worktreeArchiveNotice(true, settled({ branchName: null })).kind).toBe("no_branch");
  });
});

describe("worktreeArchiveWarnings", () => {
  test("warns about local changes and a missing worktree only when removal is on", () => {
    expect(
      worktreeArchiveWarnings(true, previewData({ hasUncommittedChanges: true })).map(
        (warning) => warning.kind,
      ),
    ).toEqual(["local_changes"]);
    expect(worktreeArchiveWarnings(true, previewData({ worktreeExists: false }))).toEqual([
      {
        kind: "worktree_missing",
        text: "The worktree is already missing. Archiving will finish removing its branch if it still exists.",
      },
    ]);
    expect(
      worktreeArchiveWarnings(true, previewData({ worktreeExists: false, branchName: null })),
    ).toEqual([{ kind: "worktree_missing", text: "The worktree is already missing." }]);
    expect(worktreeArchiveWarnings(false, previewData({ hasUncommittedChanges: true }))).toEqual(
      [],
    );
    expect(worktreeArchiveWarnings(true, undefined)).toEqual([]);
  });
});

test("keeps a worktree that other saved chats need and names them", () => {
  const shared = settled({
    sharedWith: [
      { workspaceId: "alpha", sessionId: "a", title: "Login fix" },
      { workspaceId: "alpha", sessionId: "b", title: "Docs" },
    ],
  });
  expect(effectiveWorktreeRemoval(true, shared, false)).toBe(false);
  expect(sharedWorktreeNotice(shared)).toBe(
    "This worktree stays because these saved chats need it for files or history: Login fix, Docs.",
  );
  expect(effectiveWorktreeRemoval(true, settled(), false)).toBe(true);
  expect(sharedWorktreeNotice(settled())).toBeNull();
});

test("keeps a worktree that open tasks need and names them", () => {
  const owned = settled({
    taskOwners: [{ workspaceId: "alpha", taskId: "odt-1", title: "Login" }],
  });
  expect(effectiveWorktreeRemoval(true, owned, false)).toBe(false);
  expect(taskWorktreeNotice(owned)).toBe(
    "This worktree stays because these tasks need it: Login (odt-1).",
  );
  expect(taskWorktreeNotice(settled())).toBeNull();
});

test("removes nothing while the worktree check runs", () => {
  expect(effectiveWorktreeRemoval(true, settled(), true)).toBe(false);
});

test("a missing worktree with a branch restores from the default branch", () => {
  expect(worktreeArchiveNotice(false, settled({ worktreeExists: false }))).toEqual({
    kind: "keep",
    text: "The worktree is missing. Restoring this chat creates a fresh worktree from the default branch.",
  });
});
