import { describe, expect, mock, test } from "bun:test";
import { useQueryClient } from "@tanstack/react-query";
import { taskStopImpactQueryOptions } from "@/state/queries/task-stop-impact";
import { IsolatedQueryWrapper } from "@/test-utils/isolated-query-wrapper";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionReadPort } from "../../queries/agent-sessions";
import type { UseTaskOperationsResult } from "./task-operations-types";
import { useTaskResetOperations } from "./use-task-reset-operations";

const createHarness = ({
  agentSessionsList,
  refreshTaskData,
  taskResetImplementationError,
}: {
  agentSessionsList: AgentSessionReadPort["agentSessionsList"];
  refreshTaskData: UseTaskOperationsResult["refreshTaskData"];
  taskResetImplementationError?: Error;
}) => {
  const taskReset = mock(async () => createTaskCardFixture({ id: "A", status: "open" }));
  const taskResetImplementation = mock(async () => {
    if (taskResetImplementationError) {
      throw taskResetImplementationError;
    }
    return createTaskCardFixture({ id: "A", status: "ready_for_dev" });
  });
  const error = mock(() => "error-toast");
  const success = mock(() => "success-toast");
  const harness = createHookHarness(
    () => {
      const queryClient = useQueryClient();
      const operations = useTaskResetOperations({
        activeRepoPath: "/repo",
        agentSessionReadPort: { agentSessionsList },
        refreshTaskData,
        hostPort: { taskReset, taskResetImplementation },
        notificationPort: { error, success },
      });
      return { operations, queryClient };
    },
    undefined,
    { wrapper: IsolatedQueryWrapper },
  );

  return {
    error,
    harness,
    taskReset,
    taskResetImplementation,
  };
};

describe("useTaskResetOperations", () => {
  test("reports a session refresh failure without rejecting a successful reset", async () => {
    const metadataError = new Error("metadata unavailable");
    const setup = createHarness({
      agentSessionsList: async () => {
        throw metadataError;
      },
      refreshTaskData: async () => undefined,
    });

    try {
      await setup.harness.mount();
      await expect(
        setup.harness.run(({ operations }) => operations.resetTaskImplementation("A")),
      ).resolves.toBeUndefined();

      expect(setup.taskResetImplementation).toHaveBeenCalledWith("/repo", "A");
      expect(setup.error).toHaveBeenCalledWith(
        "Implementation reset, but metadata refresh failed",
        { description: "/repo · A: metadata unavailable" },
      );
    } finally {
      await setup.harness.unmount();
    }
  });

  test("reports both refresh failures without rejecting a successful task reset", async () => {
    const setup = createHarness({
      agentSessionsList: async () => {
        throw new Error("metadata unavailable");
      },
      refreshTaskData: async () => {
        throw new Error("task state unavailable");
      },
    });

    try {
      await setup.harness.mount();
      await expect(
        setup.harness.run(({ operations }) => operations.resetTask("A")),
      ).resolves.toBeUndefined();

      expect(setup.taskReset).toHaveBeenCalledWith("/repo", "A");
      expect(setup.error).toHaveBeenCalledWith("Task reset, but metadata refresh failed", {
        description:
          "/repo · A: Post-reset metadata refreshes failed: metadata unavailable; task state unavailable",
      });
    } finally {
      await setup.harness.unmount();
    }
  });

  test("invalidates stop impact after a failed reset attempt", async () => {
    const setup = createHarness({
      agentSessionsList: async () => [],
      refreshTaskData: async () => undefined,
      taskResetImplementationError: new Error("reset failed"),
    });
    const queryKey = taskStopImpactQueryOptions({
      repoPath: "/repo",
      taskIds: ["A"],
      operation: "reset_implementation",
      readPort: { taskStopImpactGet: async () => ({ stoppableSessionCount: 1 }) },
    }).queryKey;

    try {
      await setup.harness.mount();
      await setup.harness.run(({ queryClient }) => {
        queryClient.setQueryData(queryKey, { stoppableSessionCount: 1 });
      });
      await expect(
        setup.harness.run(({ operations }) => operations.resetTaskImplementation("A")),
      ).rejects.toThrow("reset failed");
      let isInvalidated: boolean | undefined;
      await setup.harness.run(({ queryClient }) => {
        isInvalidated = queryClient.getQueryState(queryKey)?.isInvalidated;
      });
      expect(isInvalidated).toBe(true);
    } finally {
      await setup.harness.unmount();
    }
  });
});
