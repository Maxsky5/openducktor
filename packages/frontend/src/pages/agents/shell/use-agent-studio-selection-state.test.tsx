import { describe, expect, mock, test } from "bun:test";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "../agent-studio-test-utils";
import {
  toAgentStudioSessionlessRoleSelection,
  toAgentStudioSessionSelection,
  toAgentStudioTaskSelection,
} from "./agent-studio-selection-state";
import { useAgentStudioSelectionState } from "./use-agent-studio-selection-state";

enableReactActEnvironment();

type HookProps = Parameters<typeof useAgentStudioSelectionState>[0];

const session = {
  externalSessionId: "session-1",
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo/worktrees/session-1",
  taskId: "task-1",
  role: "build" as const,
};

const baseProps = (overrides: Partial<HookProps> = {}): HookProps => ({
  isRepoNavigationBoundaryPending: false,
  taskIdParam: "task-1",
  sessionExternalIdParam: null,
  hasExplicitRoleParam: false,
  roleFromQuery: "spec",
  scheduleQueryUpdate: () => {},
  ...overrides,
});

const createHookHarness = (initialProps: HookProps) =>
  createSharedHookHarness(useAgentStudioSelectionState, initialProps);

describe("useAgentStudioSelectionState", () => {
  test("publishes selected session state immediately and mirrors it to the query", async () => {
    const scheduleQueryUpdate = mock(() => {});
    const harness = createHookHarness(baseProps({ scheduleQueryUpdate }));

    await harness.mount();
    await harness.run((state) => {
      state.selectAgentStudioSelection(toAgentStudioSessionSelection(session));
    });

    expect(harness.getLatest().selection).toEqual(toAgentStudioSessionSelection(session));
    expect(scheduleQueryUpdate).toHaveBeenCalledWith({
      task: "task-1",
      session: "session-1",
      agent: "build",
    });

    await harness.unmount();
  });

  test("keeps local task selection while stale route params are catching up", async () => {
    const harness = createHookHarness(baseProps());

    await harness.mount();
    await harness.run((state) => {
      state.selectAgentStudioSelection(toAgentStudioTaskSelection("task-2"));
    });

    expect(harness.getLatest().selection).toEqual(toAgentStudioTaskSelection("task-2"));

    await harness.update(baseProps());

    expect(harness.getLatest().selection).toEqual(toAgentStudioTaskSelection("task-2"));

    await harness.update(baseProps({ taskIdParam: "task-2" }));

    expect(harness.getLatest().selection).toEqual(toAgentStudioTaskSelection("task-2"));

    await harness.unmount();
  });

  test("lets external route navigation replace a local selection", async () => {
    const harness = createHookHarness(baseProps());

    await harness.mount();
    await harness.run((state) => {
      state.selectAgentStudioSelection(toAgentStudioTaskSelection("task-2"));
    });

    await harness.update(
      baseProps({
        taskIdParam: "task-3",
        hasExplicitRoleParam: true,
        roleFromQuery: "qa",
      }),
    );

    expect(harness.getLatest().selection).toEqual({
      taskId: "task-3",
      sessionExternalId: null,
      sessionIdentity: null,
      role: "qa",
      hasExplicitRoleSelection: true,
      keepSessionless: false,
    });

    await harness.unmount();
  });

  test("keeps prepared message-first role sessionless until the route changes elsewhere", async () => {
    const harness = createHookHarness(baseProps());

    await harness.mount();
    await harness.run((state) => {
      state.selectAgentStudioSelection(
        toAgentStudioSessionlessRoleSelection({
          taskId: "task-1",
          role: "build",
        }),
      );
    });

    expect(harness.getLatest().selection).toEqual(
      toAgentStudioSessionlessRoleSelection({
        taskId: "task-1",
        role: "build",
      }),
    );

    await harness.update(baseProps({ hasExplicitRoleParam: true, roleFromQuery: "build" }));

    expect(harness.getLatest().selection).toEqual(
      toAgentStudioSessionlessRoleSelection({
        taskId: "task-1",
        role: "build",
      }),
    );

    await harness.unmount();
  });
});
