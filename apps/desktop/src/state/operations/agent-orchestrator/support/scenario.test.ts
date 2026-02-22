import { describe, expect, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { inferScenario, kickoffPrompt } from "./scenario";

const taskFixture: TaskCard = {
  id: "task-1",
  title: "Implement feature",
  description: "desc",
  acceptanceCriteria: "ac",
  notes: "",
  status: "in_progress",
  priority: 1,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  subtaskIds: [],
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false },
  },
  updatedAt: "2026-02-22T08:00:00.000Z",
  createdAt: "2026-02-22T08:00:00.000Z",
};

describe("agent-orchestrator/support/scenario", () => {
  test("infers role-specific scenarios", () => {
    expect(
      inferScenario("spec", taskFixture, {
        specMarkdown: "",
        planMarkdown: "",
        qaMarkdown: "",
      }),
    ).toBe("spec_initial");

    expect(
      inferScenario("planner", taskFixture, {
        specMarkdown: "",
        planMarkdown: "existing",
        qaMarkdown: "",
      }),
    ).toBe("planner_initial");

    expect(
      inferScenario("build", taskFixture, {
        specMarkdown: "",
        planMarkdown: "",
        qaMarkdown: "qa",
      }),
    ).toBe("build_after_qa_rejected");
  });

  test("includes task id instruction in kickoff prompts", () => {
    const prompt = kickoffPrompt("build", "build_implementation_start", "task-1");
    expect(prompt).toContain('Use taskId "task-1" for every odt_* tool call.');
  });
});
