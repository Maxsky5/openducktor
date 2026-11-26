import { describe, expect, jest, mock, test } from "bun:test";
import type { RuntimeLifecycleImpact, RuntimeRestartResult } from "@openducktor/contracts";
import { act, fireEvent, render, within } from "@testing-library/react";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { MINIMUM_LOADER_MS } from "@openducktor/frontend-core/lib/use-minimum-loader";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { setupTestingLibraryFakeTimers } from "@openducktor/frontend-core/test-support/testing-library-fake-timers";
import { HostRuntimeStatusContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { startHostRuntimeEventsHarness } from "@/test-utils/host-runtime-events-harness";
import {
  createHostRuntimeStatusContextValue,
  createHostRuntimeStatusFixture,
} from "@/test-utils/shared-test-fixtures";
import { NO_IMPACT_MESSAGE } from "./runtime-impact-dialog";
import { RUNTIME_IMPACT_CHANGED_NOTICE } from "./runtime-impact-review";
import { RuntimeRestartControl, type RuntimeRestartPorts } from "./runtime-restart-control";

const emptyImpact = (confirmation: string): RuntimeLifecycleImpact => ({
  kinds: [
    {
      kind: "opencode",
      runtimeId: "runtime-1",
      effect: "restart",
      oldExecutablePath: null,
      newExecutablePath: null,
    },
  ],
  workspaces: [],
  confirmation,
});

const impactWithSession = (confirmation: string): RuntimeLifecycleImpact => ({
  ...emptyImpact(confirmation),
  workspaces: [
    {
      workspaceId: "workspace-a",
      workspaceName: "Repo A",
      repoPath: "/repo-a",
      sessions: [
        {
          ref: {
            repoPath: "/repo-a",
            runtimeKind: "opencode",
            workingDirectory: "/worktrees/task-1",
            externalSessionId: "session-1",
          },
          title: "Build login",
          activity: "waiting_for_question",
          pendingInputCount: 1,
        },
        {
          ref: {
            repoPath: "/repo-a",
            runtimeKind: "opencode",
            workingDirectory: "/worktrees/task-1",
            externalSessionId: "session-2",
          },
          title: "Explore tests",
          activity: "running",
          pendingInputCount: 0,
          parentExternalSessionId: "session-1",
        },
      ],
    },
  ],
});

/**
 * Renders the control under a host runtime status owner on a fake transport. The host connection
 * has no commands, so only the supplied ports can restart the runtime.
 */
const renderControl = (
  ports: RuntimeRestartPorts,
  events = startHostRuntimeEventsHarness(),
  isLifecycleBusy = false,
) => {
  const connection = createTestClientConnection();
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <HostRuntimeStatusContext.Provider
        value={createHostRuntimeStatusContextValue({ runtimeEvents: events.owner })}
      >
        <RuntimeRestartControl
          runtimeKind="opencode"
          runtimeLabel="OpenCode"
          actionLabel="Restart"
          isLifecycleBusy={isLifecycleBusy}
          ports={ports}
        />
      </HostRuntimeStatusContext.Provider>
    </ClientConnectionProvider>,
  );
  return {
    ...view,
    unmount: () => {
      view.unmount();
      events.owner.stop();
      void connection.dispose();
    },
  };
};

const openReview = async (view: ReturnType<typeof render>): Promise<void> => {
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Restart OpenCode runtime" }));
  });
  act(() => jest.advanceTimersByTime(MINIMUM_LOADER_MS));
};

const getConfirmButton = (view: ReturnType<typeof render>): HTMLElement =>
  within(view.getByRole("dialog")).getByRole("button", { name: "Restart" });

const confirmRestart = async (view: ReturnType<typeof render>): Promise<void> => {
  await act(async () => {
    fireEvent.click(getConfirmButton(view));
  });
};

