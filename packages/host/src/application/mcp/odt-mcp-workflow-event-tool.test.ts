import { describe, expect, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { Cause, Effect, Exit } from "effect";
import type { RuntimeSessionOwner } from "../../ports/workspace-session-store-port";
import { createTaskWorkflow } from "@openducktor/workflows";
import {
  reviewTaskDefinition,
  reviewTaskPromptTemplates,
  reviewTaskRoles,
} from "@openducktor/workflows/test-support";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";
import { builtinTaskWorkflows, singleTaskWorkflow } from "../../test-support/task-workflows";
import {
  createBuildSettingsConfig,
  createBuildStartGitPort,
  createBuildSystemCommands,
  createBuildWorkspaceSettingsService,
  createTaskService,
  task,
} from "../tasks/test-support/task-workflow-harness";
import { createOdtMcpBridgeService } from "./odt-mcp-bridge-service";

const caller = { runtime: "codex", runtimeSessionId: "native-child" } as const;
const owner = (role: string, taskId = "task-1"): RuntimeSessionOwner => ({
  kind: "task",
  taskId,
  role,
  runtimeKind: "codex",
  externalSessionId: "native-root",
});

/** A bridge over a real task service. `transitions` records each store write. */
const setup = (
  status: TaskCard["status"],
  options: {
    owner?: RuntimeSessionOwner;
    postComplete?: string[];
    taskWorkflows?: TaskWorkflowResolver;
    issueType?: TaskCard["issueType"];
  } = {},
) => {
  const taskWorkflows = options.taskWorkflows ?? builtinTaskWorkflows;
  let current = task({
    status,
    issueType: options.issueType ?? "task",
    artifactSummary: taskWorkflows.forNewTask("/repo").emptyArtifactSummary(),
  });
  const transitions: unknown[] = [];
  const commands: unknown[] = [];
  const workspaceSettingsService = createBuildWorkspaceSettingsService({
    workspaceId: "repo",
    repoPath: "/repo",
    hooks: { postComplete: options.postComplete ?? [] },
  });
  const taskService = createTaskService({
    taskWorkflows,
    gitPort: createBuildStartGitPort({ calls: [] }),
    settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
    systemCommands: createBuildSystemCommands(commands),
    workspaceSettingsService,
    taskStore: {
      getTask: () => Effect.succeed(current),
      findTask: () => Effect.succeed(current),
      listTasks: () => Effect.succeed([current]),
      transitionTask: (input) => {
        transitions.push(input);
        current = { ...current, status: input.status };
        return Effect.succeed(current);
      },
    },
  });
  const bridge = createOdtMcpBridgeService({
    taskWorkflows,
    browserAgentTools: { runAgentTool: () => Effect.die("Unexpected browser call") },
    browserCallers: { resolve: () => Effect.die("Unexpected browser caller") },
    managedCallers: {
      resolve: () =>
        options.owner === undefined
          ? Effect.die("Unexpected managed caller")
          : Effect.succeed(options.owner),
    },
    taskAssetReadService: { readBatch: () => Effect.die("Unexpected task asset read") },
    taskService,
    workspaceSettingsService,
  });
  return {
    transitions,
    commands,
    send: (input: { eventId: string; note?: string; caller?: typeof caller }) =>
      Effect.runPromiseExit(
        bridge.invoke("odt_apply_workflow_event", {
          workspaceId: "repo",
          taskId: "task-1",
          ...input,
        }),
      ),
  };
};

const failureOf = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) throw new Error("Expected the call to fail.");
  return Cause.squash(exit.cause);
};

