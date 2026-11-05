import { ODT_BROWSER_TOOL_NAMES } from "@openducktor/contracts";
import { describe, expect, test } from "bun:test";
import {
  buildAgentKickoffPrompt,
  buildAgentKickoffPromptBundle,
  buildAgentMessagePrompt,
  buildAgentMessagePromptBundle,
  buildAgentSystemPrompt,
  buildAgentSystemPromptBundle,
  buildReadOnlyPermissionRejectionMessage,
  listSpecPlanBuildPromptTemplates,
  mergePromptOverrides,
} from "./agent-prompts";
import { specPlanBuildWorkflow } from "./workflow";
import { specPlanBuildPromptKey, rolePromptKey } from "../../../test-support/spec-plan-build";

const findPromptOverrideProblem = specPlanBuildWorkflow.prompts.findOverrideProblem;

const taskContext = {
  taskId: "task-42",
  title: "Improve orchestration",
  issueType: "feature" as const,
  status: "spec_ready",
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

const expectHeadingsInOrder = (prompt: string, headings: string[]) => {
  const positions = headings.map((heading) => prompt.indexOf(`- ${heading}:`));
  expect(positions).not.toContain(-1);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
};

describe("buildAgentSystemPrompt", () => {
  test.each([
    ["spec", "spec"],
    ["planner", "plan"],
    ["build", "spec, plan"],
    ["qa", "qaReport"],
  ] as const)("shows %s workflow code access beside the shared artifact setter", (role, codes) => {
    const prompt = buildAgentSystemPrompt({ role, task: taskContext });

    expect(prompt).toContain("- odt_set_task_artifact(");
    expect(prompt).toContain(
      `Allowed workflow codes for odt_set_task_artifact: ${codes}. Free-artifact writes are also allowed.`,
    );
    expect(prompt).toContain("Put complete workflow Markdown directly in content.");
    expect(prompt).toContain(
      "For free artifacts, use content for text or dataBase64 for base64 bytes, with fileName and mediaType.",
    );
    expect(prompt).toContain("Omit name, fileName, and mediaType for workflow codes.");
  });

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
      "Allowed OpenDucktor workflow tools for this role:",
      "Use the invocation method advertised by the runtime.",
      "Native research tools, shell commands, and subagents use the runtime's tool catalog and configured permissions.",
      'odt_read_task_assets({"taskId": string, "assetIds": string[]})',
      "Use this exact taskId literal in every task-bound odt_* call: task-42.",
      'odt_search_tasks({"priority"?: number, "issueType"?: "feature"|"bug"|"task", "status"?: "open"|"spec_ready"|"ready_for_dev"|"in_progress"|"blocked"|"ai_review"|"human_review", "title"?: string, "tags"?: string[], "limit"?: number})',
      'odt_create_task({"title": string, "issueType": "feature"|"bug"|"task", "priority": number, "description"?: string, "labels"?: string[]})',
      'odt_update_task({"taskId": string, "title"?: string, "description"?: string, "priority"?: number, "labels"?: string[], "issueType"?: "feature"|"bug"|"task"})',
      "odt_update_task is the only exception: it may update any task in the resolved workspace, including a task other than task-42.",
      "odt_search_tasks and odt_create_task act on the startup workspace, take no taskId, and do not change the session task.",
      "Omit workspaceId from workflow tool calls; workflow sessions use the startup workspace.",
      "Start each session by calling odt_read_task with taskId task-42 to load task fields, workflow artifact states, and metadata for all current workflow and free artifacts.",
      "Free-artifact writes do not change task status or satisfy workflow requirements.",
      "Use odt_set_task_artifact with code spec, plan, or qaReport for workflow artifacts.",
      "Reopen a closed task before changing a free artifact.",
      "Read saved artifact content; never infer it from summaries or combine chunks from different versions.",
      "When task markdown contains odt-asset image references you need to inspect, collect their assetIds and call odt_read_task_assets once for the batch.",
      "Task context:",
      "Artifact access:",
      "description: Rebuild agent workflows",
      "The saved spec, plan, and QA report are not in this prompt.",
      'After odt_read_task, read needed content with odt_read_task_artifacts, for example odt_read_task_artifacts({"taskId":"task-42","codes":["spec"]}).',
      "Select artifacts with codes from task.artifacts.",
      "Workflow codes are spec, plan, and qaReport.",
      "Free-artifact codes stay the same when display names change.",
      "Artifact reads return complete content in one request, or fail.",
      "They accept no byte offsets or continuation tokens.",
      "governing constitution for the current task",
      "higher-trust inputs than conversational summaries",
      "Treat the odt_read_task response as the latest persisted workflow summary",
      "odt_set_task_artifact with code spec allowed from open/spec_ready/ready_for_dev/in_progress/blocked/ai_review/human_review",
      "odt_set_task_artifact with code plan for feature allowed from spec_ready/ready_for_dev/in_progress/blocked/ai_review/human_review.",
      "odt_set_task_artifact with code plan for task/bug allowed from open/spec_ready/ready_for_dev/in_progress/blocked/ai_review/human_review.",
      "artifact-only revisions",
    ]);
    // The MCP definitions describe browser tool input, so the prompt names the tools only.
    expect(prompt).toContain(`- Browser tools: ${ODT_BROWSER_TOOL_NAMES.join(", ")}`);
    expect(prompt).not.toContain("odt_browser_click({");
    expect(prompt).not.toContain("Existing artifacts:");
    expect(prompt).not.toContain("- spec: # Purpose");
    expect(prompt).not.toContain("- implementationPlan: ## Plan");
    expect(prompt).not.toContain("- latestQaReport: ## QA");
    expect(prompt).toContain("odt_set_task_artifact");
    expect(prompt).not.toContain("priority must be an integer 0..4");
    expect(prompt).not.toContain('"priority"?: 0|1|2|3|4');
    expect(prompt).not.toContain("- odt_set_spec(");
    expect(prompt).not.toContain("- odt_apply_workflow_event(");
    expect(prompt).not.toContain("Workflow events for odt_apply_workflow_event");
    expect(prompt).not.toContain("- odt_qa_rejected(");
    expect(prompt).toContain("odt_read_task_artifacts");
    expect(prompt).toContain("Feature flow");
    expect(prompt).toContain("read-only mode");
  });

  test("spec defines outcomes and leaves delivery methods to Builder and QA", () => {
    const prompt = buildAgentSystemPrompt({ role: "spec", task: taskContext });

    expectPromptToContainAll(prompt, [
      "Planner owns the technical design",
      "Keep test cases, test commands, evidence checklists, live verification, and smoke-test procedures out of the spec",
      "saving the canonical spec with odt_set_task_artifact and code spec",
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
      "no required product decision remains unanswered",
      "Wait for answers before deciding dependent questions",
      "Revisit consequences after each answer",
      "Skip questions already answered by the task, prior decisions, or repo facts",
      "Treat the user's answers as settled decisions",
    ]);
    expect(prompt).not.toContain("Ask one focused question only");
  });

  test.each(["spec", "planner"] as const)(
    "%s saves ready artifacts without an extra approval round",
    (role) => {
      const prompt = buildAgentSystemPrompt({ role, task: taskContext });

      expectPromptToContainAll(prompt, [
        "Saving the artifact is part of your assignment",
        "in the same turn",
        "After the tool succeeds",
        "If saving fails, report the failure",
      ]);
      expect(prompt).not.toContain(
        "Get confirmation of new or changed product decisions before saving",
      );
      expect(prompt).not.toContain("confirmation requests whenever");
      expect(prompt).not.toContain("draft review before saving");
    },
  );

  test("spec keeps observable outcomes in the requirements without a second checklist", () => {
    const prompt = buildAgentSystemPrompt({ role: "spec", task: taskContext });

    expectPromptToContainAll(prompt, [
      "When the user delegates a choice, make it and record the assumption",
      "## Problem and outcome",
      "## Scope",
      "## Requirements",
      "descriptive ### subheadings",
      "the relevant conditions, and the expected result",
      "Keep observable outcomes and limits beside the requirement they qualify",
      "Do not add a separate acceptance-criteria section or completion checklist",
      "Add a diagram for a multi-step user flow or a set of user-visible states",
      "Keep diagrams and tables at product level, without internal modules or code",
    ]);
    expect(prompt).not.toContain("## Acceptance criteria");
    expect(prompt).not.toContain("requirements and acceptance criteria cover the agreed scope");
  });

  test("spec separates product behavior from design while preserving fixed scope and external contracts", () => {
    const prompt = buildAgentSystemPrompt({ role: "spec", task: taskContext });

    expectPromptToContainAll(prompt, [
      "Describe behavior as users or external systems experience it",
      "Planner owns the technical design: architecture, boundaries, contracts, and library choices",
      "Builder owns file changes, configuration keys, and code-level identifiers",
      "only when the task or user explicitly makes it part of the required outcome or scope",
      "or when it defines an external contract the change must preserve",
      "State its source and required effect",
      "Leave repository coding conventions and internal design rules to Planner and Builder",
      "state the visible label and click behavior",
      "Builder chooses the locale key and string accessor",
    ]);
  });

  test.each(["spec", "planner", "build", "qa"] as const)(
    "%s receives shared Markdown rules for persisted artifacts",
    (role) => {
      const prompt = buildAgentSystemPrompt({ role, task: taskContext });

      expectPromptToContainAll(prompt, [
        "Artifact format:",
        "Write for someone who has not followed the conversation",
        "Use a # title, ## topic headings",
        "Leave blank lines between Markdown blocks",
        "Use paragraphs to explain context and reasoning",
        "Give each requirement, decision, and finding its own list item, table row, or subheading",
        "conditions and exceptions beside the rule they qualify",
        "use tables when entries share the same fields",
        "fenced code blocks with a language tag",
        "Add a Mermaid diagram in a fenced code block tagged mermaid",
        "keep every requirement and decision in the text as well",
        "do not add HTML, click handlers, or theme and style directives",
        'declare such a state with state "In review (AI)" as Review',
        "Draw flowcharts top to bottom with flowchart TD",
      ]);
    },
  );

  test("shared artifact rules stay general while Builder owns execution choices", () => {
    const result = buildAgentSystemPromptBundle({ role: "build", task: taskContext });
    const shared = result.templates.find(
      (entry) => entry.key === specPlanBuildPromptKey("workflow.rules"),
    );

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
      "required design decisions separate from suggestions",
      "Builder owns implementation details, work order, and verification methods",
      "Keep test cases, test commands, evidence checklists, live verification, and smoke-test procedures out of the plan",
      "odt_set_task_artifact and code plan",
      "read-only mode",
      "Make technical decisions within the agreed scope",
      "no required design decision remains open",
      "Cover all requirements, including scope and constraints",
      "Use the spec's requirement names when a spec exists",
      "state ownership, and failure behavior",
      "Work as a software architect",
      "Stay at the architecture level",
      "Include a detail only when changing it would change the architecture, a contract, or a required behavior",
      "Do not show internal module functions, configuration objects, or call sites",
      "refer to requirements by name instead of restating the spec",
      "Show the target design in one Mermaid diagram",
      "Write only its signature or shape",
    ]);
    expectHeadingsInOrder(prompt, [
      "## Approach",
      "## Design",
      "## Requirement coverage",
      "## Risks and constraints",
    ]);
    expect(prompt).not.toContain("execution waves");
    expect(prompt).not.toContain("ordered execution plan");
    expect(prompt).not.toContain("Include verification strategy");
    expect(prompt).not.toContain("or acceptance criteria as references");
  });

  test.each(["task", "bug"] as const)(
    "planner traces %s requirements when no spec exists",
    (issueType) => {
      const prompt = buildAgentSystemPrompt({
        role: "planner",
        task: {
          taskId: `${issueType}-no-spec`,
          title: "Preserve the selection when export fails",
          issueType,
          status: "open",
          description: "If an export fails, retain the selection and show the reason.",
        },
      });

      expectPromptToContainAll(prompt, [
        "For a task or bug without a spec, use the task requirements",
        "Reference the source requirements for the problem and scope",
        "Cover all requirements, including scope and constraints",
        "Connect each required outcome to the design that provides it",
        "Otherwise, use the task requirement wording as references",
        "description: If an export fails, retain the selection and show the reason.",
        "odt_set_task_artifact with code plan for task/bug allowed from open/",
      ]);
      expect(prompt).not.toContain("Reference the spec for the problem and scope");
      expect(prompt).not.toContain("Use the spec's requirement names as references");
    },
  );

  test("builder owns execution and verification within the approved design", () => {
    const prompt = buildAgentSystemPrompt({ role: "build", task: taskContext });

    expectPromptToContainAll(prompt, [
      "Choose implementation details, work order, and verification methods",
      "preserve required outcomes, architecture boundaries, and contracts",
      "Choose the simplest change that meets the current requirements",
      "Add abstractions, options, dependencies, alternate paths, and test seams only for a current requirement or shown risk",
      "Fix scope-aligned issues at the source",
      "Treat feedback from subagents, PR reviewers, and bots as proposals",
      "ask the user to choose whether to expand this task, create a separate task, or decline it",
      "Run checks required by repo guidance",
      "Review the full diff and affected paths as if the user asked what you would improve or refactor",
      "Fix any material in-scope issue you would then recommend",
      "Repeat or broaden checks only when changes, failures, or unresolved risks justify it",
      "meaningful Conventional Commit before you send build-completed",
      "call odt_apply_workflow_event with eventId build-blocked and a note with a specific reason",
      "send build-resumed",
      "use odt_set_task_artifact with code spec to revise the spec and code plan to revise the plan",
      "Save each changed artifact as complete Markdown",
      "Get user approval before changing required scope, design contracts, or security posture",
    ]);
    expect(prompt).not.toContain("Execute the plan in dependency order");
    expect(prompt).toContain("- odt_set_task_artifact(");
    expect(prompt).toContain("Allowed workflow codes for odt_set_task_artifact: spec, plan.");
    expect(prompt).toContain(
      [
        '- odt_apply_workflow_event({"taskId": string, "eventId": string, "note"?: string})',
        "- odt_set_pull_request(",
      ].join("\n"),
    );
    expect(prompt).toContain(
      [
        "- Workflow events for odt_apply_workflow_event:",
        "  - build-blocked (note required): Move the task to blocked. Put the reason in the note.",
        "  - build-resumed: Move a blocked task back to in_progress.",
        "  - build-completed: Move an in_progress task to ai_review, or to human_review when the latest QA report is approved.",
      ].join("\n"),
    );
  });

  test("QA reviews outcomes and contracts without enforcing implementation recipes", () => {
    const prompt = buildAgentSystemPrompt({ role: "qa", task: taskContext });

    expectPromptToContainAll(prompt, [
      "Inspect the implementation and its wiring directly",
      "Check whether each new abstraction, option, dependency, alternate path, or test seam serves a current requirement or shown risk",
      "Name the extra code, its cost, and a simpler viable path",
      "Do not reject on line count or style alone",
      "Choose checks based on the changed behavior and risk",
      "Do not reject valid work for a different implementation order or method",
      "material excess complexity",
      "Give its impact, the concrete correction",
      "Call odt_set_task_artifact exactly once per review pass with code qaReport, verdict approved or rejected",
      "read-only mode",
    ]);
    expectHeadingsInOrder(prompt, ["## Verdict", "## Findings", "## Verification"]);
    expect(prompt).not.toContain("Run at least two review lenses");
    expect(prompt).not.toContain("- odt_apply_workflow_event(");
  });

  test("override template always wins even with stale baseVersion", () => {
    const result = buildAgentSystemPromptBundle({
      role: "spec",
      task: taskContext,
      overrides: {
        [rolePromptKey("spec")]: {
          template: "Custom spec prompt for {{task.id}}",
          baseVersion: 999,
        },
      },
    });

    expect(result.prompt).toContain("Custom spec prompt for task-42");
    expect(result.warnings).toEqual([
      {
        type: "override_base_version_mismatch",
        key: rolePromptKey("spec"),
        builtinVersion: 8,
        overrideBaseVersion: 999,
      },
    ]);
  });

  test.each([
    ["workflow.rules", 10, 11, "build"],
    ["workflow.tool_rules", 11, 12, "build"],
    ["workflow.task_context", 5, 6, "build"],
    ["role spec", 7, 8, "spec"],
    ["role planner", 8, 9, "planner"],
    ["role build", 7, 8, "build"],
    ["role qa", 6, 7, "qa"],
    ["messages.spec_start", 5, 6, "spec"],
    ["messages.plan_start", 5, 6, "planner"],
    ["messages.build_start", 5, 6, "build"],
    ["messages.build_after_qa_rejection", 5, 6, "build"],
    ["messages.build_requested_changes", 6, 7, "build"],
    ["messages.build_pull_request", 8, 9, "build"],
    ["messages.qa_review", 4, 5, "qa"],
  ] as const)(
    "keeps prior overrides and reports the new version for %s",
    (id, previous, current, role) => {
      let custom = "Custom {{task.id}}";
      if (id === "messages.build_pull_request") {
        custom += " {{git.targetBranch}}";
      }
      if (id === "messages.build_requested_changes") {
        custom += " {{humanFeedback}}";
      }
      const key = id.startsWith("role ") ? rolePromptKey(role) : specPlanBuildPromptKey(id);
      const overrides = { [key]: { template: custom, baseVersion: previous, enabled: true } };
      const result = id.startsWith("messages.")
        ? buildAgentKickoffPromptBundle({
            role,
            // SAFETY: The startsWith check narrows this closed table to its kickoff message IDs.
            templateId: id as Parameters<typeof buildAgentKickoffPromptBundle>[0]["templateId"],
            task: taskContext,
            extraPlaceholders: { humanFeedback: "feedback" },
            git: { targetBranch: { branch: "main" } },
            overrides,
          })
        : buildAgentSystemPromptBundle({ role, task: taskContext, overrides });

      expect(result.templates.find((entry) => entry.key === key)?.source).toBe("override");
      expect(result.prompt).toContain("Custom task-42");
      expect(result.warnings).toEqual([
        {
          type: "override_base_version_mismatch",
          key,
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
          [rolePromptKey("spec")]: {
            template: "Custom {{unknown.placeholder}}",
            baseVersion: 1,
          },
        },
      }),
    ).toThrow(
      'The prompt "spec.instructions" uses unsupported placeholder "unknown.placeholder". Edit or disable this prompt override in Settings.',
    );
  });

  test("allows enabled empty override templates without runtime failure", () => {
    const result = buildAgentSystemPromptBundle({
      role: "spec",
      task: taskContext,
      overrides: {
        [specPlanBuildPromptKey("workflow.rules")]: {
          template: "",
          baseVersion: 3,
          enabled: true,
        },
      },
    });

    const workflowGuardsTemplate = result.templates.find(
      (entry) => entry.key === specPlanBuildPromptKey("workflow.rules"),
    );
    expect(workflowGuardsTemplate?.source).toBe("override");
    expect(workflowGuardsTemplate?.content).toBe("");
    expect(result.prompt).not.toContain("Workflow constraints you must obey:");
  });
});

