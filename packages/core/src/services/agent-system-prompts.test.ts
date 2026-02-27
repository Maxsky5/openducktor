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

    expect(prompt).toContain("native MCP tools");
    expect(prompt).toContain("Allowed tools for this role");
    expect(prompt).toContain("odt_set_plan");
    expect(prompt).toContain("priority must be an integer 0..4");
    expect(prompt).toContain('"priority"?: 0|1|2|3|4');
    expect(prompt).toContain('Use this exact taskId literal in every odt_* call: "task-42"');
    expect(prompt).not.toContain("- odt_set_spec(");
    expect(prompt).not.toContain("- odt_build_completed(");
    expect(prompt).not.toContain("- odt_qa_rejected(");
    expect(prompt).toContain("Feature/epic flow");
    expect(prompt).toContain("read-only mode");
  });

  test("build rework scenario explicitly references QA rejection loop", () => {
    const prompt = buildAgentSystemPrompt({
      role: "build",
      scenario: "build_after_qa_rejected",
      task: taskContext,
    });

    expect(prompt).toContain("Rework after QA rejection");
    expect(prompt).toContain("Address every QA rejection item");
    expect(prompt).toContain("odt_build_completed");
    expect(prompt).not.toContain("- odt_set_plan(");
  });

  test("qa scenario includes approval/rejection tool requirements", () => {
    const prompt = buildAgentSystemPrompt({
      role: "qa",
      scenario: "qa_review",
      task: taskContext,
    });

    expect(prompt).toContain("Call odt_qa_approved or odt_qa_rejected exactly once");
    expect(prompt).toContain("odt_qa_approved");
    expect(prompt).toContain("odt_qa_rejected");
    expect(prompt).not.toContain("- odt_build_completed(");
    expect(prompt).toContain("latestQaReport");
    expect(prompt).toContain("read-only mode");
  });

  test("spec prompt requires repository evidence before persisting spec", () => {
    const prompt = buildAgentSystemPrompt({
      role: "spec",
      scenario: "spec_initial",
      task: taskContext,
    });

    expect(prompt).toContain("Ground the spec in repository evidence");
    expect(prompt).toContain("inspect relevant project files");
    expect(prompt).toContain("cite concrete file paths");
    expect(prompt).toContain("odt_set_spec");
    expect(prompt).toContain("native MCP tools");
    expect(prompt).not.toContain("<obp_tool_call>");
  });
});
