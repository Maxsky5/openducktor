import "../../test-support/dom-environment";
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { RemoteConnectionError } from "@openducktor/host-client/remote";
import { waitFor } from "@testing-library/react";
import type { PropsWithChildren, ReactElement } from "react";
import { ClientConnectionProvider } from "../../connection/client-connection-react";
import * as stopImpactModule from "../../queries/use-task-stop-impact";
import { createFeedbackFake } from "../../test-support/feedback-fake";
import { enableReactActEnvironment } from "../../test-support/react-act-environment";
import { createHookHarness as createSharedHookHarness } from "../../test-support/react-hook-harness";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import * as cleanupImpactModule from "../details/use-task-cleanup-impact";
import { useTaskResetFlow } from "./use-task-reset-flow";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useTaskResetFlow>[0];

const task = createTaskCardFixture({}, { id: "task-1", title: "Task 1" });

const workspaceA = { workspaceId: "workspace-a", repoPath: "/repo-a" };
const workspaceB = { workspaceId: "workspace-b", repoPath: "/repo-b" };

const impactSpies: Array<{ mockRestore(): void }> = [];

const createArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  tasks: [task],
  workspaceIdentity: workspaceA,
  resetTaskImplementation: async () => {},
  closeTaskDetails: () => {},
  ...overrides,
});

const createHookHarness = (
  initialProps: HookArgs,
  feedback: ReturnType<typeof createFeedbackFake> = createFeedbackFake(),
) => {
  const connection = createTestClientConnection({ feedback });
  const wrapper = ({ children }: PropsWithChildren): ReactElement => (
    <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
  );
  return createSharedHookHarness(useTaskResetFlow, initialProps, { wrapper });
};

describe("useTaskResetFlow", () => {
  beforeEach(() => {
    impactSpies.push(
      spyOn(cleanupImpactModule, "useTaskCleanupImpact").mockImplementation(() => ({
        hasCanonicalWorktree: false,
        hasManagedSessionCleanup: false,
        managedWorktreeCount: 0,
        legacyWorktreeCount: 0,
        impactError: null,
        isLoadingImpact: false,
        terminalCount: 0,
      })),
      spyOn(stopImpactModule, "useTaskStopImpact").mockImplementation(() => ({
        stoppableSessionCount: null,
        removedWorktreeCount: null,
        isLoading: false,
        error: null,
        retry: () => {},
      })),
    );
  });

  afterEach(() => {
    for (const spy of impactSpies) {
      spy.mockRestore();
    }
    impactSpies.length = 0;
  });

  test("opens the reset implementation modal for a task", async () => {
    const harness = createHookHarness(createArgs());

    try {
      await harness.mount();
      await harness.run((model) => {
        model.openResetImplementation("task-1");
      });

      expect(harness.getLatest().resetImplementationModal?.taskId).toBe("task-1");
    } finally {
      await harness.unmount();
    }
  });

  test("resets the task once for a double tap that comes before the busy state renders", async () => {
    const resetTaskImplementation = mock(async (_taskId: string) => {});
    const harness = createHookHarness(createArgs({ resetTaskImplementation }));

    try {
      await harness.mount();
      await harness.run((model) => {
        model.openResetImplementation("task-1");
      });
      await harness.run((model) => {
        model.resetImplementationModal?.onConfirm();
        model.resetImplementationModal?.onConfirm();
      });

      await waitFor(() => expect(harness.getLatest().resetImplementationModal).toBeNull());
      expect(resetTaskImplementation).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps the modal when the workspace identity does not change", async () => {
    const args = createArgs();
    const harness = createHookHarness(args);

    try {
      await harness.mount();
      await harness.run((model) => {
        model.openResetImplementation("task-1");
      });
      await harness.update({ ...args, workspaceIdentity: { ...workspaceA } });

      expect(harness.getLatest().resetImplementationModal?.taskId).toBe("task-1");
    } finally {
      await harness.unmount();
    }
  });

  test("binds the modal to its opening workspace", async () => {
    const resetTaskImplementation = mock(async () => {});
    const args = createArgs({ resetTaskImplementation });
    const harness = createHookHarness(args);

    try {
      await harness.mount();
      await harness.run((model) => {
        model.openResetImplementation("task-1");
      });
      await harness.update({ ...args, workspaceIdentity: workspaceB });

      expect(harness.getLatest().resetImplementationModal).toBeNull();

      await harness.update(args);
      const modal = harness.getLatest().resetImplementationModal;
      expect(modal?.taskId).toBe("task-1");

      await harness.run(() => {
        modal?.onConfirm();
      });
      await waitFor(() => {
        expect(resetTaskImplementation).toHaveBeenCalledWith("task-1");
      });
      expect(harness.getLatest().resetImplementationModal).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("reports a missing task through the connection feedback", async () => {
    const feedback = createFeedbackFake();
    const harness = createHookHarness(createArgs(), feedback);

    try {
      await harness.mount();
      let opened = true;
      await harness.run((model) => {
        opened = model.openResetImplementation("missing-task");
      });

      expect(opened).toBe(false);
      expect(feedback.shownOf("error")).toEqual([
        {
          kind: "error",
          message: "Unable to reset implementation",
          options: {
            description: "Task missing-task was not found. Refresh tasks and try again.",
          },
        },
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("marks a reset whose result the connection lost", async () => {
    const resetTaskImplementation = mock(async () => {
      throw new RemoteConnectionError({
        code: "outcome_unknown",
        message: "The result of task_reset_implementation was lost.",
        nextAction: "Read current host state to check the outcome.",
      });
    });
    const harness = createHookHarness(createArgs({ resetTaskImplementation }));

    try {
      await harness.mount();
      await harness.run((model) => {
        model.openResetImplementation("task-1");
      });
      await harness.run((model) => {
        model.resetImplementationModal?.onConfirm();
      });
      await waitFor(() => {
        expect(harness.getLatest().resetImplementationModal?.errorOutcomeUnknown).toBe(true);
      });
      expect(harness.getLatest().resetImplementationModal?.errorMessage).toBe(
        "The result of task_reset_implementation was lost. Read current host state to check the outcome.",
      );
    } finally {
      await harness.unmount();
    }
  });
});
