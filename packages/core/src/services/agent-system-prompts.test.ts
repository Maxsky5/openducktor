import { describe, expect, test } from "bun:test";
import {
  buildAgentKickoffPrompt,
  buildAgentKickoffPromptBundle,
  buildAgentMessagePrompt,
  buildAgentSystemPrompt,
  buildAgentSystemPromptBundle,
  buildReadOnlyPermissionRejectionMessage,
  listBuiltinAgentPromptTemplates,
  mergePromptOverrides,
} from "./agent-system-prompts";

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
    expect(prompt).toContain("Use this exact taskId literal in every odt_* call: task-42");
    expect(prompt).toContain("description: Rebuild agent workflows");
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

  test("override template always wins even with stale baseVersion", () => {
    const result = buildAgentSystemPromptBundle({
      role: "spec",
      scenario: "spec_initial",
      task: taskContext,
      overrides: {
        "system.scenario.spec_initial": {
          template: "Custom spec scenario for {{task.id}}",
          baseVersion: 999,
        },
      },
    });

    expect(result.prompt).toContain("Custom spec scenario for task-42");
    expect(result.warnings).toEqual([
      {
        type: "override_base_version_mismatch",
        templateId: "system.scenario.spec_initial",
        builtinVersion: 1,
        overrideBaseVersion: 999,
      },
    ]);
  });

  test("throws actionable error for unsupported override placeholders", () => {
    expect(() =>
      buildAgentSystemPrompt({
        role: "spec",
        scenario: "spec_initial",
        task: taskContext,
        overrides: {
          "system.scenario.spec_initial": {
            template: "Custom {{unknown.placeholder}}",
            baseVersion: 1,
          },
        },
      }),
    ).toThrow(
      'Prompt template "system.scenario.spec_initial" uses unsupported placeholder "unknown.placeholder".',
    );
  });

  test("allows enabled empty override templates without runtime failure", () => {
    const result = buildAgentSystemPromptBundle({
      role: "spec",
      scenario: "spec_initial",
      task: taskContext,
      overrides: {
        "system.shared.workflow_guards": {
          template: "",
          baseVersion: 1,
          enabled: true,
        },
      },
    });

    const workflowGuardsTemplate = result.templates.find(
      (entry) => entry.id === "system.shared.workflow_guards",
    );
    expect(workflowGuardsTemplate?.source).toBe("override");
    expect(workflowGuardsTemplate?.content).toBe("");
    expect(result.prompt).not.toContain("Workflow constraints you must obey:");
  });
});

describe("kickoff and permission prompts", () => {
  test("builds kickoff message with task id placeholder", () => {
    const prompt = buildAgentKickoffPrompt({
      role: "build",
      scenario: "build_implementation_start",
      task: {
        taskId: "task-1",
      },
    });

    expect(prompt).toContain("Use taskId task-1 for every odt_* tool call.");
    expect(prompt.split("\n")).toHaveLength(2);
  });

  test("supports kickoff override", () => {
    const result = buildAgentKickoffPromptBundle({
      role: "planner",
      scenario: "planner_initial",
      task: {
        taskId: "task-2",
        description: "desc",
      },
      overrides: {
        "kickoff.planner_initial": {
          template: "Planner kickoff {{task.id}} / {{task.description}}",
          baseVersion: 1,
          enabled: true,
        },
      },
    });

    expect(result.prompt).toBe("Planner kickoff task-2 / desc");
    expect(result.templates[0]?.source).toBe("override");
  });

  test("allows enabled empty kickoff override templates", () => {
    const result = buildAgentKickoffPromptBundle({
      role: "planner",
      scenario: "planner_initial",
      task: {
        taskId: "task-2",
      },
      overrides: {
        "kickoff.planner_initial": {
          template: "",
          baseVersion: 1,
          enabled: true,
        },
      },
    });

    expect(result.prompt).toBe("");
    expect(result.templates[0]?.source).toBe("override");
    expect(result.templates[0]?.content).toBe("");
  });

  test("ignores disabled overrides when building prompts", () => {
    const prompt = buildAgentKickoffPrompt({
      role: "planner",
      scenario: "planner_initial",
      task: {
        taskId: "task-2",
      },
      overrides: {
        "kickoff.planner_initial": {
          template: "Disabled custom kickoff",
          baseVersion: 1,
          enabled: false,
        },
      },
    });

    expect(prompt).toContain("Create or update the implementation plan");
    expect(prompt).not.toContain("Disabled custom kickoff");
  });

  test("rejects scenarios without kickoff prompts", () => {
    expect(() =>
      buildAgentKickoffPrompt({
        role: "build",
        scenario: "build_rebase_conflict_resolution" as never,
        task: {
          taskId: "task-2",
        },
      }),
    ).toThrow('Scenario "build_rebase_conflict_resolution" does not define a kickoff prompt.');
  });

  test("builds read-only permission rejection message", () => {
    expect(
      buildReadOnlyPermissionRejectionMessage({
        role: "qa",
      }),
    ).toBe("Rejected by OpenDucktor qa read-only policy.");
  });

  test("builds rebase conflict resolution message with git context", () => {
    const prompt = buildAgentMessagePrompt({
      role: "build",
      templateId: "message.build_rebase_conflict_resolution",
      task: {
        taskId: "task-1",
      },
      git: {
        currentBranch: "feature/task-1",
        targetBranch: "origin/main",
        conflictedFiles: ["src/main.ts", "src/lib.ts"],
        rebaseOutput: "CONFLICT (content): Merge conflict in src/main.ts",
      },
    });

    expect(prompt).toContain("Resolve the current git rebase conflict");
    expect(prompt).toContain("feature/task-1");
    expect(prompt).toContain("origin/main");
    expect(prompt).toContain("- src/main.ts");
    expect(prompt).toContain("Use taskId task-1");
  });
});

describe("listBuiltinAgentPromptTemplates", () => {
  test("returns definitions for role, scenario, kickoff, and permission prompts", () => {
    const definitions = listBuiltinAgentPromptTemplates();
    const ids = definitions.map((entry) => entry.id);

    expect(ids).toContain("system.role.spec.base");
    expect(ids).toContain("system.scenario.spec_initial");
    expect(ids).toContain("system.scenario.build_rebase_conflict_resolution");
    expect(ids).toContain("kickoff.spec_initial");
    expect(ids).toContain("message.build_rebase_conflict_resolution");
    expect(ids).toContain("permission.read_only.reject");
  });
});

describe("mergePromptOverrides", () => {
  test("resolves repo overrides over global overrides", () => {
    const merged = mergePromptOverrides({
      globalOverrides: {
        "kickoff.spec_initial": {
          template: "global",
          baseVersion: 1,
          enabled: true,
        },
      },
      repoOverrides: {
        "kickoff.spec_initial": {
          template: "repo",
          baseVersion: 1,
          enabled: true,
        },
      },
    });

    expect(merged["kickoff.spec_initial"]?.template).toBe("repo");
  });

  test("falls back to global override when repo override is disabled", () => {
    const merged = mergePromptOverrides({
      globalOverrides: {
        "kickoff.spec_initial": {
          template: "global",
          baseVersion: 1,
          enabled: true,
        },
      },
      repoOverrides: {
        "kickoff.spec_initial": {
          template: "repo-disabled",
          baseVersion: 1,
          enabled: false,
        },
      },
    });

    expect(merged["kickoff.spec_initial"]?.template).toBe("global");
  });
});