describe("kickoff and permission prompts", () => {
  test("build kickoff requests implementation without naming a worktree", () => {
    const prompt = buildAgentKickoffPrompt({
      role: "build",
      templateId: "messages.build_start",
      task: { taskId: "task-1" },
    });

    expectPromptToContainAll(prompt, [
      "Implement this task",
      "submit the completed change with odt_apply_workflow_event with eventId build-completed",
      "taskId task-1",
    ]);
    expect(prompt).not.toContain("worktree");
    expect(prompt).not.toContain("Choose implementation details");
  });

  test("QA rework kickoff directs finding triage and resubmission", () => {
    const prompt = buildAgentKickoffPrompt({
      role: "build",
      templateId: "messages.build_after_qa_rejection",
      task: { taskId: "task-1" },
    });

    expectPromptToContainAll(prompt, [
      "latest QA rejection",
      "Check each finding against the current code",
      "Fix valid in-scope issues and explain why you decline any other finding",
      "Submit the completed change with odt_apply_workflow_event with eventId build-completed",
      "Use taskId task-1 for every task-bound odt_* tool call",
    ]);
  });

  test("human-review kickoff embeds the requested feedback into the kickoff instructions", () => {
    const prompt = buildAgentKickoffPrompt({
      role: "build",
      templateId: "messages.build_requested_changes",
      task: {
        taskId: "task-1",
      },
      extraPlaceholders: {
        humanFeedback: "Update the task summary and rerun the desktop tests.",
      },
    });

    expectPromptToContainAll(prompt, [
      "Address the requested changes for this task.",
      "Requested changes from human review:",
      "Update the task summary and rerun the desktop tests.",
      "Submit the completed change with odt_apply_workflow_event with eventId build-completed.",
      "Use taskId task-1 for every task-bound odt_* tool call.",
    ]);
  });

  test.each([
    ["spec", "messages.spec_start", "specification", "spec"],
    ["planner", "messages.plan_start", "implementation plan", "plan"],
  ] as const)(
    "%s kickoff requests the artifact and leaves policy to the system prompt",
    (role, templateId, artifact, code) => {
      const prompt = buildAgentKickoffPrompt({ role, templateId, task: { taskId: "task-1" } });

      expectPromptToContainAll(prompt, [
        `Write the ${artifact}`,
        `save it with odt_set_task_artifact and code ${code}`,
        "taskId task-1",
      ]);
      expect(prompt).not.toMatch(
        /permission|confirmation|conflicts|question tool|artifact format/i,
      );
      expect(prompt).not.toContain("{{task.id}}");
    },
  );

  test("qa kickoff requests a review and verdict", () => {
    const qaPrompt = buildAgentKickoffPrompt({
      role: "qa",
      templateId: "messages.qa_review",
      task: {
        taskId: "task-1",
      },
    });

    expectPromptToContainAll(qaPrompt, [
      "Review this task's implementation",
      "submit one QA report with exactly one odt_set_task_artifact call using code qaReport and verdict approved or rejected",
      "taskId task-1",
    ]);
  });

  test("supports kickoff override", () => {
    const result = buildAgentKickoffPromptBundle({
      role: "planner",
      templateId: "messages.plan_start",
      task: {
        taskId: "task-2",
        description: "desc",
      },
      overrides: {
        [specPlanBuildPromptKey("messages.plan_start")]: {
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
        templateId: "messages.build_requested_changes",
        task: {
          taskId: "task-2",
        },
        extraPlaceholders: {
          humanFeedback: "Tighten the validation copy.",
        },
        overrides: {
          [specPlanBuildPromptKey("messages.build_requested_changes")]: {
            template: "Review {{task.id}} before editing.",
            baseVersion: 3,
            enabled: true,
          },
        },
      }),
    ).toThrow(
      'The prompt "messages.build_requested_changes" is missing required placeholder "humanFeedback". Edit or disable this prompt override in Settings.',
    );
  });

  test("rejects empty human-feedback placeholder values", () => {
    expect(() =>
      buildAgentKickoffPrompt({
        role: "build",
        templateId: "messages.build_requested_changes",
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
      templateId: "messages.build_pull_request",
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
      "For a new pull request, use the repository's template and fill each relevant section.",
      "For an existing pull request, read its title and body. Preserve useful context, links, media, and edits from other authors.",
      "Push the source branch, create or update the pull request against the base branch, and confirm the published title and body follow repository conventions.",
      "After the pull request exists, call odt_set_pull_request with taskId task-1 and the pull request number.",
      "If any fail, diagnose and fix the root cause, rerun the affected local checks, commit and push the fix, then check again until all required checks pass.",
      "Completion criterion: the task references the pull request and every required pull request check passes.",
      "Report the pull request URL and the passed local and pull request checks.",
    ]);
    expect(prompt).not.toContain("Builder session");
    expect(prompt).not.toContain("comparison");
    expect(prompt).not.toContain("origin/release/2026.04");
    expect(prompt).not.toContain("target");
    expect(result.templates[0]?.builtinVersion).toBe(9);
  });

  test("rejects pull request generation kickoff when target branch context is missing", () => {
    expect(() =>
      buildAgentKickoffPrompt({
        role: "build",
        templateId: "messages.build_pull_request",
        task: {
          taskId: "task-1",
        },
      }),
    ).toThrow('Missing required git context for "messages.build_pull_request": targetBranch.');
  });

  test("rejects an upstream-relative pull request target", () => {
    expect(() =>
      buildAgentKickoffPrompt({
        role: "build",
        templateId: "messages.build_pull_request",
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
      templateId: "messages.plan_start",
      task: {
        taskId: "task-2",
      },
      overrides: {
        [specPlanBuildPromptKey("messages.plan_start")]: {
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
      templateId: "messages.plan_start",
      task: {
        taskId: "task-2",
      },
      overrides: {
        [specPlanBuildPromptKey("messages.plan_start")]: {
          template: "Disabled custom kickoff",
          baseVersion: 2,
          enabled: false,
        },
      },
    });

    expect(prompt).toBe(
      buildAgentKickoffPrompt({
        role: "planner",
        templateId: "messages.plan_start",
        task: { taskId: "task-2" },
      }),
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
      templateId: "messages.build_git_conflict",
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
      "Use taskId task-1 for any task-bound odt_* tool calls.",
    ]);
    expect(prompt).not.toContain("CONFLICT (content)");
  });

  test("omits raw git output while retaining conflict metadata", () => {
    const buildPrompt = (conflictOutput: string) =>
      buildAgentMessagePrompt({
        role: "build",
        templateId: "messages.build_git_conflict",
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
      templateId: "messages.build_git_conflict",
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
        [specPlanBuildPromptKey("messages.build_git_conflict")]: {
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
        key: specPlanBuildPromptKey("messages.build_git_conflict"),
        builtinVersion: 5,
        overrideBaseVersion: 2,
      },
    ]);
  });

  test("rejects git conflict resolution message when required git context is missing", () => {
    expect(() =>
      buildAgentMessagePrompt({
        role: "build",
        templateId: "messages.build_git_conflict",
        task: {
          taskId: "task-1",
        },
        git: {
          targetBranch: "origin/main",
          conflictedFiles: ["src/main.ts"],
        },
      }),
    ).toThrow(
      'Missing required git conflict context for "messages.build_git_conflict": operationLabel.',
    );
  });

  test("rejects git placeholders when the selected template does not receive git context", () => {
    expect(() =>
      buildAgentKickoffPrompt({
        role: "planner",
        templateId: "messages.plan_start",
        task: {
          taskId: "task-2",
        },
        overrides: {
          [specPlanBuildPromptKey("messages.plan_start")]: {
            template: "Planner kickoff {{git.conflictOutput}}",
            baseVersion: 2,
            enabled: true,
          },
        },
      }),
    ).toThrow(
      'The prompt "messages.plan_start" is missing placeholder value "git.conflictOutput".',
    );
  });
});

describe("listSpecPlanBuildPromptTemplates", () => {
  test("returns definitions for role, kickoff, message, and permission prompts", () => {
    const definitions = listSpecPlanBuildPromptTemplates();
    const keys = definitions.map((entry) => entry.key);

    expect(keys).toContain(rolePromptKey("spec"));
    expect(keys).toContain(rolePromptKey("build"));
    expect(keys).toContain(specPlanBuildPromptKey("messages.spec_start"));
    expect(keys).toContain(specPlanBuildPromptKey("messages.build_git_conflict"));
    expect(keys).toContain(specPlanBuildPromptKey("workflow.read_only_rejection"));
  });
});

describe("mergePromptOverrides", () => {
  test("resolves repo overrides over global overrides", () => {
    const merged = mergePromptOverrides({
      globalOverrides: {
        [specPlanBuildPromptKey("messages.spec_start")]: {
          template: "global",
          baseVersion: 1,
          enabled: true,
        },
      },
      repoOverrides: {
        [specPlanBuildPromptKey("messages.spec_start")]: {
          template: "repo",
          baseVersion: 1,
          enabled: true,
        },
      },
    });

    expect(merged[specPlanBuildPromptKey("messages.spec_start")]?.template).toBe("repo");
  });

  test("falls back to global override when repo override is disabled", () => {
    const merged = mergePromptOverrides({
      globalOverrides: {
        [specPlanBuildPromptKey("messages.spec_start")]: {
          template: "global",
          baseVersion: 1,
          enabled: true,
        },
      },
      repoOverrides: {
        [specPlanBuildPromptKey("messages.spec_start")]: {
          template: "repo-disabled",
          baseVersion: 1,
          enabled: false,
        },
      },
    });

    expect(merged[specPlanBuildPromptKey("messages.spec_start")]?.template).toBe("global");
  });
});

describe("prompts.findOverrideProblem", () => {
  test("names the first enabled override that an earlier version saved with a removed placeholder", () => {
    const template = "QA required: {{task.qaRequired}}";
    expect(
      findPromptOverrideProblem({
        [specPlanBuildPromptKey("workflow.task_context")]: { template, baseVersion: 1 },
      }),
    ).toBe(
      'The prompt "workflow.task_context" uses unsupported placeholder "task.qaRequired". Edit or disable this prompt override in Settings.',
    );
    expect(
      findPromptOverrideProblem({
        [specPlanBuildPromptKey("workflow.task_context")]: {
          template,
          baseVersion: 1,
          enabled: false,
        },
      }),
    ).toBeUndefined();
    expect(findPromptOverrideProblem(undefined)).toBeUndefined();
  });
});
