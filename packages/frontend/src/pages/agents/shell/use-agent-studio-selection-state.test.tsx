import { describe, expect, mock, test } from "bun:test";
import { render } from "@testing-library/react";
import { createElement, type ReactElement, useLayoutEffect } from "react";
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
  activeWorkspaceId: "workspace-1",
  isWorkspaceRestorePending: false,
  taskIdParam: "task-1",
  sessionExternalIdParam: null,
  hasExplicitRoleParam: false,
  roleFromQuery: "spec",
  scheduleQueryUpdate: () => {},
  requestContextTransition: (applyTransition) => applyTransition(),
  ...overrides,
});

const createHookHarness = (initialProps: HookProps) =>
  createSharedHookHarness(useAgentStudioSelectionState, initialProps);

type SelectionProbeProps = HookProps & {
  observedWorkingDirectories: Array<string | null>;
};

function SelectionProbe({
  observedWorkingDirectories,
  ...selectionProps
}: SelectionProbeProps): ReactElement | null {
  const { selection } = useAgentStudioSelectionState(selectionProps);
  // Observe every commit, including the one that switches workspace. Record only
  // changes, because one workspace change can commit more than once.
  useLayoutEffect(() => {
    const workingDirectory = selection.sessionIdentity?.workingDirectory ?? null;
    if (observedWorkingDirectories.at(-1) !== workingDirectory) {
      observedWorkingDirectories.push(workingDirectory);
    }
  });
  return null;
}

