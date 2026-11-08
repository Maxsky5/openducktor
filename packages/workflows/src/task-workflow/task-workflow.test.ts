import { describe, expect, test } from "bun:test";
import { promptOverrideKey, type WorkflowDefinition } from "@openducktor/contracts";
import {
  createReviewTaskWorkflow,
  reviewTaskDefinition,
  reviewTaskPromptTemplates,
  reviewTaskRoles,
} from "../../test-support/review-task-workflow";
import { BUILTIN_ROLES } from "../builtin/roles/roles";
import { SPEC_PLAN_BUILD_DEFINITION } from "../builtin/spec-plan-build/definition";
import { specPlanBuildWorkflow } from "../builtin/spec-plan-build/workflow";
import type { TaskFacts } from "./task-input";
import { launchGoalObjective } from "./launch-goal";
import { createTaskWorkflow } from "./task-workflow";

const review = createReviewTaskWorkflow();

const reviewTask = (overrides: Partial<TaskFacts> = {}): TaskFacts => ({
  id: "task-1",
  status: "open",
  issueType: "feature",
  artifactSummary: review.emptyArtifactSummary(),
  ...overrides,
});

const withChange = (change: (definition: WorkflowDefinition) => void) => {
  const definition = reviewTaskDefinition();
  change(definition);
  return () => createTaskWorkflow(definition, reviewTaskPromptTemplates, reviewTaskRoles);
};

