import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as cleanupImpactModule from "@/components/features/task-details/use-task-cleanup-impact";
import {
  createTaskCardFixture,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import * as stopImpactModule from "@/state/queries/use-task-stop-impact";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { useTaskResetFlow } from "./use-task-reset-flow";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useTaskResetFlow>[0];

const task = createTaskCardFixture({ id: "task-1", title: "Task 1" });

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

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useTaskResetFlow, initialProps);

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
        isLoading: false,
        error: null,
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

  test("closes the modal when the workspace changes", async () => {
    const args = createArgs();
    const harness = createHookHarness(args);

    try {
      await harness.mount();
      await harness.run((model) => {
        model.openResetImplementation("task-1");
      });
      await harness.update({ ...args, workspaceIdentity: workspaceB });

      expect(harness.getLatest().resetImplementationModal).toBeNull();

      await harness.update(args);
      expect(harness.getLatest().resetImplementationModal).toBeNull();
    } finally {
      await harness.unmount();
    }
  });
});
