import { describe, expect, mock, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import {
  projectClaudeBackgroundTasks,
  publishClaudeBackgroundTasks,
} from "./claude-agent-sdk-background-task-list";
import { stopClaudeBackgroundTask } from "./claude-agent-sdk-background-task-stop";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import {
  createClaudeQueryFixture,
  createClaudeSession,
} from "./claude-agent-sdk-session-io.test-support";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";
import type { ClaudeBackgroundTasksEvent } from "./claude-agent-sdk-types";

type ListedTask = {
  task_id: string;
  task_type: string;
  description: string;
  subagent_type?: string;
  parent_task_id?: string;
  ambient?: boolean;
  run_id?: string;
};

const ROOT = "session-1";
const subagentSessionId = (agentId: string) => `${ROOT}::claude-subagent::${agentId}`;
/** The handle of the first run of a native task, as the message fixtures number runs. */
const handle = (nativeTaskId: string) => `${nativeTaskId}:run:${nativeTaskId}`;

const setup = () => {
  const stopTask = mock(async (_taskId: string) => {});
  const session = createClaudeSession({ query: createClaudeQueryFixture({ stopTask }) });
  const events: AgentEvent[] = [];
  let ordinal = 0;
  const send = (message: Parameters<typeof claudeSdkMessageFixture>[0]) =>
    handleClaudeSdkMessage({
      session,
      emit: (event) => events.push(event),
      modelSelection: (modelId) => ({ providerId: "claude", runtimeKind: "claude", modelId }),
      timestamp: `2026-11-21T10:00:${String(ordinal++).padStart(2, "0")}.000Z`,
      message: claudeSdkMessageFixture(message),
    });
  const membership = (tasks: ListedTask[]) =>
    send({ type: "system", subtype: "background_tasks_changed", tasks });
  /** Claude calls Bash in the background, as the transcript shows the call. */
  const callBackgroundBash = (toolUseId: string, command: string) =>
    send({
      type: "assistant",
      session_id: ROOT,
      message: {
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [
          {
            type: "tool_use",
            id: toolUseId,
            name: "Bash",
            input: { command, description: "Run the command", run_in_background: true },
          },
        ],
        stop_reason: "tool_use",
      },
    });
  const stopEffect = (externalSessionId: string, taskId: string) =>
    stopClaudeBackgroundTask(
      { get: (id) => (id === ROOT ? session : undefined) },
      {
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo",
        externalSessionId,
        taskId,
      },
    );
  const stop = (externalSessionId: string, taskId: string) =>
    Effect.runPromise(stopEffect(externalSessionId, taskId));
  /** Claude names a launched subagent `agent-1` and its native task `task-1`. */
  const launchSubagent = () => {
    send({
      type: "assistant",
      session_id: ROOT,
      message: {
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [
          {
            type: "tool_use",
            id: "agent-tool",
            name: "Agent",
            input: { description: "Review the diff", prompt: "Review", run_in_background: true },
          },
        ],
        stop_reason: "tool_use",
      },
    });
    send({
      type: "user",
      session_id: ROOT,
      tool_use_result: { agentId: "agent-1", status: "async_launched" },
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "agent-tool", content: "Launched" }],
      },
    });
    send({ type: "system", subtype: "task_started", task_id: "task-1", tool_use_id: "agent-tool" });
    const subagentTask = { ...reviewer, task_id: "task-1" };
    membership([subagentTask]);
    membership([subagentTask, { ...devServer, parent_task_id: "task-1" }]);
  };
  return {
    session,
    events,
    send,
    membership,
    callBackgroundBash,
    launchSubagent,
    stop,
    stopEffect,
    stopTask,
  };
};

const devServer: ListedTask = {
  task_id: "dev",
  task_type: "local_bash",
  description: "Start the dev server",
};
const reviewer: ListedTask = {
  task_id: "reviewer",
  task_type: "local_agent",
  subagent_type: "code-reviewer",
  description: "Review the diff",
};

