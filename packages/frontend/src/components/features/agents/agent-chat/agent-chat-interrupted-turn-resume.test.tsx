import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { AgentChatInterruptedTurnResume } from "./agent-chat-interrupted-turn-resume";

enableReactActEnvironment();

describe("AgentChatInterruptedTurnResume", () => {
  test("calls onResume when the Resume button is pressed", () => {
    const onResume = mock(() => {});
    const rendered = render(
      <AgentChatInterruptedTurnResume
        isPending={false}
        error={null}
        disabled={false}
        onResume={onResume}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

    expect(onResume).toHaveBeenCalledTimes(1);
    rendered.unmount();
  });

  test("shows the pending label and disables the button while a resume is in flight", () => {
    const rendered = render(
      <AgentChatInterruptedTurnResume
        isPending
        error={null}
        disabled={false}
        onResume={() => {}}
      />,
    );

    const button = screen.getByRole("button", { name: "Resuming" });

    expect(button.hasAttribute("disabled")).toBe(true);
    rendered.unmount();
  });

  test("disables the button while shared interaction is disabled", () => {
    const rendered = render(
      <AgentChatInterruptedTurnResume
        isPending={false}
        error={null}
        disabled
        onResume={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Resume" }).hasAttribute("disabled")).toBe(true);
    rendered.unmount();
  });

  test("renders the resume failure as an alert", () => {
    const rendered = render(
      <AgentChatInterruptedTurnResume
        isPending={false}
        error="Continuation failed"
        disabled={false}
        onResume={() => {}}
      />,
    );

    expect(screen.getByRole("alert").textContent).toBe("Continuation failed");
    rendered.unmount();
  });
});