describe("RuntimeRestartControl", () => {
  setupTestingLibraryFakeTimers();

  test("states that no live sessions are affected and restarts after confirmation", async () => {
    const restart = mock(async (): Promise<RuntimeRestartResult> => ({
      type: "completed",
      status: createHostRuntimeStatusFixture({ kind: "opencode" }),
    }));
    const view = renderControl({
      runtimeRestartImpact: async () => emptyImpact("confirm-1"),
      runtimeRestart: restart,
    });

    await openReview(view);
    expect(view.getByText(NO_IMPACT_MESSAGE)).toBeDefined();
    expect(restart).not.toHaveBeenCalled();
    await confirmRestart(view);

    expect(restart).toHaveBeenCalledWith("opencode", "confirm-1");
    view.unmount();
  });

  test("requires a new confirmation when the impact changed", async () => {
    const restart = mock(
      async (_kind: string, confirmation: string): Promise<RuntimeRestartResult> =>
        confirmation === "confirm-1"
          ? { type: "impact_changed", impact: impactWithSession("confirm-2") }
          : { type: "completed", status: createHostRuntimeStatusFixture({ kind: "opencode" }) },
    );
    const view = renderControl({
      runtimeRestartImpact: async () => emptyImpact("confirm-1"),
      runtimeRestart: restart,
    });

    await openReview(view);
    expect(view.getByText(NO_IMPACT_MESSAGE)).toBeDefined();
    await confirmRestart(view);

    expect(view.getByText(RUNTIME_IMPACT_CHANGED_NOTICE)).toBeDefined();
    expect(view.getByText("Build login")).toBeDefined();
    expect(view.getByText("Waiting for input")).toBeDefined();
    expect(view.getByText("Repo A")).toBeDefined();
    expect(restart).toHaveBeenCalledTimes(1);

    await confirmRestart(view);
    expect(restart).toHaveBeenLastCalledWith("opencode", "confirm-2");
    view.unmount();
  });

  test("keeps the open review current from live session events", async () => {
    let current = emptyImpact("confirm-1");
    const readImpact = mock(async () => current);
    const restart = mock(async (): Promise<RuntimeRestartResult> => ({
      type: "completed",
      status: createHostRuntimeStatusFixture({ kind: "opencode" }),
    }));
    const events = startHostRuntimeEventsHarness();
    const view = renderControl(
      { runtimeRestartImpact: readImpact, runtimeRestart: restart },
      events,
    );

    await openReview(view);
    expect(view.getByText(NO_IMPACT_MESSAGE)).toBeDefined();

    // A change of another kind needs no new read.
    act(() => events.emit({ type: "runtime_impact_changed", runtimeKinds: ["codex"] }));
    expect(readImpact).toHaveBeenCalledTimes(1);

    current = impactWithSession("confirm-2");
    await act(async () => {
      await events.emit({ type: "runtime_impact_changed", runtimeKinds: ["opencode"] });
    });
    expect(view.getByText("Build login")).toBeDefined();
    expect(view.queryByText(NO_IMPACT_MESSAGE)).toBeNull();

    // Without live updates the list is not current, so confirmation waits for a new read.
    act(() =>
      events.emit({
        __openducktorConnectionControl: true,
        kind: "stream-warning",
        message: "Lost.",
      }),
    );
    expect(view.getByText(/Lost\./)).toBeDefined();
    expect(getConfirmButton(view).hasAttribute("disabled")).toBe(true);
    await act(async () => {
      await events.emit({
        __openducktorConnectionControl: true,
        kind: "reconnected",
        missedEvents: true,
        hostChanged: false,
        missedEventNames: [],
      });
    });
    expect(getConfirmButton(view).hasAttribute("disabled")).toBe(false);

    await confirmRestart(view);
    expect(restart).toHaveBeenCalledWith("opencode", "confirm-2");
    view.unmount();
  });

  test("keeps the reviewed sessions in place while the restart runs", async () => {
    const readImpact = mock(async () => impactWithSession("confirm-1"));
    const restartResult = Promise.withResolvers<RuntimeRestartResult>();
    const events = startHostRuntimeEventsHarness();
    const view = renderControl(
      { runtimeRestartImpact: readImpact, runtimeRestart: () => restartResult.promise },
      events,
    );
    await openReview(view);
    expect(view.getByText("Build login")).toBeDefined();
    await confirmRestart(view);

    // The restart changes the runtime and releases its sessions. The review reads nothing then.
    act(() => {
      events.emit({
        type: "runtime_changed",
        hostInstanceId: "host-1",
        status: createHostRuntimeStatusFixture({ kind: "opencode", state: "restarting" }),
      });
      events.emit({ type: "runtime_impact_changed", runtimeKinds: ["opencode"] });
    });
    expect(readImpact).toHaveBeenCalledTimes(1);
    expect(view.getByText("Build login")).toBeDefined();

    // A failed restart resumes the review, which reads the changed sessions once.
    await act(async () => {
      restartResult.reject(new Error("The runtime did not stop."));
    });
    expect(view.getByText("The runtime did not stop.")).toBeDefined();
    expect(readImpact).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  test("shows a failed impact read and prevents confirmation", async () => {
    const restart = mock(async (): Promise<RuntimeRestartResult> => ({
      type: "completed",
      status: createHostRuntimeStatusFixture({ kind: "opencode" }),
    }));
    const view = renderControl({
      runtimeRestartImpact: async () => {
        throw new Error("Live sessions could not be read.");
      },
      runtimeRestart: restart,
    });

    await openReview(view);
    expect(view.getByText(/Live sessions could not be read\./)).toBeDefined();
    const confirm = getConfirmButton(view);
    expect(confirm.hasAttribute("disabled")).toBe(true);
    fireEvent.click(confirm);
    expect(restart).not.toHaveBeenCalled();
    view.unmount();
  });

  test("disables the action while the kind has a lifecycle action in progress", () => {
    const view = renderControl(
      {
        runtimeRestartImpact: async () => emptyImpact("confirm-1"),
        runtimeRestart: async () => ({
          type: "completed",
          status: createHostRuntimeStatusFixture({ kind: "opencode" }),
        }),
      },
      startHostRuntimeEventsHarness(),
      true,
    );

    expect(
      view.getByRole("button", { name: "Restart OpenCode runtime" }).hasAttribute("disabled"),
    ).toBe(true);
    view.unmount();
  });
});