describe("Claude background task list", () => {
  test("lists running tasks oldest first, with their kind, and skips ambient tasks", () => {
    const { session, send, membership, callBackgroundBash } = setup();
    callBackgroundBash("toolu_dev", "bun run dev");
    membership([devServer]);
    send({ type: "system", subtype: "task_started", task_id: "dev", tool_use_id: "toolu_dev" });
    const workflow = { task_id: "flow", task_type: "local_workflow", description: "Deploy" };
    const watcher = { task_id: "watch", task_type: "monitor", description: "Watch", ambient: true };
    membership([reviewer, workflow, watcher, devServer]);

    expect(projectClaudeBackgroundTasks(session)).toEqual([
      {
        externalSessionId: ROOT,
        resultPending: false,
        tasks: [
          { taskId: handle("dev"), kind: "command", title: "bun run dev", stop: { allowed: true } },
          {
            taskId: handle("reviewer"),
            kind: "subagent",
            title: "code-reviewer",
            description: "Review the diff",
            stop: { allowed: true },
          },
          { taskId: handle("flow"), kind: "task", title: "Deploy", stop: { allowed: true } },
        ],
      },
    ]);
  });

  test("uses the description as the title of a command without a known input", () => {
    const { session, membership } = setup();
    membership([devServer]);

    expect(projectClaudeBackgroundTasks(session)[0]?.tasks).toEqual([
      {
        taskId: handle("dev"),
        kind: "command",
        title: "Start the dev server",
        stop: { allowed: true },
      },
    ]);
  });

  test("uses the command of the transcript tool call after its launch result", () => {
    const { session, send, membership, callBackgroundBash } = setup();
    const command = "python3 -m http.server 8767";
    callBackgroundBash("toolu_server", command);
    send({
      type: "system",
      subtype: "task_started",
      task_id: "server",
      tool_use_id: "toolu_server",
    });
    send({
      type: "user",
      session_id: ROOT,
      tool_use_result: { backgroundTaskId: "server" },
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_server",
            content: "Command running in background with ID: server",
          },
        ],
      },
    });
    membership([{ task_id: "server", task_type: "local_bash", description: "Start the server" }]);

    expect(projectClaudeBackgroundTasks(session)[0]?.tasks).toEqual([
      { taskId: handle("server"), kind: "command", title: command, stop: { allowed: true } },
    ]);
  });

  test("lists the task of a subagent on the subagent session and on its parent", () => {
    const { session, membership } = setup();
    const childTask = { ...devServer, parent_task_id: "reviewer" };
    membership([reviewer]);
    membership([reviewer, childTask]);

    const command = {
      taskId: handle("dev"),
      kind: "command",
      title: "Start the dev server",
      stop: { allowed: true },
    };
    expect(projectClaudeBackgroundTasks(session)).toEqual([
      {
        externalSessionId: ROOT,
        resultPending: false,
        tasks: [expect.objectContaining({ taskId: handle("reviewer") }), command],
      },
      { externalSessionId: subagentSessionId("reviewer"), resultPending: false, tasks: [command] },
    ]);
  });

  test("lists the task of a subagent whose agent ID differs from its task ID", () => {
    const { session, launchSubagent } = setup();
    launchSubagent();

    const command = expect.objectContaining({ taskId: handle("dev") });
    expect(projectClaudeBackgroundTasks(session)).toEqual([
      {
        externalSessionId: ROOT,
        resultPending: false,
        tasks: [expect.objectContaining({ taskId: handle("task-1") }), command],
      },
      { externalSessionId: subagentSessionId("agent-1"), resultPending: false, tasks: [command] },
    ]);
  });

  test("reports a pending result until the native idle", () => {
    const { session, membership, send } = setup();
    membership([devServer]);
    membership([]);

    expect(projectClaudeBackgroundTasks(session)).toEqual([
      { externalSessionId: ROOT, resultPending: true, tasks: [] },
    ]);
    send({ type: "system", subtype: "session_state_changed", state: "idle" });
    expect(projectClaudeBackgroundTasks(session)).toEqual([]);
  });

  test("publishes only changes of the task list", () => {
    const { session, membership } = setup();
    const published: ClaudeBackgroundTasksEvent[] = [];
    const publish = () =>
      publishClaudeBackgroundTasks({
        session,
        timestamp: "2026-11-21T10:01:00.000Z",
        emit: (event) => published.push(event),
      });
    publish();
    membership([devServer]);
    publish();
    publish();
    membership([]);
    membership([]);
    publish();

    expect(published.map((event) => event.sessions)).toEqual([
      [{ externalSessionId: ROOT, resultPending: false, tasks: [expect.anything()] }],
      [{ externalSessionId: ROOT, resultPending: true, tasks: [] }],
    ]);
  });
});

