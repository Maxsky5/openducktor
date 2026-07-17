import { describe, expect, mock, test } from "bun:test";
import { IsolatedQueryWrapper } from "@/test-utils/isolated-query-wrapper";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionReadPort } from "../../queries/agent-sessions";
import type { UseTaskOperationsResult } from "./task-operations-types";
import { useTaskResetOperations } from "./use-task-reset-operations";

const createHarness = ({
  agentSessionsList,
  refreshTaskData,
}: {
  agentSessionsList: AgentSessionReadPort["agentSessionsList"];
  refreshTaskData: UseTaskOperationsResult["refreshTaskData"];
}) => {
  const taskReset = mock(async () => createTaskCardFixture({ id: "A", status: "open" }));
  const taskResetImplementation = mock(async () =>
    createTaskCardFixture({ id: "A", status: "ready_for_dev" }),
  );
  const error = mock(() => "error-toast");
  const success = mock(() => "success-toast");
  const harness = createHookHarness(
    () =>
      useTaskResetOperations({
        activeRepoPath: "/repo",
        agentSessionReadPort: { agentSessionsList },
        refreshTaskData,
        hostPort: { taskReset, taskResetImplementation },
        notificationPort: { error, success },
      }),
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
        setup.harness.run((operations) => operations.resetTaskImplementation("A")),
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
        setup.harness.run((operations) => operations.resetTask("A")),
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
});
