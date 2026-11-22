import { describe, expect, test } from "bun:test";
import type { WorkflowStepPresentation } from "@openducktor/frontend-core/types/agent-workflow";
import { workflowStepMarks } from "./workflow-step-marks";

const state = (
  tone: WorkflowStepPresentation["tone"],
  liveSession: WorkflowStepPresentation["liveSession"],
  waitingOnBackground = false,
): WorkflowStepPresentation => ({
  tone,
  liveSession,
  waitingOnBackground,
  availability: "available",
  completion: tone === "done" ? "done" : "in_progress",
});

describe("workflowStepMarks", () => {
  test("a working step spins, and a running step that waits on background tasks stays still", () => {
    expect(workflowStepMarks(state("in_progress", "running"))).toEqual(["spinner"]);
    expect(workflowStepMarks(state("in_progress", "running", true))).toEqual(["hourglass"]);
  });

  test("a done step keeps its check and shows Background beside it", () => {
    expect(workflowStepMarks(state("done", "idle"))).toEqual(["check"]);
    expect(workflowStepMarks(state("done", "running", true))).toEqual(["check", "hourglass"]);
  });
});
