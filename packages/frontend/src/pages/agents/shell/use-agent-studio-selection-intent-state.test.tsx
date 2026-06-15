import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "../agent-studio-test-utils";
import {
  type AgentStudioSelectionIntentState,
  useAgentStudioSelectionIntentState,
} from "./use-agent-studio-selection-intent-state";

enableReactActEnvironment();

type HookProps = Parameters<typeof useAgentStudioSelectionIntentState>[0];

const createHookHarness = (initialProps: HookProps) =>
  createSharedHookHarness(useAgentStudioSelectionIntentState, initialProps);

const baseProps: HookProps = {
  isRepoNavigationBoundaryPending: false,
  taskIdParam: "task-1",
  sessionKeyParam: null,
  roleFromQuery: "build",
};

describe("useAgentStudioSelectionIntentState", () => {
  test("keeps an optimistic session intent pending until the URL matches it", async () => {
    const sessionIdentity = {
      externalSessionId: "session-1",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo",
    };
    const harness = createHookHarness(baseProps);

    await harness.mount();
    await harness.run((state: AgentStudioSelectionIntentState) => {
      state.scheduleSelectionIntent({
        taskId: "task-1",
        sessionIdentity,
        role: "build",
      });
    });

    expect(harness.getLatest().selectionIntentForController?.sessionIdentity).toEqual(
      sessionIdentity,
    );

    await harness.update({
      ...baseProps,
      sessionKeyParam: agentSessionIdentityKey(sessionIdentity),
    });

    expect(harness.getLatest().selectionIntentForController?.sessionIdentity).toEqual(
      sessionIdentity,
    );

    await harness.unmount();
  });

  test("preserves resolved sessionless role intent while the URL still matches", async () => {
    const harness = createHookHarness(baseProps);

    await harness.mount();
    await harness.run((state: AgentStudioSelectionIntentState) => {
      state.scheduleSelectionIntent({
        taskId: "task-1",
        sessionIdentity: null,
        role: "build",
      });
    });

    expect(harness.getLatest().selectionIntentForController).toEqual({
      taskId: "task-1",
      sessionIdentity: null,
      role: "build",
    });

    await harness.update({
      ...baseProps,
      roleFromQuery: "qa",
    });

    expect(harness.getLatest().selectionIntentForController).toBeNull();

    await harness.unmount();
  });

  test("clears selection intent during repo navigation boundary resets", async () => {
    const harness = createHookHarness({
      ...baseProps,
      taskIdParam: "old-task",
      roleFromQuery: "planner",
    });

    await harness.mount();
    await harness.run((state: AgentStudioSelectionIntentState) => {
      state.scheduleSelectionIntent({
        taskId: "new-task",
        sessionIdentity: null,
        role: "build",
      });
    });

    expect(harness.getLatest().selectionIntentForController).not.toBeNull();

    await harness.update({
      ...baseProps,
      isRepoNavigationBoundaryPending: true,
    });

    expect(harness.getLatest().selectionIntentForController).toBeNull();

    await harness.unmount();
  });
});
