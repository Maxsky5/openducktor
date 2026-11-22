import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionBackgroundTask } from "@openducktor/contracts";
import {
  type BackgroundTaskStopRequest,
  buildBackgroundTaskRows,
} from "@openducktor/frontend-core/sessions/background-tasks/background-task-bar";
import type { SessionBackgroundTasksModel } from "@openducktor/frontend-core/sessions/background-tasks/use-session-background-tasks";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AgentChatBackgroundTaskBar } from "./agent-chat-background-task-bar";

const command: AgentSessionBackgroundTask = {
  taskId: "task-command",
  kind: "command",
  title: "bun run test --watch",
  stop: { allowed: true },
};
const subagent: AgentSessionBackgroundTask = {
  taskId: "task-subagent",
  kind: "subagent",
  title: "explorer",
  description: "Find the session store",
  stop: { allowed: false, reason: "The runtime cannot stop a subagent." },
};

const barModel = (
  tasks: AgentSessionBackgroundTask[],
  requests: ReadonlyMap<string, BackgroundTaskStopRequest> = new Map(),
  onStop: (taskId: string) => void = () => {},
): SessionBackgroundTasksModel => ({ rows: buildBackgroundTaskRows(tasks, requests), onStop });

const openBar = (): HTMLElement => {
  fireEvent.click(screen.getByRole("button", { name: /Background tasks/ }));
  return screen.getByRole("region", { name: "Background tasks" });
};

describe("AgentChatBackgroundTaskBar", () => {
  test("shows the task count and opens to list each task in start order", () => {
    render(<AgentChatBackgroundTaskBar model={barModel([command, subagent])} scope="session" />);

    const toggle = screen.getByRole("button", { name: /Background tasks/ });
    expect(toggle.textContent).toContain("2 background tasks");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryAllByTestId("background-task-row")).toHaveLength(0);

    openBar();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const rows = screen.getAllByTestId("background-task-row");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Commandbun run test --watch"),
      expect.stringContaining("SubagentexplorerFind the session store"),
    ]);
  });

  test("shows the whole text of a task on demand, also when it cannot stop or stops", () => {
    const { rerender } = render(
      <AgentChatBackgroundTaskBar model={barModel([subagent])} scope="session" />,
    );
    const bar = openBar();

    const text = within(bar).getByRole("button", { name: /explorer/ });
    expect(text.getAttribute("aria-expanded")).toBe("false");
    expect(within(text).getByText("Find the session store").className).toContain("truncate");
    fireEvent.click(text);
    expect(text.getAttribute("aria-expanded")).toBe("true");
    expect(within(text).getByText("Find the session store").className).not.toContain("truncate");

    rerender(
      <AgentChatBackgroundTaskBar
        model={barModel([command], new Map([["task-command", { kind: "stopping" }]]))}
        scope="session"
      />,
    );
    const commandText = within(bar).getByRole("button", { name: "bun run test --watch" });
    expect(commandText).toHaveProperty("disabled", false);
    fireEvent.click(commandText);
    expect(commandText.getAttribute("aria-expanded")).toBe("true");
  });

  test("asks for confirmation before it stops a task", () => {
    const onStop = mock((_taskId: string) => {});
    render(
      <AgentChatBackgroundTaskBar model={barModel([command], new Map(), onStop)} scope="session" />,
    );
    openBar();

    fireEvent.click(screen.getByRole("button", { name: "Stop command bun run test --watch" }));
    const confirmation = screen.getByRole("alertdialog", { name: "Stop this command?" });
    expect(confirmation.textContent).toContain("The agent and the other tasks continue.");
    fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
    expect(onStop).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Stop command bun run test --watch" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Stop" }));
    expect(onStop.mock.calls).toEqual([["task-command"]]);
  });

  test("shows the reason of a task that cannot stop, and no Stop", () => {
    render(<AgentChatBackgroundTaskBar model={barModel([subagent])} scope="session" />);
    const bar = openBar();

    expect(bar.textContent).toContain("The runtime cannot stop a subagent.");
    expect(within(bar).queryByRole("button", { name: /^Stop/ })).toBeNull();
  });

  test("turns Stop off while a stop runs, and offers it again after a failure", () => {
    const { rerender } = render(
      <AgentChatBackgroundTaskBar
        model={barModel([command], new Map([["task-command", { kind: "stopping" }]]))}
        scope="session"
      />,
    );
    const bar = openBar();
    expect(within(bar).getByRole("button", { name: "Stopping" })).toHaveProperty("disabled", true);

    rerender(
      <AgentChatBackgroundTaskBar
        model={barModel(
          [command],
          new Map([["task-command", { kind: "failed", reason: "The process did not end." }]]),
        )}
        scope="session"
      />,
    );
    expect(within(bar).getByRole("alert").textContent).toBe("The process did not end.");
    expect(
      within(bar).getByRole("button", { name: "Stop command bun run test --watch" }),
    ).toHaveProperty("disabled", false);
  });

  test("shows nothing when no task runs", () => {
    render(<AgentChatBackgroundTaskBar model={null} scope="session" />);
    expect(screen.queryByRole("region", { name: "Background tasks" })).toBeNull();
  });
});
