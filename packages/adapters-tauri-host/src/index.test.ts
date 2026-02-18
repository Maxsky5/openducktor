import { describe, expect, test } from "bun:test";
import { TauriHostClient } from "./index";

type InvokeCall = {
  command: string;
  args?: Record<string, unknown>;
};

const makeTaskCardPayload = () => ({
  id: "task-1",
  title: "Task",
  description: "",
  acceptanceCriteria: "",
  notes: "",
  status: "open",
  priority: 2,
  issueType: "task",
  aiReviewEnabled: true,
  labels: [],
  assignee: null,
  parentId: null,
  subtaskIds: [],
  updatedAt: "2026-02-17T12:00:00Z",
  createdAt: "2026-02-17T12:00:00Z",
});

const createClient = (resolver: (command: string, args?: Record<string, unknown>) => unknown) => {
  const calls: InvokeCall[] = [];
  const invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    calls.push({ command, args });
    return resolver(command, args) as T;
  };
  return { client: new TauriHostClient(invoke), calls };
};

describe("TauriHostClient", () => {
  test("setPlan forwards markdown and subtasks payload", async () => {
    const { client, calls } = createClient((command) => {
      if (command === "set_plan") {
        return { updatedAt: "2026-02-17T12:01:00Z" };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const output = await client.setPlan({
      repoPath: "/repo",
      taskId: "epic-1",
      markdown: "## Plan",
      subtasks: [{ title: "Subtask A", issueType: "task", priority: 1 }],
    });

    expect(output.updatedAt).toBe("2026-02-17T12:01:00Z");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      command: "set_plan",
      args: {
        repoPath: "/repo",
        taskId: "epic-1",
        input: {
          markdown: "## Plan",
          subtasks: [{ title: "Subtask A", issueType: "task", priority: 1 }],
        },
      },
    });
  });

  test("taskTransition validates status before invoking host", async () => {
    const { client, calls } = createClient(() => makeTaskCardPayload());

    await expect(
      client.taskTransition("/repo", "task-1", "not_a_status" as never),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  test("build and human workflow commands use expected IPC routes", async () => {
    const { client, calls } = createClient((command) => {
      if (command === "build_blocked") {
        return { ...makeTaskCardPayload(), status: "blocked" };
      }
      if (command === "human_request_changes") {
        return { ...makeTaskCardPayload(), status: "in_progress" };
      }
      if (command === "human_approve") {
        return { ...makeTaskCardPayload(), status: "closed" };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await client.buildBlocked("/repo", "task-1", "Needs clarification");
    await client.humanRequestChanges("/repo", "task-1", "Please rework API");
    await client.humanApprove("/repo", "task-1");

    expect(calls.map((entry) => entry.command)).toEqual([
      "build_blocked",
      "human_request_changes",
      "human_approve",
    ]);
    expect(calls[0].args?.reason).toBe("Needs clarification");
    expect(calls[1].args?.note).toBe("Please rework API");
  });

  test("tasksList rejects malformed host payloads", async () => {
    const { client } = createClient(() => [{ id: "task-1", title: "broken" }]);
    await expect(client.tasksList("/repo")).rejects.toThrow();
  });

  test("opencode runtime commands use expected IPC routes", async () => {
    const { client, calls } = createClient((command) => {
      if (command === "opencode_runtime_start") {
        return {
          runtimeId: "runtime-1",
          repoPath: "/repo",
          taskId: "task-1",
          role: "planner",
          workingDirectory: "/repo",
          port: 4173,
          startedAt: "2026-02-17T12:00:00Z",
        };
      }
      if (command === "opencode_runtime_list") {
        return [
          {
            runtimeId: "runtime-1",
            repoPath: "/repo",
            taskId: "task-1",
            role: "planner",
            workingDirectory: "/repo",
            port: 4173,
            startedAt: "2026-02-17T12:00:00Z",
          },
        ];
      }
      if (command === "opencode_repo_runtime_ensure") {
        return {
          runtimeId: "runtime-main",
          repoPath: "/repo",
          taskId: "__workspace__",
          role: "workspace",
          workingDirectory: "/repo",
          port: 4180,
          startedAt: "2026-02-17T12:00:00Z",
        };
      }
      if (command === "opencode_runtime_stop") {
        return { ok: true };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const runtime = await client.opencodeRuntimeStart("/repo", "task-1", "planner");
    const runtimes = await client.opencodeRuntimeList("/repo");
    const ensured = await client.opencodeRepoRuntimeEnsure("/repo");
    const stopped = await client.opencodeRuntimeStop("runtime-1");

    expect(runtime.runtimeId).toBe("runtime-1");
    expect(runtimes).toHaveLength(1);
    expect(ensured.runtimeId).toBe("runtime-main");
    expect(stopped.ok).toBe(true);
    expect(calls.map((entry) => entry.command)).toEqual([
      "opencode_runtime_start",
      "opencode_runtime_list",
      "opencode_repo_runtime_ensure",
      "opencode_runtime_stop",
    ]);
  });
});
