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
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false },
  },
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
  test("saveSpecDocument uses dedicated non-transition IPC route", async () => {
    const { client, calls } = createClient((command) => {
      if (command === "spec_save_document") {
        return { updatedAt: "2026-02-20T09:30:00Z" };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const output = await client.saveSpecDocument("/repo", "task-77", "# Updated Spec");

    expect(output.updatedAt).toBe("2026-02-20T09:30:00Z");
    expect(calls).toEqual([
      {
        command: "spec_save_document",
        args: {
          repoPath: "/repo",
          taskId: "task-77",
          markdown: "# Updated Spec",
        },
      },
    ]);
  });

  test("savePlanDocument uses dedicated non-transition IPC route", async () => {
    const { client, calls } = createClient((command) => {
      if (command === "plan_save_document") {
        return { updatedAt: "2026-02-20T09:45:00Z" };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const output = await client.savePlanDocument("/repo", "task-88", "## Plan");

    expect(output.updatedAt).toBe("2026-02-20T09:45:00Z");
    expect(calls).toEqual([
      {
        command: "plan_save_document",
        args: {
          repoPath: "/repo",
          taskId: "task-88",
          markdown: "## Plan",
        },
      },
    ]);
  });

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

  test("taskDelete uses expected IPC route and payload", async () => {
    const { client, calls } = createClient((command) => {
      if (command === "task_delete") {
        return { ok: true };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const result = await client.taskDelete("/repo", "epic-1", true);
    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      {
        command: "task_delete",
        args: {
          repoPath: "/repo",
          taskId: "epic-1",
          deleteSubtasks: true,
        },
      },
    ]);
  });

  test("git commands use expected IPC routes and payloads", async () => {
    const { client, calls } = createClient((command) => {
      if (command === "git_get_branches" || command === "git_get_branchs") {
        return [{ name: "main", isCurrent: true, isRemote: false }];
      }
      if (command === "git_get_current_branch" || command === "git_switch_branch") {
        return { name: "main", detached: false };
      }
      if (command === "git_create_worktree") {
        return { branch: "feature/task-1", worktreePath: "/tmp/wt/task-1" };
      }
      if (command === "git_remove_worktree") {
        return { ok: true };
      }
      if (command === "git_push_branch") {
        return { remote: "origin", branch: "feature/task-1", output: "Everything up-to-date" };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const branches = await client.gitGetBranches("/repo");
    const branchs = await client.gitGetBranchs("/repo");
    const current = await client.gitGetCurrentBranch("/repo");
    const switched = await client.gitSwitchBranch("/repo", "feature/task-1", { create: true });
    const worktree = await client.gitCreateWorktree("/repo", "/tmp/wt/task-1", "feature/task-1", {
      createBranch: true,
    });
    const removed = await client.gitRemoveWorktree("/repo", "/tmp/wt/task-1", { force: true });
    const pushed = await client.gitPushBranch("/repo", "feature/task-1", {
      remote: "origin",
      setUpstream: true,
      forceWithLease: true,
    });

    expect(branches).toHaveLength(1);
    expect(branchs).toHaveLength(1);
    expect(current.detached).toBe(false);
    expect(switched.name).toBe("main");
    expect(worktree.worktreePath).toBe("/tmp/wt/task-1");
    expect(removed.ok).toBe(true);
    expect(pushed.remote).toBe("origin");

    expect(calls.map((entry) => entry.command)).toEqual([
      "git_get_branches",
      "git_get_branchs",
      "git_get_current_branch",
      "git_switch_branch",
      "git_create_worktree",
      "git_remove_worktree",
      "git_push_branch",
    ]);
    expect(calls[3].args).toEqual({
      repoPath: "/repo",
      branch: "feature/task-1",
      create: true,
    });
    expect(calls[4].args).toEqual({
      repoPath: "/repo",
      worktreePath: "/tmp/wt/task-1",
      branch: "feature/task-1",
      createBranch: true,
    });
    expect(calls[6].args).toEqual({
      repoPath: "/repo",
      branch: "feature/task-1",
      remote: "origin",
      setUpstream: true,
      forceWithLease: true,
    });
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

  test("agent session history commands use expected IPC routes", async () => {
    const { client, calls } = createClient((command) => {
      if (command === "agent_sessions_list") {
        return [
          {
            sessionId: "obp-session-1",
            externalSessionId: "session-opencode-1",
            taskId: "task-1",
            role: "spec",
            scenario: "spec_initial",
            status: "idle",
            startedAt: "2026-02-18T17:20:00Z",
            updatedAt: "2026-02-18T17:21:00Z",
            endedAt: null,
            runtimeId: "runtime-1",
            runId: null,
            baseUrl: "http://127.0.0.1:4173",
            workingDirectory: "/repo",
            selectedModel: null,
          },
        ];
      }
      if (command === "agent_session_upsert") {
        return { ok: true };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const history = await client.agentSessionsList("/repo", "task-1");
    const first = history[0];
    if (!first) {
      throw new Error("Expected persisted session history entry");
    }
    await client.agentSessionUpsert("/repo", "task-1", first);

    expect(history).toHaveLength(1);
    expect(calls.map((entry) => entry.command)).toEqual([
      "agent_sessions_list",
      "agent_session_upsert",
    ]);
    expect(calls[0].args).toEqual({
      repoPath: "/repo",
      taskId: "task-1",
    });
  });
});