describe("createTaskWorkflow", () => {
  test("declares Goal mode only for the implementation and rework launches", () => {
    const task = { id: "task-7", title: "Add goals" };
    const goals = Object.fromEntries(
      SPEC_PLAN_BUILD_DEFINITION.steps.flatMap((step) =>
        step.kind === "agent"
          ? step.launchActions.flatMap((launch) => {
              const objective = launchGoalObjective(launch, task, "Rename the button.");
              return objective === undefined ? [] : [[launch.id, objective]];
            })
          : [],
      ),
    );
    expect(goals).toEqual({
      build_implementation_start: [
        'Implement task task-7 "Add goals" as its description, spec, and implementation plan define.',
        "",
        "The goal is met when all of these are true:",
        "- Each requirement and acceptance criterion of the task works in the code.",
        "- Every check that the repository instructions require passes.",
        "- odt_apply_workflow_event with eventId build-completed succeeded.",
        "",
        "Use taskId task-7 for every task-bound odt_* tool call. Change only what the task needs. Stop and ask the user when the task conflicts with the code, or a check fails for a cause outside the task.",
      ].join("\n"),
      build_after_qa_rejected: expect.stringContaining(
        'Resolve the latest QA rejection of task task-7 "Add goals".',
      ),
      build_after_human_request_changes: expect.stringContaining(
        'Apply the changes that human review requested for task task-7 "Add goals":\n\nRename the button.\n\nThe goal is met',
      ),
    });
  });

  test("rejects a default goal with a placeholder other than the task ID and title", () => {
    const create = withChange((definition) => {
      const step = definition.steps.find((candidate) => candidate.kind === "agent");
      if (step?.kind !== "agent") throw new Error("The review workflow has no agent step.");
      step.launchActions[0] = {
        ...step.launchActions[0]!,
        goal: { defaultObjective: "Finish {{task.description}}" },
      };
    });
    expect(create).toThrow('uses placeholder "task.description"');
  });

  test("accepts {{humanFeedback}} in a default goal only for a launch that collects feedback", () => {
    const withFeedbackGoal = (context: "human_feedback" | undefined) =>
      withChange((definition) => {
        const step = definition.steps.find((candidate) => candidate.kind === "agent");
        if (step?.kind !== "agent") throw new Error("The review workflow has no agent step.");
        step.launchActions[0] = {
          ...step.launchActions[0]!,
          context,
          goal: { defaultObjective: "Apply {{humanFeedback}}" },
        };
      });
    expect(withFeedbackGoal(undefined)).toThrow('uses placeholder "humanFeedback"');
    expect(withFeedbackGoal("human_feedback")).not.toThrow();
  });

  test("reads states, roles, artifacts, and issue types from the definition", () => {
    expect(review.issueTypes).toEqual(["feature", "bug"]);
    expect(review.detectsMerge("approval")).toBe(true);
    expect(review.detectsMerge("reviewing")).toBe(false);
    expect(review.worktreeRoles).toEqual(["writer"]);
    expect(review.reviewArtifactCodes).toEqual(["review"]);
    expect(review.artifactSubmitEvent("review", "revise")).toBe("revise-review");
    expect(review.artifactSubmitEvent("draft", undefined)).toBe("submit-draft");
    expect(review.artifact("notes")).toBeUndefined();
    expect(() => review.role("build")).toThrow('Task workflow "review" has no role "build".');
  });

  test("reads the host effects of each event from the definition", () => {
    expect(review.eventEffects("drop-review")).toEqual(["worktree.reset"]);
    expect(review.eventEffects("request-rewrite")).toEqual([]);
    expect(review.eventEffects("finish-writing")).toEqual([]);
    expect(specPlanBuildWorkflow.eventEffects("reset-implementation")).toEqual(["worktree.reset"]);
    expect(specPlanBuildWorkflow.eventEffects("human-request-changes")).toEqual([]);
  });

  test("evaluates the approval action of the workflow", () => {
    expect(review.approvalAction?.id).toBe("approve");
    expect(review.approvalAvailable(reviewTask({ status: "approval" }))).toBe(true);
    expect(review.approvalAvailable(reviewTask({ status: "reviewing" }))).toBe(false);
    const withoutApproval = withChange((definition) => {
      definition.actions = definition.actions.filter(({ kind }) => kind !== "approval");
      definition.actionOrder = [{ when: true, actions: ["start_write", "request_review"] }];
    })();
    expect(withoutApproval.approvalAction).toBeUndefined();
    expect(withoutApproval.approvalAvailable(reviewTask({ status: "approval" }))).toBe(false);
    expect(
      withChange((definition) => {
        definition.actions.push({
          id: "approve_again",
          kind: "approval",
          label: "Approve again",
          availableWhen: true,
        });
      }),
    ).toThrow(
      "The approval actions at actions[2] and actions[6] open the same approval. Keep one approval action.",
    );
  });

  test("decides events with their signal, source role, and guard recovery", () => {
    const drafted = reviewTask({
      status: "writing",
      artifactSummary: { ...review.emptyArtifactSummary(), draft: { present: true } },
    });

    expect(review.decide("finish-writing", drafted)).toEqual({
      kind: "transition",
      from: "writing",
      to: "reviewing",
      cause: { signal: "draftSubmitted", sourceRole: "writer" },
    });
    expect(review.decide("finish-writing", reviewTask({ status: "writing" }))).toEqual({
      kind: "denied",
      status: "writing",
      allowedStatuses: [],
      guardMessage: "Save the draft first",
    });
    expect(review.decide("submit-draft", reviewTask({ status: "closed" }))).toEqual({
      kind: "denied",
      status: "closed",
      allowedStatuses: ["open", "writing", "paused", "reviewing", "approval"],
    });
    expect(review.decide("start-writing", reviewTask({ status: "writing" }))).toEqual({
      kind: "unchanged",
      status: "writing",
    });
  });

  test("selects the launch after an event in the state that the event gives", () => {
    const definition = reviewTaskDefinition();
    const write = definition.steps.find((step) => step.id === "write")!;
    if (write.kind !== "agent") throw new Error("Expected the write step.");
    write.launchActions[0]!.selectWhen = { stateIn: ["writing"] };
    const workflow = createTaskWorkflow(definition, reviewTaskPromptTemplates, reviewTaskRoles);
    const candidates = ["write_revise", "write_start"];

    expect(
      workflow.launchAfterEvent("request-rewrite", reviewTask({ status: "approval" }), candidates),
    ).toBe("write_start");
    expect(() =>
      workflow.launchAfterEvent("request-rewrite", reviewTask({ status: "writing" }), candidates),
    ).toThrow("unavailable");
  });

  test("assesses a step against the task as the event leaves it", () => {
    const definition = reviewTaskDefinition();
    const write = definition.steps.find((step) => step.id === "write")!;
    write.availableWhen = { stateIn: ["open", "writing", "paused"] };
    const workflow = createTaskWorkflow(definition, reviewTaskPromptTemplates, reviewTaskRoles);
    const writerAvailable = (task: TaskFacts) =>
      workflow.project(task).agentWorkflows.writer!.available;
    const approval = reviewTask({ status: "approval" });
    const reviewing = reviewTask({ status: "reviewing" });

    expect(writerAvailable(approval)).toBe(false);
    expect(workflow.taskAfterEvent("request-rewrite", approval)).toEqual({
      ...approval,
      status: "writing",
    });
    expect(writerAvailable(workflow.taskAfterEvent("request-rewrite", approval))).toBe(true);
    expect(writerAvailable(workflow.taskAfterEvent("accept-review", reviewing))).toBe(false);
    expect(() => workflow.taskAfterEvent("request-rewrite", reviewing)).toThrow(
      'Event "request-rewrite" is unavailable in state "reviewing". Reload the task.',
    );
  });

  test("projects role states and actions from the definition", () => {
    const projection = review.project(reviewTask({ status: "reviewing" }));

    expect(Object.keys(projection.agentWorkflows)).toEqual(["writer", "editor"]);
    expect(projection.agentWorkflows.editor).toEqual({
      required: true,
      canSkip: false,
      available: true,
      completed: false,
    });
    expect(projection.availableActions).toEqual(["request_review", "drop_review"]);
  });

  test("resolves launch actions, automations, and continuations with their roles", () => {
    expect(review.launchAction("write_revise").role).toBe("writer");
    expect(review.automation("startEditor")).toMatchObject({
      launchActionId: "edit_review",
      roles: ["editor"],
    });
    expect(review.roleStartEvent("writer")).toBe("start-writing");
    expect(review.roleStartEvent("editor")).toBeUndefined();
  });

  test("lets every role create the pull request when the workflow names no pull request role", () => {
    expect(review.pullRequestRoles).toEqual([]);
    expect(review.createsPullRequest("writer")).toBe(true);
    expect(review.createsPullRequest("editor")).toBe(true);
    expect(review.createsPullRequest("missing")).toBe(false);
    expect(review.launchAction("pull_request", "editor")).toMatchObject({
      id: "pull_request",
      role: "editor",
      startModes: ["reuse", "fork"],
      defaultStartMode: "reuse",
      template: { kind: "kickoff", id: "messages.pull_request" },
      targetBranch: true,
      requiresWorktree: true,
    });
    expect(() => review.launchAction("pull_request")).toThrow("needs the role of its session");
    expect(review.prompts.templateRoles("messages.pull_request")).toEqual(["writer", "editor"]);
  });

  test("limits the pull request launch to the declared pull request roles", () => {
    const workflow = withChange((definition) => {
      definition.pullRequestRoles = ["writer"];
    })();
    expect(workflow.createsPullRequest("writer")).toBe(true);
    expect(workflow.createsPullRequest("editor")).toBe(false);
    expect(() => workflow.launchAction("pull_request", "editor")).toThrow(
      'Role "editor" cannot create pull requests',
    );
    expect(workflow.prompts.templateRoles("messages.pull_request")).toEqual(["writer"]);
    const prompt = workflow.prompts.kickoffPrompt({
      launchActionId: "pull_request",
      role: "writer",
      task: { taskId: "task-1" },
      targetBranch: { remote: "origin", branch: "main" },
    }).prompt;
    expect(prompt).toBe("Publish the pull request of task-1 against main.");
  });

  test("gives a pull request automation every pull request role as a candidate", () => {
    const automate = (pullRequestRoles: string[]) =>
      withChange((definition) => {
        definition.pullRequestRoles = pullRequestRoles;
        definition.automations[0]!.launchActionId = "pull_request";
        delete definition.automations[0]!.startMode;
      })().automation("startEditor");
    expect(automate([])).toMatchObject({ roles: ["writer", "editor"], startMode: "reuse" });
    expect(automate(["editor", "writer"]).roles).toEqual(["writer", "editor"]);
    expect(automate(["editor"]).roles).toEqual(["editor"]);
  });

  test("offers the pull request launch only while the task approval is available", () => {
    expect(review.pullRequestLaunchAvailable(reviewTask({ status: "approval" }))).toBe(true);
    expect(review.pullRequestLaunchAvailable(reviewTask({ status: "open" }))).toBe(false);
    expect(review.pullRequestLaunchAvailable(reviewTask({ status: "closed" }))).toBe(false);
  });

  test("requires the pull request prompt in every workflow", () => {
    expect(() =>
      createTaskWorkflow(
        reviewTaskDefinition(),
        reviewTaskPromptTemplates.filter(({ id }) => id !== "messages.pull_request"),
        reviewTaskRoles,
      ),
    ).toThrow('has no prompt template "messages.pull_request" for launch action "pull_request"');
  });

  test("reads state notifications and their default settings", () => {
    expect(review.stateNotification("reviewing")).toEqual({
      kind: "workflow.reviewing",
      status: "Task moved to Reviewing.",
      title: "Ready for review",
      body: "Review the draft.",
      preferredRole: "editor",
      navigation: { type: "agent_studio_task", preferredRole: "editor" },
    });
    expect(review.stateNotification("closed", "writer")).toEqual({
      kind: "workflow.published",
      status: "Task moved to Published.",
      title: "Published",
      body: "The task is published.",
      preferredRole: "writer",
      navigation: { type: "kanban_task" },
    });
    expect(review.stateNotification("open")).toBeUndefined();
    expect(review.notificationDefaults()).toEqual({
      "workflow.reviewing": { enabled: true, target: "both", sound: "inherit" },
      "workflow.published": { enabled: true, target: "in_app", sound: "none" },
    });
  });

  test("builds prompts from the templates and role tools of the workflow", () => {
    const workflowKey = (promptId: string) =>
      promptOverrideKey({ ownerKind: "workflow", ownerId: "review", promptId });
    const kickoffKey = workflowKey("messages.edit_review");
    const system = review.prompts.systemPrompt({
      role: "editor",
      task: { taskId: "task-1", title: "Essay", issueType: "feature", status: "reviewing" },
    }).prompt;

    expect(system).toContain("You review task task-1 as editor.");
    expect(system).toContain('- odt_read_task({"taskId": string})');
    expect(system).toContain("Allowed workflow codes for odt_set_task_artifact: review.");
    expect(system).toContain("Task task-1: Essay (feature, reviewing)");
    expect(
      review.prompts.kickoffPrompt({ launchActionId: "edit_review", task: { taskId: "task-1" } })
        .prompt,
    ).toBe("Review the draft of task-1.");
    expect(review.prompts.readOnlyRejection({ role: "editor" })).toBe(
      "The editor cannot change files.",
    );
    expect(
      review.prompts.mergeOverrides({
        globalOverrides: { [kickoffKey]: { template: "Global", baseVersion: 1 } },
        repoOverrides: {
          [workflowKey("messages.unknown")]: { template: "Ignored", baseVersion: 1 },
        },
      }),
    ).toEqual({ [kickoffKey]: { template: "Global", baseVersion: 1 } });
  });

  test("lists the agent events of each role and lists them in the role prompt", () => {
    expect(review.agentEvents("writer")).toEqual([
      { id: "finish-writing", description: "Submit the draft for review.", note: "optional" },
      { id: "pause-writing", description: "Pause the writing.", note: "required" },
      { id: "resume-writing", description: "Resume the writing.", note: "optional" },
    ]);
    expect(review.agentEvents("editor")).toEqual([]);
    expect(review.agentEvent("pause-writing")).toEqual({
      id: "pause-writing",
      description: "Pause the writing.",
      note: "required",
      roles: ["writer"],
    });
    expect(review.agentEvent("approve-copy")).toBeUndefined();
    expect(specPlanBuildWorkflow.agentEvents("build").map(({ id }) => id)).toEqual([
      "build-blocked",
      "build-resumed",
      "build-completed",
    ]);
    expect(specPlanBuildWorkflow.agentEvents("qa")).toEqual([]);

    const writerPrompt = review.prompts.systemPrompt({
      role: "writer",
      task: { taskId: "task-1" },
    }).prompt;
    expect(writerPrompt).toContain(
      [
        "- Workflow events for odt_apply_workflow_event:",
        "  - finish-writing: Submit the draft for review.",
        "  - pause-writing (note required): Pause the writing.",
        "  - resume-writing: Resume the writing.",
      ].join("\n"),
    );
    expect(
      review.prompts.systemPrompt({ role: "editor", task: { taskId: "task-1" } }).prompt,
    ).not.toContain("Workflow events for odt_apply_workflow_event");
  });

  test("rejects host effects on an event that an artifact save or a step start sends", () => {
    const withEffects = (eventId: string) =>
      withChange((definition) => {
        const event = definition.events.find(({ id }) => id === eventId);
        if (!event) throw new Error(`Missing event ${eventId}.`);
        event.effects = ["worktree.reset"];
      });
    expect(withEffects("submit-draft")).toThrow(
      'Workflow "review" is invalid. Event "submit-draft" is sent by the draft artifact save, so it cannot declare host effects. Move the effect to a task action event.',
    );
    expect(withEffects("revise-review")).toThrow(
      'Event "revise-review" is sent by the review artifact save with verdict "revise", so it cannot declare host effects. Move the effect to a task action event.',
    );
    expect(withEffects("start-writing")).toThrow(
      'Event "start-writing" is sent by the start of the writer step, so it cannot declare host effects. Move the effect to a task action event.',
    );
    expect(withEffects("request-rewrite")).not.toThrow();
  });

  test("compiles the built-in Spec, Plan, Build workflow with its host effects", () => {
    expect(() =>
      createTaskWorkflow(
        specPlanBuildWorkflow.definition,
        specPlanBuildWorkflow.workflowTemplates,
        BUILTIN_ROLES,
      ),
    ).not.toThrow();
    expect(specPlanBuildWorkflow.eventEffects("reset-implementation")).toEqual(["worktree.reset"]);
  });

  test("rejects an agent event that an agent cannot send", () => {
    const agent = { roles: ["writer"], note: "optional" as const, description: "Send it." };
    expect(
      withChange((definition) => {
        const event = definition.events.find(({ id }) => id === "drop-review");
        if (event) event.agent = agent;
      }),
    ).toThrow(
      "The agent event at events[9] has host effects, and agents cannot send an event with host effects. Remove events[9].effects or events[9].agent.",
    );
    expect(
      withChange((definition) => {
        const event = definition.events.find(({ id }) => id === "pause-writing");
        if (event) event.effects = ["worktree.reset"];
      }),
    ).toThrow("The agent event at events[6] has host effects");
    expect(
      withChange((definition) => {
        const event = definition.events.find(({ id }) => id === "accept-review");
        if (event) event.agent = { ...agent, roles: ["author"] };
      }),
    ).toThrow('Unknown roles ID "author" at events[');
    expect(
      withChange((definition) => {
        const event = definition.events.find(({ id }) => id === "accept-review");
        if (event) event.agent = { ...agent, roles: ["editor"] };
      }),
    ).toThrow(
      'Task workflow "review" lets role "editor" send events accept-review, but the role has no odt_apply_workflow_event tool. Add the tool to the role, or remove the role from these events.',
    );
  });

  test("supports a subset of the fixed issue types", () => {
    const bugOnly = withChange((definition) => {
      definition.issueTypes = [{ id: "bug", label: "Fix" }];
    })();

    expect(bugOnly.issueTypes).toEqual(["bug"]);
  });

  test("rejects a definition that a task workflow cannot run", () => {
    expect(
      withChange((definition) => {
        definition.issueTypes = [];
      }),
    ).toThrow(
      'Task workflow "review" must support at least one issue type (task, feature, bug) and declare no facts.',
    );
    expect(
      withChange((definition) => {
        definition.facts.push({ id: "priority", type: "enum", values: ["high", "low"] });
      }),
    ).toThrow(
      'Task workflow "review" must support at least one issue type (task, feature, bug) and declare no facts.',
    );
    expect(
      withChange((definition) => {
        const edit = definition.steps.find(({ id }) => id === "edit");
        if (edit?.kind === "agent") edit.roleId = "writer";
      }),
    ).toThrow("gives a role two agent steps");
    expect(() =>
      createTaskWorkflow(
        reviewTaskDefinition(),
        reviewTaskPromptTemplates.filter(({ id }) => id !== "messages.write_revise"),
        reviewTaskRoles,
      ),
    ).toThrow(
      'Task workflow "review" has no prompt template "messages.write_revise" for launch action "write_revise".',
    );
    expect(() =>
      createTaskWorkflow(
        reviewTaskDefinition(),
        reviewTaskPromptTemplates.filter(({ id }) => id !== "workflow.tool_rules"),
        reviewTaskRoles,
      ),
    ).toThrow(
      'Task workflow "review" has no prompt template "workflow.tool_rules" for the system prompt.',
    );
    expect(() =>
      createTaskWorkflow(
        reviewTaskDefinition(),
        reviewTaskPromptTemplates.filter(({ id }) => id !== "workflow.read_only_rejection"),
        reviewTaskRoles,
      ),
    ).toThrow(
      'Task workflow "review" has no prompt template "workflow.read_only_rejection" for read-only rejections.',
    );
    expect(() =>
      createTaskWorkflow(
        reviewTaskDefinition(),
        [
          ...reviewTaskPromptTemplates,
          { id: "kickoff.extra", purpose: "kickoff", builtinVersion: 1, template: "Extra" },
        ],
        reviewTaskRoles,
      ),
    ).toThrow(
      'Prompt "kickoff.extra" of task workflow "review" is neither a base workflow prompt nor in the "messages." group. Rename it.',
    );
  });
});
