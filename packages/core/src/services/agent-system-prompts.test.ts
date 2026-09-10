import { describe, expect, test } from "bun:test";
import {
  buildAgentKickoffPrompt,
  buildAgentKickoffPromptBundle,
  buildAgentMessagePrompt,
  buildAgentMessagePromptBundle,
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
      task: taskContext,
    });

    expectPromptToContainAll(prompt, [
      "Workflow constraints you must obey:",
      "Lifecycle contract:",
      "Artifact discipline:",
      "Fail-fast rules:",
      "OpenDucktor workflow tools are native MCP tools.",
      "Allowed tools for this role:",
      'odt_read_task_assets({"taskId": string, "assetIds": string[]})',
      "Use this exact taskId literal in every odt_* call: task-42.",
      "Omit workspaceId from workflow tool calls; workflow sessions use the startup workspace.",
      "Start each session by calling odt_read_task with taskId task-42 to load the canonical task summary object, including task fields, qaVerdict, and document presence booleans.",
      "Call odt_read_task_documents only when you need specific document bodies, and request only the sections you need.",
      "When task markdown contains odt-asset image references you need to inspect, collect their assetIds and call odt_read_task_assets once for the batch.",
      "Task context:",
      "Artifact access:",
      "description: Rebuild agent workflows",
      "Persisted spec, implementation plan, and latest QA report are intentionally not inlined in this system prompt.",
      "Use odt_read_task with taskId task-42 to load the current canonical task summary object, including task fields, qaVerdict, and document presence booleans.",
      "Use odt_read_task_documents with taskId task-42 and explicit include flags when you need document markdown bodies.",
      "governing constitution for the current task",
      "higher-trust inputs than conversational summaries",
      "Treat the odt_read_task response as the latest persisted workflow summary",
      "odt_set_spec allowed from open/spec_ready/ready_for_dev/in_progress/blocked/ai_review/human_review",
      "odt_set_plan for feature/epic allowed from spec_ready/ready_for_dev/in_progress/blocked/ai_review/human_review.",
      "odt_set_plan for task/bug allowed from open/spec_ready/ready_for_dev/in_progress/blocked/ai_review/human_review.",
      "document-only revisions",
    ]);
    expect(prompt).not.toContain("Existing documents:");
    expect(prompt).not.toContain("- spec: # Purpose");
    expect(prompt).not.toContain("- implementationPlan: ## Plan");
    expect(prompt).not.toContain("- latestQaReport: ## QA");
    expect(prompt).toContain("odt_set_plan");
    expect(prompt).not.toContain("priority must be an integer 0..4");
    expect(prompt).not.toContain('"priority"?: 0|1|2|3|4');
    expect(prompt).not.toContain("- odt_set_spec(");
    expect(prompt).not.toContain("- odt_build_completed(");
    expect(prompt).not.toContain("- odt_qa_rejected(");
    expect(prompt).toContain("odt_read_task_documents");
    expect(prompt).toContain("Feature/epic flow");
    expect(prompt).toContain("read-only mode");
  });

  test("spec defines outcomes and leaves delivery methods to Builder and QA", () => {
    const prompt = buildAgentSystemPrompt({ role: "spec", task: taskContext });

    expectPromptToContainAll(prompt, [
      "observable acceptance criteria",
      "Leave implementation design to Planner",
      "Keep test cases, test commands, evidence checklists, live verification, and smoke-test procedures out of the spec",
      "odt_set_spec exactly once",
      "read-only mode",
    ]);
    expect(prompt).not.toContain("[NEEDS CLARIFICATION]");
    expect(prompt).not.toContain("cite concrete file paths in your final summary");
  });

  test("spec asks users for product decisions and follows their dependencies", () => {
    const prompt = buildAgentSystemPrompt({ role: "spec", task: taskContext });

    expectPromptToContainAll(prompt, [
      "The user owns product decisions",
      "Research facts from the repo and available sources yourself",
      "Ask small rounds of independent questions",
      "Use the question or user-input tool for clarification questions whenever it is available",
      "If no such tool is available, ask a concise question in chat and wait for the answer",
      "Do not call odt_set_spec while required product decisions still await an answer",
      "Wait for answers before deciding dependent questions",
      "Revisit consequences after each answer",
      "Skip questions already answered by the task, prior decisions, or repo facts",
      "Treat the user's answers as settled decisions",
    ]);
    expect(prompt).not.toContain("Ask one focused question only");
  });

  test.each(["spec", "planner"] as const)(
    "%s saves ready documents without an extra approval round",
    (role) => {
      const prompt = buildAgentSystemPrompt({ role, task: taskContext });

      expectPromptToContainAll(prompt, [
        "in the same turn",
        "Do not ask for permission to save",
        "If the user explicitly requests a draft review before saving, show the complete Markdown draft and wait for that review",
        "After the tool succeeds",
        "Saving the document with your allowed ODT tool is part of this role",
      ]);
      expect(prompt).not.toContain(
        "Get confirmation of new or changed product decisions before saving",
      );
      expect(prompt).not.toContain("confirmation requests whenever");
    },
  );

  test("spec saves settled or delegated decisions and keeps acceptance criteria readable", () => {
    const prompt = buildAgentSystemPrompt({ role: "spec", task: taskContext });

    expectPromptToContainAll(prompt, [
      "all required product decisions are answered or explicitly delegated",
      "State any delegated assumptions in the spec",
      "Group the goal, scope and non-goals, required behavior, constraints, and acceptance criteria under descriptive headings",
      "Number acceptance criteria and give each item one observable outcome",
    ]);
  });

  test.each(["spec", "planner", "qa"] as const)(
    "%s receives shared Markdown rules for persisted artifacts",
    (role) => {
      const prompt = buildAgentSystemPrompt({ role, task: taskContext });

      expectPromptToContainAll(prompt, [
        "Artifact format:",
        "Start with a # title and use ## headings",
        "Separate headings, paragraphs, lists, and tables with blank lines",
        "Keep each paragraph to one idea and at most three short sentences",
        "one requirement, decision, or finding per item",
        "Use tables only for compact comparisons or mappings",
        "Check the complete Markdown for structure and readability before calling the artifact tool",
      ]);
    },
  );

  test("shared artifact rules stay general while Builder owns execution choices", () => {
    const result = buildAgentSystemPromptBundle({ role: "build", task: taskContext });
    const shared = result.templates.find((entry) => entry.id === "system.shared.workflow_guards");

    expect(shared?.content).toContain("governing constitution for the current task");
    expect(shared?.content).toContain("Keep summaries and decisions faithful to repo evidence");
    expect(shared?.content).not.toContain("Builder");
    expect(result.prompt).toContain(
      "Choose implementation details, work order, and verification methods",
    );
  });

  test("planner defines design contracts and gives Builder control of implementation", () => {
    const prompt = buildAgentSystemPrompt({ role: "planner", task: taskContext });

    expectPromptToContainAll(prompt, [
      "module responsibilities, architecture boundaries, interfaces, data and state contracts",
      "Distinguish required design decisions from suggestions",
      "Builder owns implementation details, work order, and verification methods",
      "Keep test cases, test commands, evidence checklists, live verification, and smoke-test procedures out of the plan",
      "odt_set_plan",
      "read-only mode",
      "Resolve design choices within the agreed scope yourself",
      "Do not call odt_set_plan while a required decision or conflict remains unresolved",
      "Group architecture, module responsibilities, interfaces and contracts, and risks under descriptive headings",
    ]);
    expect(prompt).not.toContain("execution waves");
    expect(prompt).not.toContain("ordered execution plan");
    expect(prompt).not.toContain("Include verification strategy");
  });

  test("builder owns execution and verification within the approved design", () => {
    const prompt = buildAgentSystemPrompt({ role: "build", task: taskContext });

    expectPromptToContainAll(prompt, [
      "Choose implementation details, work order, and verification methods",
      "preserve required outcomes, architecture boundaries, and contracts",
      "Fix scope-aligned issues at the source",
      "Run checks required by repo guidance",
      "Repeat or broaden checks only when changes, failures, or unresolved risks justify it",
      "meaningful Conventional Commit before calling odt_build_completed",
      "odt_build_blocked with a specific reason",
      "odt_build_resumed",
    ]);
    expect(prompt).not.toContain("Execute the plan in dependency order");
    expect(prompt).not.toContain("- odt_set_plan(");
  });

  test("QA reviews outcomes and contracts without enforcing implementation recipes", () => {
    const prompt = buildAgentSystemPrompt({ role: "qa", task: taskContext });

    expectPromptToContainAll(prompt, [
      "Inspect the implementation and its wiring directly",
      "Choose checks based on the changed behavior and risk",
      "Do not reject valid work for a different implementation order or method",
      "severity, location, impact, and a concrete correction",
      "Call exactly one of odt_qa_approved or odt_qa_rejected per review pass",
      "read-only mode",
    ]);
    expect(prompt).not.toContain("Run at least two review lenses");
    expect(prompt).not.toContain("- odt_build_completed(");
  });

  test("override template always wins even with stale baseVersion", () => {
    const result = buildAgentSystemPromptBundle({
      role: "spec",
      task: taskContext,
      overrides: {
        "system.role.spec.base": {
          template: "Custom spec prompt for {{task.id}}",
          baseVersion: 999,
        },
      },
    });

    expect(result.prompt).toContain("Custom spec prompt for task-42");
    expect(result.warnings).toEqual([
      {
        type: "override_base_version_mismatch",
        templateId: "system.role.spec.base",
        builtinVersion: 6,
        overrideBaseVersion: 999,
      },
    ]);
  });

  test.each([
    ["system.shared.workflow_guards", 6, 7, "build"],
    ["system.shared.tool_protocol", 6, 7, "build"],
    ["system.shared.task_context", 3, 4, "build"],
    ["system.role.spec.base", 5, 6, "spec"],
    ["system.role.planner.base", 6, 7, "planner"],
    ["system.role.build.base", 3, 4, "build"],
    ["system.role.qa.base", 3, 4, "qa"],
    ["kickoff.spec_initial", 3, 4, "spec"],
    ["kickoff.planner_initial", 3, 4, "planner"],
    ["kickoff.build_implementation_start", 2, 3, "build"],
    ["kickoff.build_after_qa_rejected", 2, 3, "build"],
    ["kickoff.build_after_human_request_changes", 3, 4, "build"],
    ["kickoff.build_pull_request_generation", 5, 6, "build"],
    ["kickoff.qa_review", 2, 3, "qa"],
  ] as const)(
    "keeps prior overrides and reports the new version for %s",
    (id, previous, current, role) => {
      let custom = "Custom {{task.id}}";
      if (id === "kickoff.build_pull_request_generation") {
        custom += " {{git.targetBranch}}";
      }
      if (id === "kickoff.build_after_human_request_changes") {
        custom += " {{humanFeedback}}";
      }
      const overrides = { [id]: { template: custom, baseVersion: previous, enabled: true } };
      const result = id.startsWith("kickoff.")
        ? buildAgentKickoffPromptBundle({
            role,
            // SAFETY: The startsWith check narrows this closed table to its kickoff template IDs.
            templateId: id as Parameters<typeof buildAgentKickoffPromptBundle>[0]["templateId"],
            task: taskContext,
            extraPlaceholders: { humanFeedback: "feedback" },
            git: { targetBranch: { branch: "main" } },
            overrides,
          })
        : buildAgentSystemPromptBundle({ role, task: taskContext, overrides });

      expect(result.templates.find((entry) => entry.id === id)?.source).toBe("override");
      expect(result.prompt).toContain("Custom task-42");
      expect(result.warnings).toEqual([
        {
          type: "override_base_version_mismatch",
          templateId: id,
          builtinVersion: current,
          overrideBaseVersion: previous,
        },
      ]);
    },
  );

  test("throws actionable error for unsupported override placeholders", () => {
    expect(() =>
      buildAgentSystemPrompt({
        role: "spec",
        task: taskContext,
        overrides: {
          "system.role.spec.base": {
            template: "Custom {{unknown.placeholder}}",
            baseVersion: 1,
          },
        },
      }),
    ).toThrow(
      'Prompt template "system.role.spec.base" uses unsupported placeholder "unknown.placeholder".',
    );
  });

  test("allows enabled empty override templates without runtime failure", () => {
    const result = buildAgentSystemPromptBundle({
      role: "spec",
      task: taskContext,
      overrides: {
        "system.shared.workflow_guards": {
          template: "",
          baseVersion: 3,
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
  test("build kickoff delegates execution within the approved outcomes and contracts", () => {
    const prompt = buildAgentKickoffPrompt({
      role: "build",
      templateId: "kickoff.build_implementation_start",
      task: { taskId: "task-1" },
    });

    expectPromptToContainAll(prompt, [
      "Choose implementation details, work order, and verification",
      "required outcomes and design contracts",
      "Conventional Commit before odt_build_completed",
      "taskId task-1",
    ]);
    expect(prompt).not.toContain("dependency order");
  });

  test("QA rework kickoff validates findings while preserving design contracts", () => {
    const prompt = buildAgentKickoffPrompt({
      role: "build",
      templateId: "kickoff.build_after_qa_rejected",
      task: { taskId: "task-1" },
    });

    expectPromptToContainAll(prompt, [
      "Validate each rejection finding against the current implementation",
      "preserve required outcomes and design contracts",
      "Conventional Commit before odt_build_completed",
      "Use taskId task-1 for every odt_* tool call",
    ]);
  });

  test("human-review kickoff embeds the requested feedback into the kickoff instructions", () => {
    const prompt = buildAgentKickoffPrompt({
      role: "build",
      templateId: "kickoff.build_after_human_request_changes",
      task: {
        taskId: "task-1",
      },
      extraPlaceholders: {
        humanFeedback: "Update the task summary and rerun the desktop tests.",
      },
    });

    expectPromptToContainAll(prompt, [
      "Review the requested changes below plus the current spec, plan, and affected code before editing.",
      "Requested changes from human review:",
      "Update the task summary and rerun the desktop tests.",
      "Use taskId task-1 for every odt_* tool call.",
    ]);
  });

  test("spec, planner, and qa kickoffs reinforce role-specific posture", () => {
    const specPrompt = buildAgentKickoffPrompt({
      role: "spec",
      templateId: "kickoff.spec_initial",
      task: {
        taskId: "task-1",
      },
    });
    const plannerPrompt = buildAgentKickoffPrompt({
      role: "planner",
      templateId: "kickoff.planner_initial",
      task: {
        taskId: "task-1",
      },
    });
    const qaPrompt = buildAgentKickoffPrompt({
      role: "qa",
      templateId: "kickoff.qa_review",
      task: {
        taskId: "task-1",
      },
    });

    expectPromptToContainAll(specPrompt, [
      "observable acceptance criteria",
      "Ask about unresolved product decisions with the question or user-input tool whenever available",
      "If no such tool is available, ask in chat and wait for the answer",
      "Once required decisions are answered or delegated, persist the spec with odt_set_spec in the same turn",
      "Do not ask for permission to save",
      "Use the role's artifact format rules",
      "Leave implementation and verification procedures to later roles",
      "odt_set_spec",
    ]);
    expectPromptToContainAll(plannerPrompt, [
      "architecture, interfaces, contracts",
      "Leave implementation details, work order, and verification methods to Builder",
      "odt_set_plan",
      "Once required decisions are resolved, persist the plan with odt_set_plan in the same turn",
      "Do not ask for permission to save",
      "Use the role's artifact format rules",
    ]);
    expectPromptToContainAll(qaPrompt, [
      "required outcomes and design contracts",
      "Choose checks based on risk",
      "Call exactly one of odt_qa_approved or odt_qa_rejected with taskId task-1",
    ]);
  });

  test("supports kickoff override", () => {
    const result = buildAgentKickoffPromptBundle({
      role: "planner",
      templateId: "kickoff.planner_initial",
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

  test("rejects human-review kickoff overrides that omit the feedback placeholder", () => {
    expect(() =>
      buildAgentKickoffPrompt({
        role: "build",
        templateId: "kickoff.build_after_human_request_changes",
        task: {
          taskId: "task-2",
        },
        extraPlaceholders: {
          humanFeedback: "Tighten the validation copy.",
        },
        overrides: {
          "kickoff.build_after_human_request_changes": {
            template: "Review {{task.id}} before editing.",
            baseVersion: 3,
            enabled: true,
          },
        },
      }),
    ).toThrow(
      'Prompt template "kickoff.build_after_human_request_changes" is missing required placeholder "humanFeedback".',
    );
  });

  test("rejects empty human-feedback placeholder values", () => {
    expect(() =>
      buildAgentKickoffPrompt({
        role: "build",
        templateId: "kickoff.build_after_human_request_changes",
        task: {
          taskId: "task-3",
        },
        extraPlaceholders: {
          humanFeedback: "   ",
        },
      }),
    ).toThrow('Prompt placeholder "humanFeedback" must not be empty.');
  });

  test("pull request generation kickoff drives repo-aware publication for reused sessions and forks", () => {
    const result = buildAgentKickoffPromptBundle({
      role: "build",
      templateId: "kickoff.build_pull_request_generation",
      task: {
        taskId: "task-1",
      },
      git: {
        targetBranch: {
          remote: "origin",
          branch: "release/2026.04",
        },
      },
    });
    const prompt = result.prompt;

    expectPromptToContainAll(prompt, [
      "Publish a review-ready pull request for the current task.",
      "Pull request base:\nrelease/2026.04",
      "Use the base branch for Git diffs, rebases, and pull request provider tools.",
      "Treat the current task artifacts and live repository state as the source of truth.",
      "If the source branch is behind the base branch, rebase it and resolve conflicts.",
      "Preparation is complete when the diff matches the current task and every required local check passes.",
      "Use a concise Conventional Commit-style pull request title that explains why the change matters.",
      "Start the body with the problem and goal. Add reviewer context and decisions or tradeoffs that affect review.",
      "Push the source branch, create or update the pull request against the base branch, and confirm the published title and body follow repository conventions.",
      "After the pull request exists, call odt_set_pull_request with taskId task-1, the tool's required providerId, and the pull request number.",
      "If any fail, diagnose and fix the root cause, rerun the affected local checks, commit and push the fix, then check again until all required checks pass.",
      "Completion criterion: the task references the pull request and every required pull request check passes.",
      "Report the pull request URL and the passed local and pull request checks.",
    ]);
    expect(prompt).not.toContain("Builder session");
    expect(prompt).not.toContain("comparison");
    expect(prompt).not.toContain("origin/release/2026.04");
    expect(prompt).not.toContain("target");
    expect(result.templates[0]?.builtinVersion).toBe(6);
  });

  test("rejects pull request generation kickoff when target branch context is missing", () => {
    expect(() =>
      buildAgentKickoffPrompt({
        role: "build",
        templateId: "kickoff.build_pull_request_generation",
        task: {
          taskId: "task-1",
        },
      }),
    ).toThrow(
      'Missing required git context for "kickoff.build_pull_request_generation": targetBranch.',
    );
  });

  test("rejects an upstream-relative pull request target", () => {
    expect(() =>
      buildAgentKickoffPrompt({
        role: "build",
        templateId: "kickoff.build_pull_request_generation",
        task: {
          taskId: "task-1",
        },
        git: {
          targetBranch: {
            branch: "@{upstream}",
          },
        },
      }),
    ).toThrow(
      "Pull request generation requires an explicit target branch; '@{upstream}' cannot identify a pull request base branch.",
    );
  });

  test("allows enabled empty kickoff override templates", () => {
    const result = buildAgentKickoffPromptBundle({
      role: "planner",
      templateId: "kickoff.planner_initial",
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
      templateId: "kickoff.planner_initial",
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

  test("rejects unknown kickoff prompt templates", () => {
    expect(() =>
      buildAgentKickoffPrompt({
        role: "build",
        // @ts-expect-error This negative test verifies rejection of an unknown template ID.
        templateId: "kickoff.build_rebase_conflict_resolution",
        task: {
          taskId: "task-2",
        },
      }),
    ).toThrow('Unknown prompt template id "kickoff.build_rebase_conflict_resolution".');
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

  test("builds a concise git conflict resolution message with useful conflict context", () => {
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
      "Resolve the conflicts below and finish the interrupted git operation.",
      "Git context:",
      "- Operation: direct merge (rebase)",
      "- Current branch: feature/task-1",
      "- Target branch: origin/main",
      "- Conflicted files:",
      "- src/main.ts",
      "- src/lib.ts",
      "inspect the live git state and relevant history",
      "Understand the intent of both sides",
      "preserve compatible changes",
      "avoid unrelated edits",
      "Make only the changes needed to resolve the conflicts, then run the relevant checks",
      "If you cannot finish safely, explain the blocker and stop",
      "Do not abort the git operation unless explicitly asked",
      "summarize what you resolved and which checks passed",
      "Use taskId task-1 for any odt_* tool calls.",
    ]);
    expect(prompt).not.toContain("CONFLICT (content)");
  });

  test("omits raw git output while retaining conflict metadata", () => {
    const buildPrompt = (conflictOutput: string) =>
      buildAgentMessagePrompt({
        role: "build",
        templateId: "message.build_rebase_conflict_resolution",
        task: {
          taskId: "task-bounded",
        },
        git: {
          operationLabel: "rebase",
          currentBranch: "feature/task-bounded",
          targetBranch: "origin/main",
          conflictedFiles: ["src/conflict-a.ts", "src/conflict-b.ts"],
          conflictOutput,
        },
      });
    const smallPrompt = buildPrompt("SMALL_OUTPUT_SENTINEL");
    const largePrompt = buildPrompt(`LARGE_OUTPUT_SENTINEL_${"x".repeat(10_000)}`);

    expect(largePrompt).toBe(smallPrompt);
    expectPromptToContainAll(smallPrompt, [
      "Operation: rebase",
      "Current branch: feature/task-bounded",
      "Target branch: origin/main",
      "src/conflict-a.ts",
      "src/conflict-b.ts",
      "task-bounded",
      "odt_*",
    ]);

    for (const sentinel of ["SMALL_OUTPUT_SENTINEL", "LARGE_OUTPUT_SENTINEL"]) {
      expect(smallPrompt).not.toContain(sentinel);
      expect(largePrompt).not.toContain(sentinel);
    }
  });

  test("keeps git placeholders available to a stale enabled override", () => {
    const result = buildAgentMessagePromptBundle({
      role: "build",
      templateId: "message.build_rebase_conflict_resolution",
      task: {
        taskId: "OVERRIDE_TASK_SENTINEL",
      },
      git: {
        operationLabel: "OVERRIDE_OPERATION_SENTINEL",
        currentBranch: "OVERRIDE_CURRENT_BRANCH_SENTINEL",
        targetBranch: "OVERRIDE_TARGET_BRANCH_SENTINEL",
        conflictedFiles: ["OVERRIDE_FILE_SENTINEL.ts"],
        conflictOutput: "OVERRIDE_OUTPUT_SENTINEL",
      },
      overrides: {
        "message.build_rebase_conflict_resolution": {
          template:
            "{{git.operationLabel}}\n{{git.currentBranch}}\n{{git.targetBranch}}\n{{git.conflictedFiles}}\n{{git.conflictOutput}}\n{{task.id}}",
          baseVersion: 2,
          enabled: true,
        },
      },
    });

    expectPromptToContainAll(result.prompt, [
      "OVERRIDE_OPERATION_SENTINEL",
      "OVERRIDE_CURRENT_BRANCH_SENTINEL",
      "OVERRIDE_TARGET_BRANCH_SENTINEL",
      "OVERRIDE_FILE_SENTINEL.ts",
      "OVERRIDE_OUTPUT_SENTINEL",
      "OVERRIDE_TASK_SENTINEL",
    ]);
    expect(result.templates[0]?.source).toBe("override");
    expect(result.warnings).toEqual([
      {
        type: "override_base_version_mismatch",
        templateId: "message.build_rebase_conflict_resolution",
        builtinVersion: 3,
        overrideBaseVersion: 2,
      },
    ]);
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
        templateId: "kickoff.planner_initial",
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
  test("returns definitions for role, kickoff, message, and permission prompts", () => {
    const definitions = listBuiltinAgentPromptTemplates();
    const ids = definitions.map((entry) => entry.id);

    expect(ids).toContain("system.role.spec.base");
    expect(ids).toContain("system.role.build.base");
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
