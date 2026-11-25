import { describe, expect, jest, mock, spyOn, test } from "bun:test";
import { setupTestingLibraryFakeTimers } from "@openducktor/frontend-core/test-support/testing-library-fake-timers";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AgentChatInterruptedTurnResume } from "./agent-chat-interrupted-turn-resume";

setupTestingLibraryFakeTimers();

const cancelNothing = async (): Promise<void> => {};
describe("AgentChatInterruptedTurnResume", () => {
  test("counts down to the reported reset without auto-resuming and releases the clock on unmount", () => {
    const start = Date.parse("2026-10-08T00:24:00.000Z");
    // The fake clock of Bun still moves with real time, so a slow run would shift the minutes.
    let now = start;
    const nowSpy = spyOn(Date, "now").mockImplementation(() => now);
    const advance = (ms: number) =>
      act(() => {
        now += ms;
        jest.advanceTimersByTime(ms);
      });
    const onResume = mock(() => {});
    let rendered: ReturnType<typeof render> | undefined;
    try {
      rendered = render(
        <AgentChatInterruptedTurnResume
          isPending={false}
          error={null}
          disabled={false}
          onResume={onResume}
          onCancelAutoResume={cancelNothing}
          usageLimit={{ resetsAtEpochMs: start + 61 * 60_000 }}
        />,
      );
      advance(0);
      expect(screen.getByRole("timer").textContent).toBe("Resets in 1h 1m");
      expect(screen.getByText("The session reached its usage limit.")).toBeDefined();
      expect(rendered.container.querySelector("time")?.dateTime).toBe("2026-10-08T01:25:00.000Z");
      advance(60_000);
      expect(screen.getByRole("timer").textContent).toBe("Resets in 1h 0m");
      advance(60 * 60_000);
      expect(screen.queryByRole("timer")).toBeNull();
      expect(
        screen.getByText("The reported reset time has passed. Select Resume to try again."),
      ).toBeDefined();
      expect(onResume).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Resume" }));
      expect(onResume).toHaveBeenCalledTimes(1);
      rendered.unmount();
      rendered = undefined;
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      rendered?.unmount();
      nowSpy.mockRestore();
    }
  });

  test("offers manual resume when the runtime does not report a reset time", () => {
    const rendered = render(
      <AgentChatInterruptedTurnResume
        isPending={false}
        error={null}
        disabled={false}
        onResume={() => {}}
        onCancelAutoResume={cancelNothing}
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
        onCancelAutoResume={cancelNothing}
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
        onCancelAutoResume={cancelNothing}
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
        onCancelAutoResume={cancelNothing}
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
        onCancelAutoResume={cancelNothing}
      />,
    );

    expect(screen.getByRole("alert").textContent).toBe("Continuation failed");
    rendered.unmount();
  });

  test("shows the planned auto-resume and cancels it for this stop", async () => {
    const now = Date.parse("2026-10-08T00:24:00.000Z");
    const nowSpy = spyOn(Date, "now").mockImplementation(() => now);
    const ref = {
      repoPath: "/repo",
      runtimeKind: "claude" as const,
      workingDirectory: "/repo/worktree",
      externalSessionId: "session-1",
    };
    let finishCancel: () => void = () => {};
    const onCancelAutoResume = mock(
      () =>
        new Promise<void>((resolve) => {
          finishCancel = resolve;
        }),
    );
    const rendered = render(
      <AgentChatInterruptedTurnResume
        isPending={false}
        error={null}
        disabled={false}
        onResume={() => {}}
        usageLimit={{ resetsAtEpochMs: now + 60 * 60_000 }}
        autoResume={{
          ref,
          stopId: "limit-1",
          resumeAtEpochMs: now + 60 * 60_000 + 30_000,
          state: "scheduled",
        }}
        onCancelAutoResume={onCancelAutoResume}
      />,
    );
    try {
      expect(screen.getByRole("timer").textContent).toBe("in 1h 1m");
      expect(rendered.container.querySelector("time")?.dateTime).toBe("2026-10-08T01:24:30.000Z");
      fireEvent.click(screen.getByRole("button", { name: "Cancel auto-resume" }));
      expect(onCancelAutoResume).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "Canceling" }).hasAttribute("disabled")).toBe(true);
      await act(async () => finishCancel());

      rendered.rerender(
        <AgentChatInterruptedTurnResume
          isPending={false}
          error={null}
          disabled={false}
          onResume={() => {}}
          onCancelAutoResume={cancelNothing}
          usageLimit={{ resetsAtEpochMs: now + 60 * 60_000 }}
          autoResume={{
            ref,
            stopId: "limit-1",
            resumeAtEpochMs: now + 60 * 60_000 + 30_000,
            state: "resuming",
          }}
        />,
      );
      expect(screen.queryByRole("button", { name: "Cancel auto-resume" })).toBeNull();
      expect(screen.getByRole("button", { name: "Resuming" }).hasAttribute("disabled")).toBe(true);
    } finally {
      rendered.unmount();
      nowSpy.mockRestore();
    }
  });
});
