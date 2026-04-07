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
  specMarkdown: "# Purpose",
  planMarkdown: "## Plan",
  latestQaReportMarkdown: "## QA",
};

const expectPromptToContainAll = (prompt: string, fragments: string[]) => {
  for (const fragment of fragments) {
    expect(prompt).toContain(fragment);
  }
};

describe("buildAgentSystemPrompt", () => {
  test("includes structured workflow guards, tool protocol, and task lock", () => {
    const prompt = buildAgentSystemPrompt({
      role: "planner",
      scenario: "planner_initial",
      task: taskContext,
    });

    expectPromptToContainAll(prompt, [
      "Workflow constraints you must obey:",
      "Lifecycle contract:",
      "Artifact discipline:",
      "Fail-fast rules:",
      "OpenDucktor workflow tools are native MCP tools.",
      "Allowed tools for this role:",
      "Use this exact taskId literal in every odt_* call: task-42.",
      "Start each session by calling odt_read_task with taskId task-42 to load the canonical task summary, latest QA verdict, and document presence booleans.",
      "Call odt_read_task_documents only when you need specific document bodies, and request only the sections you need.",
      "Task context:",
      "Artifact access:",
      "description: Rebuild agent workflows",
      "Persisted spec, implementation plan, and latest QA report are intentionally not inlined in this system prompt.",
      "Use odt_read_task with taskId task-42 to load the current canonical task summary, latest QA verdict, and document presence booleans.",
      "Use odt_read_task_documents with taskId task-42 and explicit include flags when you need document markdown bodies.",
      "governing constitution for the current task",
      "higher-trust inputs than conversational summaries",
      "Treat the odt_read_task response as the latest persisted workflow summary",
    ]);
    expect(prompt).not.toContain("Existing documents:");
    expect(prompt).not.toContain("- spec: # Purpose");
    expect(prompt).not.toContain("- implementationPlan: ## Plan");
    expect(prompt).not.toContain("- latestQaReport: ## QA");
    expect(prompt).toContain("odt_set_plan");
    expect(prompt).toContain("priority must be an integer 0..4");
    expect(prompt).toContain('"priority"?: 0|1|2|3|4');
    expect(prompt).not.toContain("- odt_set_spec(");
    expect(prompt).not.toContain("- odt_build_completed(");
    expect(prompt).not.toContain("- odt_qa_rejected(");
    expect(prompt).toContain("odt_read_task_documents");
    expect(prompt).toContain("Feature/epic flow");
    expect(prompt).toContain("read-only mode");
  });

  test("spec prompt is discovery-first and clarification-aware", () => {
    const prompt = buildAgentSystemPrompt({
      role: "spec",
      scenario: "spec_initial",
      task: taskContext,
    });

    expectPromptToContainAll(prompt, [
      "Mission:",
      "Operating stance:",
      "Workflow:",
      "Quality bar:",
      "Anti-patterns:",
      "Done criteria:",
      "Discovery first: understand the user goal, motivation, constraints, and success criteria before diving into implementation details.",
      "Brownfield first: inspect the repository, existing behavior, adjacent flows, and project guidance before inventing new requirements.",
      "Distinguish locked decisions, assumptions, deferred ideas, and open questions explicitly.",
      "Ask at most one targeted question at a time, only after completing all non-blocked repo research.",
      "include a recommended default and explain what would change based on the answer",
      "[NEEDS CLARIFICATION]",
      "avoid carrying more than 3 open clarification markers into a supposedly ready spec",
      "technology-agnostic",
      "requirements-quality self-check",
      "Do not turn this run into implementation planning or detailed solution design.",
      "inspect relevant project files with read/list/search tools and cite concrete file paths",
    ]);
    expect(prompt).not.toContain("<obp_tool_call>");
  });

  test("planner prompt requires repo-fit architecture, tradeoffs, sequencing, and verification", () => {
    const prompt = buildAgentSystemPrompt({
      role: "planner",
      scenario: "planner_initial",
      task: taskContext,
    });

    expectPromptToContainAll(prompt, [
      "Act like a staff-level technical planner",
      "Treat the approved spec plus repo workflow and guidance docs as the source of truth",
      "Read the relevant code and architecture before planning.",
      "Respect locked user decisions and keep deferred ideas out of committed scope.",
      "Map requirements and acceptance criteria to concrete implementation slices",
      "Identify dependency order, execution waves, must-haves, user or setup steps, and interfaces builders must respect.",
      "Evaluate meaningful tradeoffs and recommend the preferred approach with rationale.",
      "Break work into an ordered execution plan sized for safe, verifiable progress",
      "Include verification strategy, risks, rollout or rollback considerations, observability or docs impacts, and unresolved implementation questions.",
      "Run a cross-artifact consistency check against the spec and repo reality",
      "Write the plan as an execution document the builder can follow directly",
      "Do not merely restate the spec or hide missing requirement coverage behind vague steps.",
    ]);
  });

  test("builder prompt enforces durable implementation, verification, and commit discipline", () => {
    const prompt = buildAgentSystemPrompt({
      role: "build",
      scenario: "build_implementation_start",
      task: taskContext,
    });

    expectPromptToContainAll(prompt, [
      "Mission:",
      "Execution workflow:",
      "Treat the approved plan as the execution source of truth",
      "Execute the plan in dependency order, complete must-haves before nice-to-haves, and make any deviation explicit.",
      "When a scope-aligned bug or missing critical behavior blocks the task, fix it without waiting for permission",
      "Use ordered task tracking for non-trivial work when todo tooling is available.",
      "Prefer test-first or red-green-refactor when practical for logic-heavy or bug-fix work.",
      "Update or add relevant tests for changed behavior.",
      "Run relevant verification before declaring completion.",
      "meaningful Conventional Commit before calling odt_build_completed",
      "Fix the source problem instead of masking failures with fallback logic.",
      "Do not trust passing tests alone; inspect the changed code path for wiring, integration, and maintainability.",
      '"Quick win" changes that leave the touched area structurally worse.',
      "Silently diverging from the approved spec or plan because a different implementation felt easier.",
      "reviewable state with a meaningful Conventional Commit when code changed.",
      "Call odt_build_completed once implementation is complete, verification evidence is ready, and the completion summary reflects any meaningful deviations.",
    ]);
    expect(prompt).not.toContain("- odt_set_plan(");
  });

  test("builder rework scenario explicitly requires closing every QA finding", () => {
    const prompt = buildAgentSystemPrompt({
      role: "build",
      scenario: "build_after_qa_rejected",
      task: taskContext,
    });

    expectPromptToContainAll(prompt, [
      "Scenario: Rework after QA rejection.",
      "Resolve every QA finding and restore confidence in the implementation.",
      "Address every listed issue at the root cause, update tests or checks as needed, rerun relevant verification, and confirm requirement coverage still holds.",
      "prepare a meaningful Conventional Commit before completion",
      "Do not call odt_build_completed again until every QA rejection item is addressed or explicitly re-scoped with evidence.",
    ]);
  });

  test("pull request generation prompt supports reuse and fork publication flows", () => {
    const prompt = buildAgentSystemPrompt({
      role: "build",
      scenario: "build_pull_request_generation",
      task: taskContext,
    });

    expectPromptToContainAll(prompt, [
      "Scenario: Pull request generation.",
      "current Builder session or a fork created from it",
      "Use the runtime's native git and GitHub tools to inspect branch state",
      'call odt_set_pull_request exactly once with taskId task-42, providerId "github", and the pull request number.',
    ]);
    expect(prompt).not.toContain("forked Builder worktree");
  });

  test("qa prompt uses an adversarial evidence-based review rubric", () => {
    const prompt = buildAgentSystemPrompt({
      role: "qa",
      scenario: "qa_review",
      task: taskContext,
    });

    expectPromptToContainAll(prompt, [
      "Review rubric:",
      "Act like a principal-engineer reviewer",
      "Do not trust completion summaries, checked boxes, or claimed verification; inspect repo evidence directly.",
      "Completeness: verify everything materially required by the spec and plan is actually implemented, and call out uncovered requirements or acceptance criteria.",
      "Correctness: verify the code appears to work, including edge cases, failure handling, regression risk, and key data or control flow.",
      "Coherence: verify the solution fits the repo architecture, contracts, boundaries, and patterns.",
      "Quality: verify the touched scope is free of obvious code smells, weak abstractions, missing tests, or avoidable maintainability risk.",
      "Actively try to find issues rather than passively confirming success.",
      "Run at least two review lenses: adversarial skepticism",
      "Map the material requirements and acceptance criteria to direct evidence",
      "Verify goal-backward: confirm the expected user outcomes, key wiring, and integrations instead of trusting summaries.",
      "Produce structured findings with severity, evidence, impact, and recommended fix.",
      "Reject when material gaps remain, when critical paths lack evidence, or when the implementation contradicts the artifacts even if tests pass.",
      "If the spec, plan, and implementation disagree, say so explicitly in the report.",
      "Produce a QA report markdown and call odt_qa_approved or odt_qa_rejected exactly once per review pass.",
    ]);
    expect(prompt).not.toContain("- odt_build_completed(");
    expect(prompt).not.toContain("latestQaReport");
    expect(prompt).toContain("read-only mode");
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
        builtinVersion: 2,
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
          baseVersion: 2,
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
  test("build kickoff carries stronger execution guidance with task id placeholder", () => {
    const prompt = buildAgentKickoffPrompt({
      role: "build",
      scenario: "build_implementation_start",
      task: {
        taskId: "task-1",
      },
    });

    expectPromptToContainAll(prompt, [
      "Review the current spec, plan, repo guidance, and relevant code before editing.",
      "Execute the approved plan in dependency order",
      "prefer test-first when practical",
      "prepare a meaningful Conventional Commit before odt_build_completed",
      "odt_build_blocked/odt_build_resumed/odt_build_completed with taskId task-1.",
      "taskId task-1",
    ]);
    expect(prompt.split("\n")).toHaveLength(3);
  });

  test("spec, planner, and qa kickoffs reinforce role-specific posture", () => {
    const specPrompt = buildAgentKickoffPrompt({
      role: "spec",
      scenario: "spec_initial",
      task: {
        taskId: "task-1",
      },
    });
    const plannerPrompt = buildAgentKickoffPrompt({
      role: "planner",
      scenario: "planner_initial",
      task: {
        taskId: "task-1",
      },
    });
    const qaPrompt = buildAgentKickoffPrompt({
      role: "qa",
      scenario: "qa_review",
      task: {
        taskId: "task-1",
      },
    });

    expectPromptToContainAll(specPrompt, [
      "Start with the user goal, motivation, constraints, success criteria, and project guidance before solutioning.",
      "capture deferred ideas separately",
      "keep open [NEEDS CLARIFICATION] items rare",
      "requirements-quality self-check via odt_set_spec",
    ]);
    expectPromptToContainAll(plannerPrompt, [
      "Inspect the approved spec, repo guidance, and relevant code before planning.",
      "requirement traceability, dependency waves, must-haves, architecture tradeoffs, risks, and verification",
      "Builder can execute it directly, not as a spec restatement",
    ]);
    expectPromptToContainAll(qaPrompt, [
      "Review the implementation against the spec, plan, project guidance, and repo evidence, not just the tests or summary.",
      "Map requirements to evidence, run adversarial and edge-case review lenses",
      "completeness/correctness/coherence/quality rubric with goal-backward verification of key wiring",
      "Call exactly one of odt_qa_approved or odt_qa_rejected with taskId task-1",
    ]);
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
          baseVersion: 2,
          enabled: true,
        },
      },
    });

    expect(result.prompt).toBe("Planner kickoff task-2 / desc");
    expect(result.templates[0]?.source).toBe("override");
  });

  test("pull request generation kickoff supports reused sessions and forks", () => {
    const prompt = buildAgentKickoffPrompt({
      role: "build",
      scenario: "build_pull_request_generation",
      task: {
        taskId: "task-1",
      },
    });

    expectPromptToContainAll(prompt, [
      "Focus only on pull request publication work for the current Builder session or fork.",
      'call odt_set_pull_request with taskId task-1, providerId "github", and the pull request number.',
    ]);
    expect(prompt).not.toContain("Builder fork");
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
          baseVersion: 2,
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
          baseVersion: 2,
          enabled: false,
        },
      },
    });

    expect(prompt).toContain(
      "Inspect the approved spec, repo guidance, and relevant code before planning.",
    );
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
    ).toBe(
      "Rejected by OpenDucktor qa read-only policy: this role cannot use mutating tools in this session.",
    );
  });

  test("builds git conflict resolution message with git context", () => {
    const prompt = buildAgentMessagePrompt({
      role: "build",
      templateId: "message.build_rebase_conflict_resolution",
      task: {
        taskId: "task-1",
      },
      git: {
        operationLabel: "direct merge (rebase)",
        currentBranch: "feature/task-1",
        targetBranch: "origin/main",
        conflictedFiles: ["src/main.ts", "src/lib.ts"],
        conflictOutput: "CONFLICT (content): Merge conflict in src/main.ts",
      },
    });

    expectPromptToContainAll(prompt, [
      "Resolve the current git conflict in this worktree without losing intended behavior.",
      "Git context:",
      "Conflict workflow:",
      "Understand both sides of the conflict and the interrupted operation before editing.",
      "Use taskId task-1",
    ]);
    expect(prompt).toContain("direct merge (rebase)");
    expect(prompt).toContain("feature/task-1");
    expect(prompt).toContain("origin/main");
    expect(prompt).toContain("- src/main.ts");
  });

  test("rejects git conflict resolution message when required git context is missing", () => {
    expect(() =>
      buildAgentMessagePrompt({
        role: "build",
        templateId: "message.build_rebase_conflict_resolution",
        task: {
          taskId: "task-1",
        },
        git: {
          targetBranch: "origin/main",
          conflictedFiles: ["src/main.ts"],
        },
      }),
    ).toThrow(
      'Missing required git conflict context for "message.build_rebase_conflict_resolution": operationLabel, currentBranch, conflictOutput.',
    );
  });

  test("rejects git placeholders when the selected template does not receive git context", () => {
    expect(() =>
      buildAgentKickoffPrompt({
        role: "planner",
        scenario: "planner_initial",
        task: {
          taskId: "task-2",
        },
        overrides: {
          "kickoff.planner_initial": {
            template: "Planner kickoff {{git.conflictOutput}}",
            baseVersion: 2,
            enabled: true,
          },
        },
      }),
    ).toThrow(
      'Prompt template "kickoff.planner_initial" is missing placeholder value "git.conflictOutput".',
    );
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
