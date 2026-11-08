import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AgentSessionGoalRowModel } from "@openducktor/frontend-core/sessions/goals/use-agent-session-goal-row";
import { AgentChatGoalRow } from "./agent-chat-goal-row";

const rowModel = (overrides: Partial<AgentSessionGoalRowModel> = {}): AgentSessionGoalRowModel => ({
  objective: "Ship the goal feature with tests",
  status: "paused",
  statusLabel: "Paused",
  tone: "warning",
  detail: "Stopped by the user",
  actions: ["resume", "clear"],
  pendingAction: null,
  error: null,
  onAction: () => {},
  ...overrides,
});

describe("AgentChatGoalRow", () => {
  test("shows the status, objective, reason, and runtime actions", () => {
    const onAction = mock((_action: string) => {});
    render(<AgentChatGoalRow model={rowModel({ onAction })} scope="session:present" />);

    const row = screen.getByRole("region", { name: "Goal" });
    expect(row.textContent).toContain("Paused");
    expect(row.textContent).toContain("Ship the goal feature");
    expect(row.textContent).toContain("Stopped by the user");
    expect(screen.queryByRole("button", { name: "Pause goal" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Resume goal" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear goal" }));
    expect(onAction.mock.calls).toEqual([["resume"], ["clear"]]);
  });

  test("expands a cut objective and disables actions while one runs", async () => {
    // The test DOM has no layout, so the line reports that it cuts its text.
    const scrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, value: 500 });
    try {
      render(
        <AgentChatGoalRow
          model={rowModel({ pendingAction: "clear", error: "No goal" })}
          scope="session:present"
        />,
      );

      const toggle = screen.getByRole("button", { name: /Goal Paused Ship the goal feature/ });
      const line = toggle.firstElementChild;
      if (!(line instanceof HTMLElement)) throw new Error("The goal line is missing.");
      await waitFor(() => expect(toggle.getAttribute("aria-expanded")).toBe("false"));
      fireEvent.click(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(line.dataset.clamped).toBe("false");
      expect(screen.getByRole("button", { name: "Resume goal" })).toHaveProperty("disabled", true);
      expect(screen.getByRole("alert").textContent).toBe("No goal");

      fireEvent.click(toggle);
      await waitFor(() => expect(line.dataset.clamped).toBe("true"));
    } finally {
      if (scrollWidth) Object.defineProperty(HTMLElement.prototype, "scrollWidth", scrollWidth);
      else Reflect.deleteProperty(HTMLElement.prototype, "scrollWidth");
    }
  });

  test("offers no expand for an objective that fits", () => {
    render(<AgentChatGoalRow model={rowModel()} scope="session:present" />);

    const line = screen.getByRole("button", { name: /Goal Paused/ });
    expect(line).toHaveProperty("disabled", true);
    expect(line.getAttribute("aria-expanded")).toBeNull();
  });

  test("animates a goal that appears while attached, but not one that comes with the attach", () => {
    const attached = render(<AgentChatGoalRow model={null} scope="session:present" />);
    attached.rerender(<AgentChatGoalRow model={rowModel()} scope="session:present" />);
    expect(screen.getByRole("region", { name: "Goal" }).getAttribute("data-animate-entry")).toBe(
      "true",
    );
    attached.unmount();

    const attaching = render(<AgentChatGoalRow model={null} scope="session:absent" />);
    attaching.rerender(<AgentChatGoalRow model={rowModel()} scope="session:present" />);
    expect(screen.getByRole("region", { name: "Goal" }).getAttribute("data-animate-entry")).toBe(
      "false",
    );
  });

  test("shows no row without a goal", () => {
    render(<AgentChatGoalRow model={null} scope="session:present" />);

    expect(screen.queryByRole("region", { name: "Goal" })).toBeNull();
  });
});
