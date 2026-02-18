import { describe, expect, test } from "bun:test";
import { buildAgentSystemPrompt } from "./agent-system-prompts";

const taskContext = {
  taskId: "task-42",
  title: "Improve orchestration",
  issueType: "feature" as const,
  status: "spec_ready",
  qaRequired: true,
  description: "Rebuild agent workflows",
  acceptanceCriteria: "All agents can transition tasks",
  specMarkdown: "# Purpose",
  planMarkdown: "## Plan",
  latestQaReportMarkdown: "## QA",
};

describe("buildAgentSystemPrompt", () => {
  test("includes role-scoped tool protocol and workflow guards", () => {
    const prompt = buildAgentSystemPrompt({
      role: "planner",
      scenario: "planner_initial",
      task: taskContext,
    });

    expect(prompt).toContain("<obp_tool_call>");
    expect(prompt).toContain("Allowed tools for this role");
    expect(prompt).toContain("set_plan");
    expect(prompt).not.toContain("- set_spec {");
    expect(prompt).not.toContain("- build_completed {");
    expect(prompt).not.toContain("- qa_rejected {");
    expect(prompt).toContain("Feature/epic flow");
  });

  test("build rework scenario explicitly references QA rejection loop", () => {
    const prompt = buildAgentSystemPrompt({
      role: "build",
      scenario: "build_after_qa_rejected",
      task: taskContext,
    });

    expect(prompt).toContain("Rework after QA rejection");
    expect(prompt).toContain("Address every QA rejection item");
    expect(prompt).toContain("build_completed");
    expect(prompt).not.toContain("- set_plan {");
  });

  test("qa scenario includes approval/rejection tool requirements", () => {
    const prompt = buildAgentSystemPrompt({
      role: "qa",
      scenario: "qa_review",
      task: taskContext,
    });

    expect(prompt).toContain("Call qa_approved or qa_rejected exactly once");
    expect(prompt).toContain("qa_approved");
    expect(prompt).toContain("qa_rejected");
    expect(prompt).not.toContain("- build_completed {");
    expect(prompt).toContain("latestQaReport");
  });
});
