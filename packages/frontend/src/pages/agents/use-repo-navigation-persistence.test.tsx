import { describe, expect, mock, test } from "bun:test";
import type { WorkspaceAgentStudioState } from "@openducktor/contracts";
import { useState } from "react";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import type { AgentStudioNavigationState } from "./query-sync/agent-studio-navigation";
import {
  resolveRepoNavigationBoundaryPhase,
  useRepoNavigationPersistence,
} from "./use-repo-navigation-persistence";

enableReactActEnvironment();

type HookArgs = {
  activeWorkspaceId: string | null;
  agentStudioState: WorkspaceAgentStudioState | null;
  initialNavigation?: AgentStudioNavigationState;
  isLoadingAgentStudioState?: boolean;
  agentStudioStateError?: Error | null;
  retryPersistenceRestore?: () => void;
};

const useHookHarness = ({
  activeWorkspaceId,
  agentStudioState,
  initialNavigation,
  isLoadingAgentStudioState = false,
  agentStudioStateError = null,
  retryPersistenceRestore = () => {},
}: HookArgs) => {
  const [navigation, setNavigation] = useState<AgentStudioNavigationState>(
    initialNavigation ?? { taskId: "", sessionExternalId: null, role: null },
  );
  const result = useRepoNavigationPersistence({
    activeWorkspaceId,
    agentStudioState,
    isLoadingAgentStudioState,
    agentStudioStateError,
    navigation,
    retryPersistenceRestore,
    setNavigation,
  });
  return { ...result, navigation, setNavigation };
};

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useHookHarness, initialProps);

describe("useRepoNavigationPersistence", () => {
  test("reports repo boundary phases", () => {
    expect(
      resolveRepoNavigationBoundaryPhase({
        activeWorkspaceId: "repo-b",
        lastWorkspaceId: "repo-a",
        boundaryWorkspaceId: null,
      }),
    ).toBe("detecting");
    expect(
      resolveRepoNavigationBoundaryPhase({
        activeWorkspaceId: "repo-a",
        lastWorkspaceId: "repo-a",
        boundaryWorkspaceId: null,
      }),
    ).toBe("idle");
  });

  test("restores the host-owned workspace snapshot", async () => {
    const harness = createHookHarness({
      activeWorkspaceId: "repo-a",
      agentStudioState: {
        openTaskIds: ["task-a"],
        activeTask: {
          taskId: "task-a",
          role: "planner",
          externalSessionId: "session-a",
        },
      },
    });

    await harness.mount();
    await harness.waitFor((state) => state.isWorkspaceStateLoaded);

    expect(harness.getLatest().navigation).toEqual({
      taskId: "task-a",
      sessionExternalId: "session-a",
      role: "planner",
    });
    expect(harness.getLatest().isRepoNavigationBoundaryPending).toBeFalse();
    await harness.unmount();
  });

  test("keeps an explicit URL selection", async () => {
    const harness = createHookHarness({
      activeWorkspaceId: "repo-a",
      agentStudioState: {
        openTaskIds: ["task-saved"],
        activeTask: { taskId: "task-saved", role: "planner" },
      },
      initialNavigation: {
        taskId: "task-url",
        sessionExternalId: "session-url",
        role: "qa",
      },
    });

    await harness.mount();
    await harness.waitFor((state) => state.isWorkspaceStateLoaded);
    expect(harness.getLatest().navigation).toEqual({
      taskId: "task-url",
      sessionExternalId: "session-url",
      role: "qa",
    });
    await harness.unmount();
  });

  test("clears the prior workspace before restoring the next snapshot", async () => {
    const harness = createHookHarness({
      activeWorkspaceId: "repo-a",
      agentStudioState: {
        openTaskIds: ["task-a"],
        activeTask: { taskId: "task-a", role: "spec" },
      },
    });

    await harness.mount();
    await harness.waitFor((state) => state.navigation.taskId === "task-a");
    await harness.update({
      activeWorkspaceId: "repo-b",
      agentStudioState: {
        openTaskIds: ["task-b"],
        activeTask: { taskId: "task-b", role: "build" },
      },
    });
    await harness.waitFor((state) => state.navigation.taskId === "task-b");

    expect(harness.getLatest().navigation).toEqual({
      taskId: "task-b",
      sessionExternalId: null,
      role: "build",
    });
    await harness.unmount();
  });

  test("surfaces load errors and exposes manual retry", async () => {
    const retry = mock(() => {});
    const error = new Error("Workspace state could not be loaded.");
    const harness = createHookHarness({
      activeWorkspaceId: "repo-a",
      agentStudioState: null,
      agentStudioStateError: error,
      retryPersistenceRestore: retry,
    });

    await harness.mount();
    expect(harness.getLatest().persistenceError).toBe(error);
    harness.getLatest().retryPersistenceRestore();
    expect(retry).toHaveBeenCalledTimes(1);
    await harness.unmount();
  });
});