describe("Claude background task stop", () => {
  test("goes idle without a native idle when the stopped task ends", async () => {
    const { session, events, membership, send, stop, stopTask } = setup();
    membership([devServer]);
    send({ type: "result", subtype: "success", is_error: false, result: "Started." });
    expect(session.activity).toBe("running");

    await stop(ROOT, handle("dev"));
    expect(stopTask).toHaveBeenCalledWith("dev");
    send({ type: "system", subtype: "task_updated", task_id: "dev", patch: { status: "killed" } });
    send({ type: "system", subtype: "task_notification", task_id: "dev", status: "stopped" });
    membership([]);

    expect(session.activity).toBe("idle");
    expect(events.filter((event) => event.type === "session_idle")).toHaveLength(1);
    expect(projectClaudeBackgroundTasks(session)).toEqual([]);
  });

  test("drops the pending result when the stop status arrives after the task left the list", async () => {
    const { session, membership, send, stop } = setup();
    membership([devServer]);
    await stop(ROOT, handle("dev"));
    membership([]);
    expect(session.activity).toBe("running");
    send({ type: "system", subtype: "task_notification", task_id: "dev", status: "stopped" });

    expect(session.activity).toBe("idle");
  });

  test("keeps the result of a task that completes by itself during the stop", async () => {
    const { session, membership, send, stop } = setup();
    membership([devServer]);
    await stop(ROOT, handle("dev"));
    send({ type: "system", subtype: "task_notification", task_id: "dev", status: "completed" });
    membership([]);

    expect(session.activity).toBe("running");
    expect(projectClaudeBackgroundTasks(session)).toEqual([
      { externalSessionId: ROOT, resultPending: true, tasks: [] },
    ]);
  });

  test("gives a resumed task a new handle and ignores a stop for its earlier run", async () => {
    const { session, membership, send, stop, stopTask } = setup();
    membership([devServer]);
    send({ type: "system", subtype: "task_notification", task_id: "dev", status: "completed" });
    membership([]);
    const resumed = { ...devServer, run_id: "run:dev-2" };
    send({ type: "system", subtype: "task_started", task_id: "dev", run_id: "run:dev-2" });
    membership([resumed]);

    await stop(ROOT, handle("dev"));
    expect(stopTask).not.toHaveBeenCalled();
    expect(projectClaudeBackgroundTasks(session)[0]?.tasks).toEqual([
      expect.objectContaining({ taskId: "dev:run:dev-2" }),
    ]);
    await stop(ROOT, "dev:run:dev-2");
    expect(stopTask).toHaveBeenCalledTimes(1);
    expect(stopTask).toHaveBeenCalledWith("dev");
  });

  test("calls no runtime stop for a task outside the session tree of the ref", async () => {
    const { membership, stop, stopTask } = setup();
    const otherAgent = { ...reviewer, task_id: "other" };
    membership([reviewer, otherAgent]);
    membership([reviewer, otherAgent, { ...devServer, parent_task_id: "other" }]);

    await stop(subagentSessionId("reviewer"), handle("dev"));
    await stop(ROOT, "unknown");
    await stop("session-2", handle("dev"));
    expect(stopTask).not.toHaveBeenCalled();
    await stop(subagentSessionId("other"), handle("dev"));
    expect(stopTask).toHaveBeenCalledWith("dev");
  });

  test("stops the task of a subagent whose agent ID differs from its task ID", async () => {
    const { launchSubagent, stop, stopTask } = setup();
    launchSubagent();

    await stop(subagentSessionId("agent-1"), handle("dev"));
    expect(stopTask).toHaveBeenCalledTimes(1);
    expect(stopTask).toHaveBeenCalledWith("dev");
  });

  test("fails with the runtime reason while the task still runs", async () => {
    const { membership, stopEffect, stopTask } = setup();
    stopTask.mockImplementation(async () => {
      throw new Error("Task dev is not stoppable.");
    });
    membership([devServer]);

    const error = await Effect.runPromise(Effect.flip(stopEffect(ROOT, handle("dev"))));
    expect(error).toBeInstanceOf(HostOperationError);
    expect(error.message).toBe(
      "Claude could not stop background task 'dev': Task dev is not stoppable.",
    );
  });

  test("succeeds when the stop fails for a task that ended meanwhile", async () => {
    const { membership, send, stop, stopTask } = setup();
    membership([devServer]);
    stopTask.mockImplementation(async () => {
      send({ type: "system", subtype: "task_notification", task_id: "dev", status: "completed" });
      throw new Error("Task dev is not running.");
    });

    await stop(ROOT, handle("dev"));
    expect(stopTask).toHaveBeenCalledTimes(1);
  });
});
