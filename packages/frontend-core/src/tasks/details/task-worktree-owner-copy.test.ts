import { describe, expect, test } from "bun:test";
import type { WorktreeOwners } from "@openducktor/contracts";
import { worktreeOwnersRead } from "../../test-support/worktree-owners-read";
import { confirmButtonState } from "./task-cleanup-impact-model";
import { buildTaskDeleteConfirmCopy } from "./task-confirm-copy";
import type { TaskConfirmImpact } from "./task-confirm-dialog-types";
import {
  isWorktreeOwnerReadBlocking,
  worktreeOwnerLines,
  worktreeOwnerReadErrorMessage,
} from "./task-worktree-owner-copy";
import {
  isCloseBlocked,
  isWorktreeRemovalBlocked,
  type TaskWorktreeImpact,
} from "./use-task-close-impact";

const owners = (overrides: Partial<WorktreeOwners> = {}): WorktreeOwners => ({
  checkoutWorkspaces: [],
  tasks: [],
  chats: [],
  historyChats: [],
  ...overrides,
});
const chat = { workspaceId: "repo", sessionId: "chat-1", title: "Hi" };
const fork = { workspaceId: "repo", sessionId: "fork-1", title: "Fork" };
const historyReadError = "Cannot check the native history of saved chat “Old” in workspace Repo.";

const worktreeImpact = (worktreeOwners = worktreeOwnersRead()): TaskWorktreeImpact => ({
  isLoading: false,
  isReady: true,
  error: null,
  retry: () => {},
  worktreePaths: ["/worktrees/repo/task-1"],
  branchNames: ["odt/task-1"],
  uncommittedFileCount: 0,
  terminalCount: 0,
  worktreeOwners,
});

describe("worktree owner copy", () => {
  test("names each owner, and only history owners and history read failures do not block", () => {
    const lines = worktreeOwnerLines(
      worktreeOwnersRead({
        owners: owners({
          checkoutWorkspaces: ["Other"],
          tasks: [{ workspaceId: "repo", taskId: "task-2", title: "Other task" }],
          chats: [chat],
          historyChats: [fork],
        }),
        historyReadErrors: [historyReadError],
      }),
    );
    expect(lines).toEqual([
      {
        text: "Workspaces use a removed worktree as their repository checkout: Other. Remove these workspaces first.",
        blocking: true,
      },
      {
        text: "Open tasks use a removed worktree: Other task (task-2). Close these tasks first.",
        blocking: true,
      },
      {
        text: "Saved sessions work in a removed worktree: “Hi”. Archive these sessions first.",
        blocking: true,
      },
      {
        text: "Saved Claude sessions keep their native history in a removed worktree: “Fork”. These sessions cannot resume after this.",
        blocking: false,
      },
      { text: historyReadError, blocking: false },
    ]);
  });

  test("a failed or running owner read blocks the removal", () => {
    expect(worktreeOwnerReadErrorMessage(worktreeOwnersRead({ error: "Host error." }))).toBe(
      "Unable to check who else needs the worktree: Host error.",
    );
    expect(isWorktreeOwnerReadBlocking(worktreeOwnersRead({ error: "Host error." }))).toBe(true);
    expect(isWorktreeOwnerReadBlocking(worktreeOwnersRead({ isLoading: true }))).toBe(true);
    expect(
      isWorktreeOwnerReadBlocking(worktreeOwnersRead({ historyReadErrors: [historyReadError] })),
    ).toBe(false);
  });

  test("a blocking owner stops Delete, and a history owner only shows a warning", () => {
    const impact = (read = worktreeOwnersRead()): TaskConfirmImpact => ({
      isLoading: false,
      isLoadingStopImpact: false,
      hasManagedSessionCleanup: true,
      managedWorktreeCount: 1,
      terminalCount: 0,
      worktreeOwners: read,
      activeSessionCount: 0,
      activeSessionCountError: null,
      error: null,
    });
    const labels = { idle: "Delete", pending: "Deleting...", checking: "Checking..." };
    const operation = { isPending: false, error: null, errorOutcomeUnknown: false };

    const blocked = impact(worktreeOwnersRead({ owners: owners({ chats: [chat] }) }));
    expect(buildTaskDeleteConfirmCopy({ id: "task-1", title: null }, blocked).errors).toEqual([
      "Saved sessions work in a removed worktree: “Hi”. Archive these sessions first.",
    ]);
    expect(confirmButtonState(blocked, operation, labels).disabled).toBe(true);

    const warned = impact(worktreeOwnersRead({ owners: owners({ historyChats: [fork] }) }));
    const warnedCopy = buildTaskDeleteConfirmCopy({ id: "task-1", title: null }, warned);
    expect(warnedCopy.errors).toEqual([]);
    expect(warnedCopy.warning).toContain(
      "Saved Claude sessions keep their native history in a removed worktree: “Fork”.",
    );
    expect(confirmButtonState(warned, operation, labels).disabled).toBe(false);
  });

  test("the owner read stops a close only when it removes the worktree", () => {
    const blocked = worktreeImpact(worktreeOwnersRead({ owners: owners({ chats: [chat] }) }));
    expect(isCloseBlocked(blocked, true)).toBe(true);
    expect(isCloseBlocked(blocked, false)).toBe(false);
    expect(isWorktreeRemovalBlocked(blocked)).toBe(true);
    expect(
      isCloseBlocked(worktreeImpact(worktreeOwnersRead({ error: "Host error." })), false),
    ).toBe(false);
    expect(
      isCloseBlocked(
        worktreeImpact(worktreeOwnersRead({ owners: owners({ historyChats: [fork] }) })),
        true,
      ),
    ).toBe(false);
  });
});
