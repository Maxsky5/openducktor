import { describe, expect, mock, test } from "bun:test";
import type { WorkspaceAgentStudioState } from "@openducktor/contracts";
import type { SetURLSearchParams } from "react-router";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "../agent-studio-test-utils";
import { getWorkspaceRestorePhase, useAgentStudioQuerySync } from "./use-agent-studio-query-sync";

enableReactActEnvironment();

const emptySearchParams = new URLSearchParams();
const setSearchParams: SetURLSearchParams = () => {};

type HookArgs = {
  activeWorkspaceId: string | null;
  agentStudioState: WorkspaceAgentStudioState | null;
  searchParams?: URLSearchParams;
  isLoadingAgentStudioState?: boolean;
  agentStudioStateError?: Error | null;
  retry?: () => void;
};

const useHookHarness = ({
  activeWorkspaceId,
  agentStudioState,
  searchParams = emptySearchParams,
  isLoadingAgentStudioState = false,
  agentStudioStateError = null,
  retry = () => {},
}: HookArgs) =>
  useAgentStudioQuerySync({
    activeWorkspaceId,
    agentStudioState,
    isLoadingAgentStudioState,
    agentStudioStateError,
    retryAgentStudioStateLoad: retry,
    locationKey: "location-1",
    navigationType: "REPLACE",
    searchParams,
    setSearchParams,
  });

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useHookHarness, initialProps);

describe("useAgentStudioQuerySync", () => {
  test("reports workspace boundary phases", () => {
    expect(
      getWorkspaceRestorePhase({
        activeWorkspaceId: "repo-b",
        lastWorkspaceId: "repo-a",
        boundaryWorkspaceId: null,
      }),
    ).toBe("detecting");
    expect(
      getWorkspaceRestorePhase({
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

    expect(harness.getLatest().taskIdParam).toBe("task-a");
    expect(harness.getLatest().sessionExternalIdParam).toBe("session-a");
    expect(harness.getLatest().roleFromQuery).toBe("planner");
    expect(harness.getLatest().isWorkspaceRestorePending).toBeFalse();
    await harness.unmount();
  });

  test("keeps an explicit URL selection", async () => {
    const harness = createHookHarness({
      activeWorkspaceId: "repo-a",
      agentStudioState: {
        openTaskIds: ["task-saved"],
        activeTask: { taskId: "task-saved", role: "planner" },
      },
      searchParams: new URLSearchParams("task=task-url&session=session-url&agent=qa"),
    });

    await harness.mount();
    await harness.waitFor((state) => state.isWorkspaceStateLoaded);
    expect(harness.getLatest().taskIdParam).toBe("task-url");
    expect(harness.getLatest().sessionExternalIdParam).toBe("session-url");
    expect(harness.getLatest().roleFromQuery).toBe("qa");
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
    await harness.waitFor((state) => state.taskIdParam === "task-a");
    await harness.update({
      activeWorkspaceId: "repo-b",
      agentStudioState: {
        openTaskIds: ["task-b"],
        activeTask: { taskId: "task-b", role: "build" },
      },
    });
    await harness.waitFor((state) => state.taskIdParam === "task-b");

    expect(harness.getLatest().sessionExternalIdParam).toBeNull();
    expect(harness.getLatest().roleFromQuery).toBe("build");
    await harness.unmount();
  });

  test("surfaces load errors and exposes manual retry", async () => {
    const retry = mock(() => {});
    const error = new Error("Workspace state could not be loaded.");
    const harness = createHookHarness({
      activeWorkspaceId: "repo-a",
      agentStudioState: null,
      agentStudioStateError: error,
      retry,
    });

    await harness.mount();
    expect(harness.getLatest().navigationPersistenceError).toBe(error);
    harness.getLatest().retryNavigationPersistence();
    expect(retry).toHaveBeenCalledTimes(1);
    await harness.unmount();
  });
});
