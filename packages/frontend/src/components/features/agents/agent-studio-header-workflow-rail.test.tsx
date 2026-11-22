import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Hammer } from "lucide-react";
import type { WorkflowStepLiveSession } from "@openducktor/frontend-core/types/agent-workflow";
import type { WorkflowRailStep } from "@/types/agent-workflow";
import { WorkflowRail, WorkflowRailPreview } from "./agent-studio-header-workflow-rail";

const builderStep = (
  liveSession: WorkflowStepLiveSession,
  waitingOnBackground = false,
): WorkflowRailStep => ({
  id: "build",
  label: "Builder",
  icon: Hammer,
  hint: "Step hint",
  attentionVariant: "none",
  state: {
    tone: "in_progress",
    availability: "available",
    completion: "in_progress",
    liveSession,
    waitingOnBackground,
  },
});

describe("WorkflowRailPreview", () => {
  test("shows a still Background icon in place of the spinner of a running step that waits on background tasks", () => {
    const { rerender } = render(
      <WorkflowRailPreview
        steps={[builderStep("running")]}
        selectedStepId={null}
        onStepSelect={() => {}}
      />,
    );
    const step = screen.getByRole("button", { name: /Builder/ });
    expect(step.querySelector(".animate-spin")).not.toBeNull();

    rerender(
      <WorkflowRailPreview
        steps={[builderStep("running", true)]}
        selectedStepId={null}
        onStepSelect={() => {}}
      />,
    );
    expect(step.querySelector(".animate-spin")).toBeNull();
    expect(step.querySelector(".lucide-circle-dot-dashed")).toBeNull();
    const icon = screen.getByRole("img", { name: "Running and waiting on background tasks" });
    expect(icon.getAttribute("class")).toContain("lucide-hourglass");
    expect(icon.getAttribute("class")).toContain("text-pending-muted");
  });

  test("shows Background beside the completion check of a done step", () => {
    const reviewedBuilder: WorkflowRailStep = {
      ...builderStep("running", true),
      state: {
        tone: "done",
        availability: "available",
        completion: "done",
        liveSession: "running",
        waitingOnBackground: true,
      },
    };
    render(
      <WorkflowRail steps={[reviewedBuilder]} selectedStepId={null} onStepSelect={() => {}} />,
    );

    const step = screen.getByRole("button", { name: /Builder/ });
    expect(step.querySelector(".lucide-check")).not.toBeNull();
    expect(
      screen.getByRole("img", { name: "Running and waiting on background tasks" }),
    ).not.toBeNull();
  });
});
