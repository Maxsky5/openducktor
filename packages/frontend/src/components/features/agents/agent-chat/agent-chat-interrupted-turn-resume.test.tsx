import { describe, expect, mock, spyOn, test } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { AgentChatInterruptedTurnResume } from "./agent-chat-interrupted-turn-resume";

enableReactActEnvironment();

describe("AgentChatInterruptedTurnResume", () => {
  test("counts down to the reported reset without auto-resuming and releases the clock on unmount", () => {
    let now = Date.parse("2026-10-08T00:24:00.000Z");
    const nowSpy = spyOn(Date, "now").mockImplementation(() => now);
    const intervalSpy = spyOn(globalThis, "setInterval");
    const clearSpy = spyOn(globalThis, "clearInterval");
    const onResume = mock(() => {});
    let rendered: ReturnType<typeof render> | undefined;
    try {
      rendered = render(
        <AgentChatInterruptedTurnResume
          isPending={false}
          error={null}
          disabled={false}
          onResume={onResume}
          usageLimit={{ resetsAtEpochMs: now + 61 * 60_000 }}
        />,
      );
      // SAFETY: useMinuteClock passes a function to setInterval; the spy captures that callback.
      const tick = intervalSpy.mock.calls[0]?.[0] as (() => void) | undefined;
      expect(tick).toBeDefined();
      expect(screen.getByRole("timer").textContent).toBe("Resets in 1h 1m");
      expect(screen.getByText("The session reached its usage limit.")).toBeDefined();
      expect(rendered.container.querySelector("time")?.dateTime).toBe("2026-10-08T01:25:00.000Z");
      act(() => {
        now += 60_000;
        tick?.();
      });
      expect(screen.getByRole("timer").textContent).toBe("Resets in 1h 0m");
      act(() => {
        now += 60 * 60_000;
        tick?.();
      });
      expect(screen.queryByRole("timer")).toBeNull();
      expect(
        screen.getByText("The reported reset time has passed. Select Resume to try again."),
      ).toBeDefined();
      expect(onResume).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Resume" }));
      expect(onResume).toHaveBeenCalledTimes(1);
      rendered.unmount();
      rendered = undefined;
      expect(clearSpy).toHaveBeenCalledTimes(1);
    } finally {
      rendered?.unmount();
      nowSpy.mockRestore();
      intervalSpy.mockRestore();
      clearSpy.mockRestore();
    }
  });

  test("offers manual resume when the runtime does not report a reset time", () => {
    const rendered = render(
      <AgentChatInterruptedTurnResume
        isPending={false}
        error={null}
        disabled={false}
        onResume={() => {}}
        usageLimit={{}}
      />,
    );
    try {
      expect(screen.queryByRole("timer")).toBeNull();
      expect(
        screen.getByText(
          "Resume when usage is available. The runtime did not report a reset time.",
        ),
      ).toBeDefined();
      expect(screen.getByRole("button", { name: "Resume" }).hasAttribute("disabled")).toBe(false);
    } finally {
      rendered.unmount();
    }
  });

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
