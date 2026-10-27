import "../../test-support/dom-environment";
import { describe, expect, mock, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import { createActiveWorkspaceWrapper } from "../../test-support/active-workspace-wrapper";
import { enableReactActEnvironment } from "../../test-support/react-act-environment";
import { createHookHarness } from "../../test-support/react-hook-harness";
import {
  createSettingsSnapshotFixture,
  createTaskCardFixture,
} from "../../test-support/shared-test-fixtures";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import { useTaskCloseConfirmDialog } from "./use-task-close-confirm-dialog";

enableReactActEnvironment();

const task = createTaskCardFixture({ id: "TASK-1", title: "Add login", status: "human_review" });

/** A read that waits until the test releases it, so the test sees it in flight. */
type HeldRead = { read: Promise<void> | null; release: () => void };

describe("useTaskCloseConfirmDialog", () => {
  test("keeps the shown impact while it closes, and shows the loader again when it reopens", async () => {
    const held: HeldRead = { read: null, release: () => {} };
    const impactGet = mock(async () => {
      if (held.read) await held.read;
      return {
        worktreePaths: ["/worktrees/TASK-1"],
        branchNames: ["odt/TASK-1"],
        uncommittedFileCount: 0,
        mergeCandidate: false,
        branchOid: "tip",
      };
    });
    const connection = createTestClientConnection({
      client: {
        taskWorktreeCleanupImpactGet: impactGet,
        terminalList: async () => ({ hostInstanceId: "host", terminals: [] }),
        taskStopImpactGet: async () => ({ stoppableSessionCount: 1 }),
        taskMergeStatusGet: async (repoPath: string) => ({ repoPath, tasks: [] }),
        workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
      },
    });
    const harness = createHookHarness(
      useTaskCloseConfirmDialog,
      { task, enabled: true, run: mock(async () => {}), onSucceeded: () => {} },
      { wrapper: createActiveWorkspaceWrapper(connection) },
    );

    try {
      await harness.mount();
      await harness.run((state) => state.openDialog());
      expect(harness.getLatest().dialog.isPreparing).toBe(true);
      await waitFor(() => expect(harness.getLatest().dialog.impact.isReady).toBe(true));
      expect(harness.getLatest().dialog.impact.worktreePaths).toEqual(["/worktrees/TASK-1"]);
      // The loader stays at least 500 ms, and Confirm waits for it.
      expect(harness.getLatest().dialog.isPreparing).toBe(true);
      expect(harness.getLatest().dialog.confirmDisabled).toBe(true);

      // The exit animation still shows what the dialog showed.
      await harness.run((state) => state.dialog.onCancel());
      expect(harness.getLatest().dialog.open).toBe(false);
      expect(harness.getLatest().dialog.impact.worktreePaths).toEqual(["/worktrees/TASK-1"]);
      expect(harness.getLatest().dialog.impact.activeSessionCount).toBe(1);

      // The closed dialog drops its read one timer tick later. A new opening then shows the
      // loader until its own read ends.
      await harness.run(() => new Promise((resolve) => setTimeout(resolve, 0)));
      held.read = new Promise<void>((resolve) => {
        held.release = resolve;
      });
      await harness.run((state) => state.openDialog());
      expect(harness.getLatest().dialog.isPreparing).toBe(true);
      await harness.run(() => held.release());
      await waitFor(() => expect(harness.getLatest().dialog.impact.isReady).toBe(true));
      expect(impactGet).toHaveBeenCalledTimes(2);
    } finally {
      await harness.unmount();
    }
  });
});