describe("odt_apply_workflow_event", () => {
  test("a Builder session sends build-blocked and gets its note back", async () => {
    const bridge = setup("in_progress", { owner: owner("build") });

    const exit = await bridge.send({ eventId: "build-blocked", note: " Waiting on API ", caller });

    expect(exit).toEqual(
      Exit.succeed({
        task: expect.objectContaining({ id: "task-1", status: "blocked" }),
        eventId: "build-blocked",
        note: "Waiting on API",
      }),
    );
    expect(bridge.transitions).toMatchObject([{ taskId: "task-1", status: "blocked" }]);
  });

  test("a client without a caller can send every agent event", async () => {
    const bridge = setup("blocked");

    const exit = await bridge.send({ eventId: "build-resumed" });

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(bridge.transitions).toMatchObject([{ status: "in_progress" }]);
  });

  test("a session of another role cannot send the event", async () => {
    const bridge = setup("in_progress", { owner: owner("qa") });

    const failure = failureOf(await bridge.send({ eventId: "build-completed", caller }));

    expect(failure).toMatchObject({
      _tag: "TaskPolicyError",
      code: "TASK_POLICY_ERROR",
      message: "The qa role cannot send build-completed. The role has no workflow events.",
    });
    expect(bridge.transitions).toEqual([]);
  });

  test("a task session cannot send events for another task", async () => {
    const bridge = setup("in_progress", { owner: owner("build", "task-2") });

    const failure = failureOf(await bridge.send({ eventId: "build-completed", caller }));

    expect(failure).toMatchObject({
      message: "Managed task sessions can send workflow events only for their own task.",
    });
    expect(bridge.transitions).toEqual([]);
  });

  test("build-blocked requires a note", async () => {
    const bridge = setup("in_progress", { owner: owner("build") });

    const failure = failureOf(await bridge.send({ eventId: "build-blocked", caller }));

    expect(failure).toMatchObject({
      message: "build-blocked requires a note. Say why you send the event.",
    });
    expect(bridge.transitions).toEqual([]);
  });

  test.each(["start-builder", "missing"])("rejects %s, which agents cannot send", async (id) => {
    const bridge = setup("in_progress");

    const failure = failureOf(await bridge.send({ eventId: id }));

    expect(failure).toMatchObject({
      code: "TASK_POLICY_ERROR",
      message: `Task workflow "openducktor-research-plan-implement" has no agent event ${id}. Use an event that your role instructions list.`,
    });
    expect(bridge.transitions).toEqual([]);
  });

  test("an event without a host effect moves the task through its workflow", async () => {
    const definition = reviewTaskDefinition();
    const accept = definition.events.find(({ id }) => id === "accept-review");
    if (accept) {
      accept.agent = { roles: ["writer"], note: "optional", description: "Accept the review." };
    }
    const bridge = setup("reviewing", {
      owner: owner("writer"),
      issueType: "feature",
      taskWorkflows: singleTaskWorkflow(
        createTaskWorkflow(definition, reviewTaskPromptTemplates, reviewTaskRoles),
      ),
    });

    const exit = await bridge.send({ eventId: "accept-review", caller });

    expect(exit).toEqual(
      Exit.succeed({
        task: expect.objectContaining({ status: "approval" }),
        eventId: "accept-review",
      }),
    );
    expect(bridge.transitions).toMatchObject([
      { status: "approval", cause: { signal: "reviewAccepted", sourceRole: "editor" } },
    ]);
  });

  test("build-completed runs the post-complete hook before the transition", async () => {
    const bridge = setup("in_progress", {
      owner: owner("build"),
      postComplete: ["bun run cleanup"],
    });

    const exit = await bridge.send({ eventId: "build-completed", note: "Done", caller });

    expect(exit).toEqual(
      Exit.succeed({
        task: expect.objectContaining({ status: "ai_review" }),
        eventId: "build-completed",
        note: "Done",
      }),
    );
    expect(bridge.commands).toMatchObject([
      { options: expect.objectContaining({ cwd: "/worktrees/repo/task-1" }) },
    ]);
    expect(bridge.transitions).toMatchObject([
      { status: "ai_review", cause: { signal: "taskProgressedToAiReview" } },
    ]);
  });
});