describe("useAgentStudioSelectionState", () => {
  test("does not publish a local task change before the preview guard applies it", async () => {
    const scheduleQueryUpdate = mock(() => {});
    let applyTransition: (() => void) | null = null;
    const requestContextTransition = mock((apply: () => void) => {
      applyTransition = apply;
    });
    const harness = createHookHarness(baseProps({ scheduleQueryUpdate, requestContextTransition }));

    await harness.mount();
    await harness.run((state) => {
      state.selectAgentStudioSelection(toAgentStudioTaskSelection("task-2"));
    });

    expect(harness.getLatest().selection).toEqual(toAgentStudioTaskSelection("task-1"));
    expect(scheduleQueryUpdate).not.toHaveBeenCalled();
    await harness.run(() => applyTransition?.());
    expect(harness.getLatest().selection).toEqual(toAgentStudioTaskSelection("task-2"));
    expect(scheduleQueryUpdate).toHaveBeenCalledWith({
      task: "task-2",
      session: undefined,
      agent: undefined,
    });

    await harness.unmount();
  });

  test("keeps the current selection during external route navigation until confirmation", async () => {
    const scheduleQueryUpdate = mock(() => {});
    let applyTransition: (() => void) | null = null;
    const requestContextTransition = mock((apply: () => void) => {
      applyTransition = apply;
    });
    const harness = createHookHarness(baseProps({ scheduleQueryUpdate, requestContextTransition }));

    await harness.mount();
    await harness.update(
      baseProps({
        taskIdParam: "task-3",
        hasExplicitRoleParam: true,
        roleFromQuery: "qa",
        scheduleQueryUpdate,
        requestContextTransition,
      }),
    );

    expect(harness.getLatest().selection).toEqual(toAgentStudioTaskSelection("task-1"));
    await harness.run(() => applyTransition?.());
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

  test("restores the current route when external navigation is cancelled", async () => {
    const scheduleQueryUpdate = mock(() => {});
    let cancelTransition: (() => void) | null = null;
    const requestContextTransition = mock((_apply: () => void, cancel?: () => void) => {
      cancelTransition = cancel ?? null;
    });
    const harness = createHookHarness(baseProps({ scheduleQueryUpdate, requestContextTransition }));

    await harness.mount();
    await harness.update(
      baseProps({
        taskIdParam: "task-3",
        hasExplicitRoleParam: true,
        roleFromQuery: "qa",
        scheduleQueryUpdate,
        requestContextTransition,
      }),
    );

    expect(harness.getLatest().selection).toEqual(toAgentStudioTaskSelection("task-1"));
    await harness.run(() => cancelTransition?.());
    expect(scheduleQueryUpdate).toHaveBeenCalledWith({
      task: "task-1",
      session: undefined,
      agent: undefined,
    });
    expect(harness.getLatest().selection).toEqual(toAgentStudioTaskSelection("task-1"));

    await harness.unmount();
  });

  test("applies the latest external route after a newer navigation arrives", async () => {
    let firstApplyTransition: (() => void) | null = null;
    const requestContextTransition = mock((apply: () => void) => {
      firstApplyTransition ??= apply;
    });
    const harness = createHookHarness(baseProps({ requestContextTransition }));

    await harness.mount();
    await harness.update(baseProps({ taskIdParam: "task-2", requestContextTransition }));
    await harness.update(baseProps({ taskIdParam: "task-3", requestContextTransition }));
    await harness.run(() => firstApplyTransition?.());

    expect(harness.getLatest().selection).toEqual(toAgentStudioTaskSelection("task-3"));
    await harness.unmount();
  });

  test("does not restore a route superseded by a newer external navigation", async () => {
    const scheduleQueryUpdate = mock(() => {});
    const cancelTransitions: Array<() => void> = [];
    const requestContextTransition = mock((_apply: () => void, cancel?: () => void) => {
      if (cancel) cancelTransitions.push(cancel);
    });
    const harness = createHookHarness(baseProps({ scheduleQueryUpdate, requestContextTransition }));

    await harness.mount();
    await harness.update(
      baseProps({
        taskIdParam: "task-2",
        scheduleQueryUpdate,
        requestContextTransition,
      }),
    );
    await harness.update(
      baseProps({
        taskIdParam: "task-3",
        scheduleQueryUpdate,
        requestContextTransition,
      }),
    );
    await harness.run(() => cancelTransitions[0]?.());

    expect(scheduleQueryUpdate).not.toHaveBeenCalled();
    await harness.run(() => cancelTransitions[1]?.());
    expect(scheduleQueryUpdate).toHaveBeenCalledWith({
      task: "task-1",
      session: undefined,
      agent: undefined,
    });
    await harness.unmount();
  });

  test("forces the change while workspace restore is pending", async () => {
    const options: Array<{ force: boolean } | undefined> = [];
    const requestContextTransition = mock(
      (_apply: () => void, _cancel?: () => void, transitionOptions?: { force: boolean }) => {
        options.push(transitionOptions);
      },
    );
    const harness = createHookHarness(baseProps({ requestContextTransition }));

    await harness.mount();
    await harness.update(baseProps({ isWorkspaceRestorePending: true, requestContextTransition }));

    expect(options.at(-1)).toEqual({ force: true });
    await harness.unmount();
  });

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

  test("drops the previous workspace selection when the workspace changes", async () => {
    const scheduleQueryUpdate = mock(() => {});
    const harness = createHookHarness(baseProps({ scheduleQueryUpdate }));

    await harness.mount();
    await harness.run((state) => {
      state.selectAgentStudioSelection(toAgentStudioSessionSelection(session));
    });

    expect(harness.getLatest().selection).toEqual(toAgentStudioSessionSelection(session));

    await harness.update(baseProps({ activeWorkspaceId: "workspace-2", scheduleQueryUpdate }));

    expect(harness.getLatest().selection).toEqual({
      taskId: "task-1",
      sessionExternalId: null,
      sessionIdentity: null,
      role: "spec",
      hasExplicitRoleSelection: false,
      keepSessionless: false,
    });
    expect(scheduleQueryUpdate).toHaveBeenCalledTimes(1);

    await harness.unmount();
  });

  test("forces the context transition when the workspace changes", async () => {
    const options: Array<{ force: boolean } | undefined> = [];
    const requestContextTransition = mock(
      (_apply: () => void, _cancel?: () => void, transitionOptions?: { force: boolean }) => {
        options.push(transitionOptions);
      },
    );
    const harness = createHookHarness(baseProps({ requestContextTransition }));

    await harness.mount();
    await harness.update(baseProps({ activeWorkspaceId: "workspace-2", requestContextTransition }));

    expect(options).toEqual([{ force: true }]);

    await harness.unmount();
  });

  test("drops a deferred selection when the workspace changes before it applies", async () => {
    const scheduleQueryUpdate = mock(() => {});
    const pendingApplies: Array<() => void> = [];
    const requestContextTransition = mock((apply: () => void) => {
      pendingApplies.push(apply);
    });
    const harness = createHookHarness(baseProps({ requestContextTransition, scheduleQueryUpdate }));

    await harness.mount();
    await harness.run((state) => {
      state.selectAgentStudioSelection(toAgentStudioSessionSelection(session));
    });
    expect(pendingApplies).toHaveLength(1);

    await harness.update(
      baseProps({
        activeWorkspaceId: "workspace-2",
        requestContextTransition,
        scheduleQueryUpdate,
      }),
    );
    await harness.run(() => {
      pendingApplies[0]?.();
    });

    expect(scheduleQueryUpdate).not.toHaveBeenCalled();
    expect(harness.getLatest().selection.sessionIdentity).toBeNull();

    await harness.unmount();
  });

  test("switches workspaces without exposing the previous workspace session directory to effects", () => {
    const observedWorkingDirectories: Array<string | null> = [];
    const nextSession = {
      ...session,
      externalSessionId: "session-2",
      workingDirectory: "/repo/worktrees/session-2",
    };
    const firstWorkspaceProps = baseProps({
      sessionExternalIdParam: session.externalSessionId,
      routeSessionIdentity: session,
    });
    const secondWorkspaceProps = baseProps({
      activeWorkspaceId: "workspace-2",
      isWorkspaceRestorePending: true,
      sessionExternalIdParam: session.externalSessionId,
    });
    const restoredWorkspaceProps = baseProps({
      activeWorkspaceId: "workspace-2",
      sessionExternalIdParam: nextSession.externalSessionId,
      routeSessionIdentity: nextSession,
    });

    const view = render(
      createElement(SelectionProbe, { ...firstWorkspaceProps, observedWorkingDirectories }),
    );
    view.rerender(
      createElement(SelectionProbe, { ...secondWorkspaceProps, observedWorkingDirectories }),
    );
    view.rerender(
      createElement(SelectionProbe, { ...restoredWorkspaceProps, observedWorkingDirectories }),
    );

    expect(observedWorkingDirectories).toEqual([
      session.workingDirectory,
      null,
      nextSession.workingDirectory,
    ]);
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

test("selects two notification targets with the same native ID and keeps identity after URL cleanup", async () => {
  const first = { ...session };
  const second = { ...session, runtimeKind: "codex" as const, workingDirectory: "/repo/other" };
  const harness = createHookHarness(
    baseProps({ sessionExternalIdParam: first.externalSessionId, routeSessionIdentity: first }),
  );
  await harness.mount();
  expect(harness.getLatest().selection.sessionIdentity).toEqual(first);
  await harness.update(
    baseProps({ sessionExternalIdParam: second.externalSessionId, routeSessionIdentity: second }),
  );
  expect(harness.getLatest().selection.sessionIdentity).toEqual(second);
  await harness.update(baseProps({ sessionExternalIdParam: second.externalSessionId }));
  expect(harness.getLatest().selection.sessionIdentity).toEqual(second);
  await harness.unmount();
});
