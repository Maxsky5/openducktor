import { noTaskWorktreeOwners } from "../../test-support/worktree-owners-read";
import "../../test-support/dom-environment";
import { describe, expect, mock, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import { createActiveWorkspaceWrapper } from "../../test-support/active-workspace-wrapper";
import { enableReactActEnvironment } from "../../test-support/react-act-environment";
import { createHookHarness } from "../../test-support/react-hook-harness";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import { useTaskRemoveWorktreeConfirmDialog } from "./use-task-remove-worktree-confirm-dialog";

enableReactActEnvironment();

const task = createTaskCardFixture({
  id: "TASK-1",
  status: "closed",
  availableActions: [],
});

describe("useTaskRemoveWorktreeConfirmDialog", () => {
  test("reads the worktree again when the confirmation opens", async () => {
    let uncommittedFileCount = 0;
    // The new read waits until the test releases it, so the test sees it in flight.
    let heldRead: Promise<void> | null = null;
    const held = { release: () => {} };
    const impactGet = mock(async () => {
      if (heldRead) await heldRead;
      return {
        worktreePaths: ["/worktrees/TASK-1"],
        branchNames: ["odt/TASK-1"],
        uncommittedFileCount,
        mergeCandidate: false,
        branchOid: "tip",
      };
    });
    const connection = createTestClientConnection({
      client: {
        taskWorktreeOwnersGet: async () => noTaskWorktreeOwners,
        taskWorktreeCleanupImpactGet: impactGet,
        terminalList: async () => ({ hostInstanceId: "host", revision: 1, terminals: [] }),
      },
    });
    const Wrapper = createActiveWorkspaceWrapper(connection);
    const harness = createHookHarness(
      useTaskRemoveWorktreeConfirmDialog,
      { task, enabled: true, run: mock(async (_taskId: string) => {}) },
      { wrapper: Wrapper },
    );

    try {
      await harness.mount();
      await waitFor(() => expect(harness.getLatest().isAvailable).toBe(true));
      expect(impactGet).toHaveBeenCalledTimes(1);

      // Files change in the worktree while the sheet stays open.
      uncommittedFileCount = 4;
      heldRead = new Promise<void>((resolve) => {
        held.release = resolve;
      });
      await harness.run((state) => state.openDialog());
      expect(harness.getLatest().dialog.confirmDisabled).toBe(true);

      await harness.run(() => held.release());

      await waitFor(() => expect(harness.getLatest().dialog.impact.uncommittedFileCount).toBe(4));
      // The loader also waits for the owner read, and it shows at least 500 ms.
      await waitFor(() => expect(harness.getLatest().dialog.confirmDisabled).toBe(false), {
        timeout: 1500,
      });
      expect(harness.getLatest().isAvailable).toBe(true);
      expect(impactGet).toHaveBeenCalledTimes(2);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps Confirm disabled and shows the error when the new read fails", async () => {
    let failRead = false;
    const connection = createTestClientConnection({
      client: {
        taskWorktreeOwnersGet: async () => noTaskWorktreeOwners,
        taskWorktreeCleanupImpactGet: async () => {
          if (failRead) throw new Error("The worktree is not readable.");
          return {
            worktreePaths: ["/worktrees/TASK-1"],
            branchNames: ["odt/TASK-1"],
            uncommittedFileCount: 0,
            mergeCandidate: false,
            branchOid: "tip",
          };
        },
        terminalList: async () => ({ hostInstanceId: "host", revision: 1, terminals: [] }),
      },
    });
    const Wrapper = createActiveWorkspaceWrapper(connection);
    const harness = createHookHarness(
      useTaskRemoveWorktreeConfirmDialog,
      { task, enabled: true, run: mock(async (_taskId: string) => {}) },
      { wrapper: Wrapper },
    );

    try {
      await harness.mount();
      await waitFor(() => expect(harness.getLatest().isAvailable).toBe(true));
      failRead = true;
      await harness.run((state) => state.openDialog());

      await waitFor(() =>
        expect(harness.getLatest().dialog.impact.error).toBe("The worktree is not readable."),
      );
      expect(harness.getLatest().dialog.confirmDisabled).toBe(true);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps the action and shows a failed first sheet read until Retry works", async () => {
    let failRead = true;
    let worktreePaths = ["/worktrees/TASK-1"];
    const connection = createTestClientConnection({
      client: {
        taskWorktreeOwnersGet: async () => noTaskWorktreeOwners,
        taskWorktreeCleanupImpactGet: async () => {
          if (failRead) throw new Error("Unable to read the kept worktree: permission denied.");
          return {
            worktreePaths,
            branchNames: [],
            uncommittedFileCount: 0,
            mergeCandidate: false,
            branchOid: null,
          };
        },
        terminalList: async () => ({ hostInstanceId: "host", revision: 1, terminals: [] }),
      },
    });
    const Wrapper = createActiveWorkspaceWrapper(connection);
    const harness = createHookHarness(
      useTaskRemoveWorktreeConfirmDialog,
      { task, enabled: true, run: mock(async (_taskId: string) => {}) },
      { wrapper: Wrapper },
    );

    try {
      await harness.mount();
      await waitFor(() =>
        expect(harness.getLatest().sheetReadError?.error).toBe(
          "Unable to read the kept worktree: permission denied.",
        ),
      );
      // A failed read does not prove that no worktree remains.
      expect(harness.getLatest().isAvailable).toBe(true);

      failRead = false;
      await harness.run((state) => state.sheetReadError?.retry());
      await waitFor(() => expect(harness.getLatest().sheetReadError).toBeNull());
      expect(harness.getLatest().isAvailable).toBe(true);

      // Only a successful read that finds nothing hides the action.
      worktreePaths = [];
      await harness.run((state) => state.dialog.onOpenChange(true));
      await harness.run((state) => state.dialog.onOpenChange(false));
      await waitFor(() => expect(harness.getLatest().isAvailable).toBe(false));
    } finally {
      await harness.unmount();
    }
  });

  test("offers the removal only for a closed task, without a workflow action", async () => {
    const impactGet = mock(async () => ({
      worktreePaths: ["/worktrees/TASK-1"],
      branchNames: ["odt/TASK-1"],
      uncommittedFileCount: 0,
      mergeCandidate: false,
      branchOid: "tip",
    }));
    const connection = createTestClientConnection({
      client: {
        taskWorktreeOwnersGet: async () => noTaskWorktreeOwners,
        taskWorktreeCleanupImpactGet: impactGet,
        terminalList: async () => ({ hostInstanceId: "host", revision: 1, terminals: [] }),
      },
    });
    const Wrapper = createActiveWorkspaceWrapper(connection);
    const harness = createHookHarness(
      useTaskRemoveWorktreeConfirmDialog,
      {
        task: createTaskCardFixture({ id: "TASK-1", status: "human_review", availableActions: [] }),
        enabled: true,
        run: mock(async (_taskId: string) => {}),
      },
      { wrapper: Wrapper },
    );

    try {
      await harness.mount();
      expect(harness.getLatest().isAvailable).toBe(false);
      expect(impactGet).not.toHaveBeenCalled();

      await harness.update({ task, enabled: true, run: mock(async (_taskId: string) => {}) });
      await waitFor(() => expect(harness.getLatest().isAvailable).toBe(true));
      expect(impactGet).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });
});
