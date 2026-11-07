import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type { AgentSessionGoalRowModel } from "@openducktor/frontend-core/sessions/goals/use-agent-session-goal-row";
import { AgentChatGoalRow } from "./agent-chat-goal-row";

const rowModel = (overrides: Partial<AgentSessionGoalRowModel> = {}): AgentSessionGoalRowModel => ({
  objective: "Ship the goal feature with tests",
  status: "paused",
  statusLabel: "Paused",
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
    render(<AgentChatGoalRow model={rowModel({ onAction })} />);

    const row = screen.getByRole("region", { name: "Goal" });
    expect(row.textContent).toContain("Paused");
    expect(row.textContent).toContain("Ship the goal feature");
    expect(row.textContent).toContain("Stopped by the user");
    expect(screen.queryByRole("button", { name: "Pause goal" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Resume goal" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear goal" }));
    expect(onAction.mock.calls).toEqual([["resume"], ["clear"]]);
  });

  test("expands the objective and disables actions while one runs", () => {
    render(<AgentChatGoalRow model={rowModel({ pendingAction: "clear", error: "No goal" })} />);

    const toggle = screen.getByRole("button", { name: "Show the whole goal" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Resume goal" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("alert").textContent).toBe("No goal");
  });
});
