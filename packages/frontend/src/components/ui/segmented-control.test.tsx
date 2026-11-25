import { expect, test } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import { SegmentedControlItem, SegmentedControlRoot } from "./segmented-control";

test("announces the active button as pressed", () => {
  render(
    <SegmentedControlRoot aria-label="Document view">
      <SegmentedControlItem active>Preview</SegmentedControlItem>
      <SegmentedControlItem active={false}>Source</SegmentedControlItem>
    </SegmentedControlRoot>,
  );

  const views = within(screen.getByRole("group", { name: "Document view" }));
  expect(views.getByRole("button", { pressed: true }).textContent).toBe("Preview");
  expect(views.getByRole("button", { pressed: false }).textContent).toBe("Source");
});

test("announces the active tab as selected", () => {
  render(
    <SegmentedControlRoot role="tablist" aria-label="Review stage">
      <SegmentedControlItem active role="tab">
        Specification
      </SegmentedControlItem>
      <SegmentedControlItem active={false} role="tab">
        Plan
      </SegmentedControlItem>
    </SegmentedControlRoot>,
  );

  const stages = within(screen.getByRole("tablist", { name: "Review stage" }));
  const active = stages.getByRole("tab", { selected: true });
  expect(active.textContent).toBe("Specification");
  expect(active.hasAttribute("aria-pressed")).toBe(false);
  expect(stages.getByRole("tab", { selected: false }).textContent).toBe("Plan");
});
