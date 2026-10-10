import { expect, mock, test } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { SpeedSelect, type SpeedControlModel } from "./speed-select";

enableReactActEnvironment();
const model = (overrides: Partial<SpeedControlModel> = {}): SpeedControlModel => ({
  key: "session-a",
  choice: "standard",
  levels: [
    { id: "priority", label: "Fast" },
    { id: "future-speed", label: "Future speed" },
  ],
  blockedReason: undefined,
  pending: false,
  disabled: false,
  error: null,
  onChange: () => {},
  ...overrides,
});

test.each([false, true])(
  "offers Standard and every model level with compact=%s and sends its ID",
  async (compact) => {
    const change = mock(() => {});
    render(<SpeedSelect compact={compact} model={model({ onChange: change })} />);
    const trigger = screen.getByRole("button", { name: compact ? "Speed: Standard" : "Standard" });
    await act(async () => fireEvent.click(trigger));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Standard",
      "Fast",
      "Future speed",
    ]);
    await act(async () => fireEvent.click(screen.getByRole("option", { name: "Future speed" })));
    expect(change).toHaveBeenCalledWith("future-speed");
  },
);

test("shows a blocked reason and allows only Standard", async () => {
  const change = mock(() => {});
  render(
    <SpeedSelect
      model={model({
        choice: "priority",
        blockedReason: "Check your account.",
        onChange: change,
      })}
    />,
  );
  const trigger = screen.getByRole("button", { name: "Fast" });
  fireEvent.focus(trigger);
  await waitFor(() =>
    expect(screen.getByRole("tooltip").textContent).toContain("Check your account."),
  );
  await act(async () => fireEvent.click(trigger));
  expect(screen.getByRole("option", { name: "Future speed" }).getAttribute("aria-disabled")).toBe(
    "true",
  );
  await act(async () => fireEvent.click(screen.getByRole("option", { name: "Standard" })));
  expect(change).toHaveBeenCalledWith("standard");
});

test.each([
  { choice: "standard", visible: false },
  { choice: "priority", visible: true },
])("shows a model without speed levels only to leave $choice", ({ choice, visible }) => {
  const view = render(<SpeedSelect compact model={model({ choice, levels: [] })} />);
  expect(view.queryByRole("button") !== null).toBe(visible);
});

test("blocks changes while a speed request is pending", () => {
  render(<SpeedSelect compact model={model({ pending: true })} />);
  expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
});
