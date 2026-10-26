import { expect, mock, test } from "bun:test";
import {
  TERMINAL_PROTOCOL_VERSION,
  type TerminalActivity,
  TerminalRestartResponse,
  TerminalSummary,
} from "@openducktor/contracts";
import { act, fireEvent, render as renderComponent } from "@testing-library/react";
import { createTerminalActivityStore } from "@openducktor/frontend-core/terminals/terminal-activity-store";
import { TerminalRestartButton } from "./terminal-restart-button";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { ReactElement } from "react";

const render = (element: ReactElement) =>
  renderComponent(<TooltipProvider>{element}</TooltipProvider>);

const summary: TerminalSummary = {
  terminalId: "terminal-1",
  label: "Dev",
  context: { repoPath: "/repo", taskId: "task-1" },
  initialWorkingDir: "/repo",
  createdAt: "2026-10-14T00:00:00Z",
  lifecycle: "running",
  exit: null,
  startedBy: "user",
};
const harness = () => {
  const store = createTerminalActivityStore();
  store.apply({ version: TERMINAL_PROTOCOL_VERSION, type: "activity_snapshot_start" });
  store.apply({ version: TERMINAL_PROTOCOL_VERSION, type: "activity_snapshot_end" });
  const update = (activity: TerminalActivity) =>
    act(() =>
      store.apply({ version: TERMINAL_PROTOCOL_VERSION, type: "activity_updated", activity }),
    );
  return {
    store,
    update,
    controller: { readActivity: store.read, subscribeActivity: store.subscribe },
  };
};

test("shows Restart only for this terminal's complete live command", () => {
  const { store, update, controller } = harness();
  const view = render(
    <TerminalRestartButton
      summary={summary}
      controller={controller}
      onRestart={async () => ({ restarted: true })}
    />,
  );
  try {
    update({
      summary: { ...summary, terminalId: "another-terminal" },
      command: "bun dev",
      restartable: true,
    });
    expect(view.queryByRole("button", { name: "Restart command" })).toBeNull();
    update({ summary, command: "bun dev", restartable: false });
    expect(view.queryByText("bun dev")).toBeNull();
    expect(view.queryByRole("button", { name: "Restart command" })).toBeNull();
    update({ summary, command: "bun dev", restartable: true });
    expect(view.getByRole("button", { name: "Restart command" })).toBeTruthy();
    act(() => store.disconnected());
    expect(view.queryByRole("button", { name: "Restart command" })).toBeNull();
  } finally {
    view.unmount();
  }
});

test("keeps restart pending through command completion and shows the host failure", async () => {
  const { store, update, controller } = harness();
  const pending = Promise.withResolvers<TerminalRestartResponse>();
  const restart = mock(() => pending.promise);
  const view = render(
    <TerminalRestartButton summary={summary} controller={controller} onRestart={restart} />,
  );
  try {
    update({ summary, command: "bun dev", restartable: true });
    fireEvent.click(view.getByRole("button", { name: "Restart command" }));
    expect(restart).toHaveBeenCalledWith({ terminalId: "terminal-1", expectedCommand: "bun dev" });
    expect(view.getByRole("button", { name: "Restarting command…" }).hasAttribute("disabled")).toBe(
      true,
    );
    act(() =>
      store.apply({
        version: TERMINAL_PROTOCOL_VERSION,
        type: "activity_removed",
        terminalId: "terminal-1",
      }),
    );
    expect(view.queryByText("bun dev")).toBeNull();
    expect(view.getByRole("button", { name: "Restarting command…" })).toBeTruthy();
    await act(async () => {
      pending.reject(new Error("The command did not stop. Stop it in the terminal."));
      await pending.promise.catch(() => {});
    });
    expect(view.getByRole("alert").textContent).toContain("Stop it in the terminal");
    fireEvent.click(view.getByRole("button", { name: "Dismiss restart error" }));
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.queryByText("bun dev")).toBeNull();
    expect(view.queryByRole("button", { name: "Restarting command…" })).toBeNull();
  } finally {
    view.unmount();
  }
});

for (const change of ["ends", "changes"] as const) {
  test(`clears a restart error when the command ${change}`, async () => {
    const { store, update, controller } = harness();
    const pending = Promise.withResolvers<TerminalRestartResponse>();
    const view = render(
      <TerminalRestartButton
        summary={summary}
        controller={controller}
        onRestart={() => pending.promise}
      />,
    );
    try {
      update({ summary, command: "bun dev", restartable: true });
      await act(async () => {
        fireEvent.click(view.getByRole("button", { name: "Restart command" }));
        pending.reject(new Error("Restart failed"));
        await pending.promise.catch(() => {});
      });
      expect(view.getByRole("alert").textContent).toBe("Restart failed");
      if (change === "ends") {
        act(() =>
          store.apply({
            version: TERMINAL_PROTOCOL_VERSION,
            type: "activity_removed",
            terminalId: summary.terminalId,
          }),
        );
        expect(view.container.textContent).toBe("");
      } else {
        update({ summary, command: "bun test", restartable: true });
      }
      expect(view.queryByRole("alert")).toBeNull();
      update({ summary, command: "bun dev", restartable: true });
      expect(view.queryByRole("alert")).toBeNull();
    } finally {
      view.unmount();
    }
  });
}

test("does not attach a late restart error to a later command", async () => {
  const { update, controller } = harness();
  const pending = Promise.withResolvers<TerminalRestartResponse>();
  const view = render(
    <TerminalRestartButton
      summary={summary}
      controller={controller}
      onRestart={() => pending.promise}
    />,
  );
  try {
    update({ summary, command: "bun dev", restartable: true });
    fireEvent.click(view.getByRole("button", { name: "Restart command" }));
    update({ summary, command: "bun test", restartable: true });
    await act(async () => {
      pending.reject(new Error("Old restart failed"));
      await pending.promise.catch(() => {});
    });
    expect(view.queryByText("bun test")).toBeNull();
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.getByRole("button", { name: "Restart command" }).hasAttribute("disabled")).toBe(
      false,
    );
  } finally {
    view.unmount();
  }
});

test("keeps a pending restart and its failure when another tab is selected", async () => {
  const { update, controller } = harness();
  const pending = Promise.withResolvers<TerminalRestartResponse>();
  const props = { summary, controller, onRestart: () => pending.promise };
  const view = render(<TerminalRestartButton {...props} />);
  try {
    update({ summary, command: "bun dev", restartable: true });
    fireEvent.click(view.getByRole("button", { name: "Restart command" }));
    view.rerender(
      <TooltipProvider>
        <TerminalRestartButton {...props} isVisible={false} />
      </TooltipProvider>,
    );
    expect(view.queryByRole("button", { name: "Restarting command…" })).toBeNull();
    await act(async () => {
      pending.reject(new Error("Restart failed"));
      await pending.promise.catch(() => {});
    });
    expect(view.queryByRole("alert")).toBeNull();
    view.rerender(
      <TooltipProvider>
        <TerminalRestartButton {...props} />
      </TooltipProvider>,
    );
    expect(view.getByRole("alert").textContent).toBe("Restart failed");
  } finally {
    view.unmount();
  }
});
