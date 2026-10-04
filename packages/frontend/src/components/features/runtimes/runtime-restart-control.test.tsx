import { describe, expect, mock, test } from "bun:test";
import type { RuntimeLifecycleImpact, RuntimeRestartResult } from "@openducktor/contracts";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { HostRuntimeStatusContext } from "@/state/app-state-contexts";
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

/** Renders the control under a host runtime status owner on a fake transport. */
const renderControl = (
  ports: RuntimeRestartPorts,
  events = startHostRuntimeEventsHarness(),
  isLifecycleBusy = false,
) => {
  const view = render(
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
    </HostRuntimeStatusContext.Provider>,
  );
  return {
    ...view,
    unmount: () => {
      view.unmount();
      events.owner.stop();
    },
  };
};

const getConfirmButton = async (view: ReturnType<typeof render>): Promise<HTMLElement> => {
  const buttons = await view.findAllByRole("button", { name: "Restart" });
  const confirm = buttons.at(-1);
  if (!confirm) throw new Error("The confirm button is missing.");
  return confirm;
};

describe("RuntimeRestartControl", () => {
  test("states that no live sessions are affected and restarts after confirmation", async () => {
    const restart = mock(async (): Promise<RuntimeRestartResult> => ({
      type: "completed",
      status: createHostRuntimeStatusFixture({ kind: "opencode" }),
    }));
    const view = renderControl({
      runtimeRestartImpact: async () => emptyImpact("confirm-1"),
      runtimeRestart: restart,
    });

    fireEvent.click(view.getByRole("button", { name: "Restart OpenCode runtime" }));
    await view.findByText(NO_IMPACT_MESSAGE);
    fireEvent.click(await getConfirmButton(view));

    await waitFor(() => expect(restart).toHaveBeenCalledWith("opencode", "confirm-1"));
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

    fireEvent.click(view.getByRole("button", { name: "Restart OpenCode runtime" }));
    await view.findByText(NO_IMPACT_MESSAGE);
    fireEvent.click(await getConfirmButton(view));

    await view.findByText(RUNTIME_IMPACT_CHANGED_NOTICE);
    expect(view.getByText("Build login")).toBeDefined();
    expect(view.getByText("Waiting for input")).toBeDefined();
    expect(view.getByText("Repo A")).toBeDefined();
    expect(restart).toHaveBeenCalledTimes(1);

    fireEvent.click(await getConfirmButton(view));
    await waitFor(() => expect(restart).toHaveBeenLastCalledWith("opencode", "confirm-2"));
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

    fireEvent.click(view.getByRole("button", { name: "Restart OpenCode runtime" }));
    await view.findByText(NO_IMPACT_MESSAGE);

    // A change of another kind needs no new read.
    act(() => events.emit({ type: "runtime_impact_changed", runtimeKinds: ["codex"] }));
    expect(readImpact).toHaveBeenCalledTimes(1);

    current = impactWithSession("confirm-2");
    act(() => events.emit({ type: "runtime_impact_changed", runtimeKinds: ["opencode"] }));
    await view.findByText("Build login");
    expect(view.queryByText(NO_IMPACT_MESSAGE)).toBeNull();

    // Without live updates the list is not current, so confirmation waits for a new read.
    act(() =>
      events.emit({ __openducktorBrowserLive: true, kind: "stream-warning", message: "Lost." }),
    );
    await view.findByText(/Lost\./);
    expect((await getConfirmButton(view)).hasAttribute("disabled")).toBe(true);
    act(() =>
      events.emit({ __openducktorBrowserLive: true, kind: "reconnected", transportEpoch: "e:1" }),
    );
    await waitFor(async () =>
      expect((await getConfirmButton(view)).hasAttribute("disabled")).toBe(false),
    );

    fireEvent.click(await getConfirmButton(view));
    await waitFor(() => expect(restart).toHaveBeenCalledWith("opencode", "confirm-2"));
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

    fireEvent.click(view.getByRole("button", { name: "Restart OpenCode runtime" }));
    await view.findByText(/Live sessions could not be read\./);
    const confirm = await getConfirmButton(view);
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
