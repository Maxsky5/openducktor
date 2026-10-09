import { expect, mock, test } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { initialSpeedState } from "@openducktor/core";
import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { SpeedSelect, type SpeedControlModel } from "./speed-select";

enableReactActEnvironment();
const model = (overrides: Partial<SpeedControlModel> = {}): SpeedControlModel => ({
  key: "session-a",
  livePresence: "present",
  eligibility: "supported",
  levels: [
    { id: "standard", label: "Standard" },
    { id: "priority", label: "Fast" },
    { id: "ultrafast", label: "Ultrafast" },
    { id: "future-speed", label: "Future speed" },
  ],
  state: initialSpeedState("standard", "confirmed"),
  pending: false,
  disabled: false,
  error: null,
  onChange: () => {},
  ...overrides,
});

test.each([false, true])(
  "offers every catalog level with compact=%s and sends its ID",
  async (compact) => {
    const change = mock(() => {});
    render(<SpeedSelect compact={compact} model={model({ onChange: change })} />);
    const trigger = screen.getByRole("button", { name: compact ? "Speed: Standard" : "Standard" });
    await act(async () => fireEvent.click(trigger));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Standard",
      "Fast",
      "Ultrafast",
      "Future speed",
    ]);
    await act(async () => fireEvent.click(screen.getByRole("option", { name: "Ultrafast" })));
    expect(change).toHaveBeenCalledWith("ultrafast");
  },
);

test.each(["supported", "unsupported", "unknown"] as const)(
  "offers explicit Standard for an unknown choice with %s support",
  async (eligibility) => {
    const change = mock(() => {});
    render(
      <SpeedSelect
        model={model({ eligibility, state: initialSpeedState(null), onChange: change })}
      />,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Select speed" })));
    expect(screen.getByRole("option", { name: "Fast" }).getAttribute("aria-disabled")).toBe("true");
    await act(async () => fireEvent.click(screen.getByRole("option", { name: "Standard" })));
    expect(change).toHaveBeenCalledWith("standard");
  },
);

test("keeps the requested level during cooldown and allows Standard", async () => {
  const state = initialSpeedState("priority", "confirmed");
  state.processing = {
    status: "cooldown",
    reason: { code: "limit", message: "Capacity is temporarily limited." },
  };
  state.availability = {
    status: "blocked",
    reason: { code: "account", message: "Check your account." },
  };
  const change = mock(() => {});
  render(<SpeedSelect model={model({ state, onChange: change })} />);
  const trigger = screen.getByRole("button", { name: "Fast" });
  fireEvent.focus(trigger);
  await waitFor(() =>
    expect(screen.getByRole("tooltip").textContent).toContain("Capacity is temporarily limited."),
  );
  await act(async () => fireEvent.click(trigger));
  expect(screen.getByRole("option", { name: "Ultrafast" }).getAttribute("aria-disabled")).toBe(
    "true",
  );
  await act(async () => fireEvent.click(screen.getByRole("option", { name: "Standard" })));
  expect(change).toHaveBeenCalledWith("standard");
});

test.each(
  (["unsupported", "unknown"] as const).flatMap((eligibility) =>
    (
      [
        { livePresence: "present", synchronization: "confirmed", visible: false },
        { livePresence: "absent", synchronization: "unapplied", visible: false },
        { livePresence: "unobserved", synchronization: "unapplied", visible: false },
        { livePresence: "present", synchronization: "unapplied", visible: true },
      ] as const
    ).map((path) => ({ ...path, eligibility })),
  ),
)(
  "offers Standard only when needed with $eligibility support, $livePresence presence, and $synchronization settings",
  async ({ eligibility, livePresence, synchronization, visible }) => {
    const change = mock(() => {});
    const view = render(
      <SpeedSelect
        compact
        model={model({
          eligibility,
          livePresence,
          state: initialSpeedState("standard", synchronization),
          onChange: change,
        })}
      />,
    );
    if (!visible) {
      expect(view.queryByRole("button")).toBeNull();
      return;
    }
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Speed: Standard" })));
    expect(screen.getByRole("option", { name: "Fast" }).getAttribute("aria-disabled")).toBe("true");
    await act(async () => fireEvent.click(screen.getByRole("option", { name: "Standard" })));
    expect(change).toHaveBeenCalledWith("standard");
  },
);

test("blocks changes while a speed request is pending", () => {
  render(<SpeedSelect compact model={model({ pending: true })} />);
  expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
});
