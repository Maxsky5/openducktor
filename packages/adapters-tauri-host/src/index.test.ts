import type {} from "./bun-test";
import type { TauriHostClient as TauriHostClientType } from "./index";
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
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: true, completed: false },
    planner: { required: false, canSkip: true, available: true, completed: false },
    builder: { required: true, canSkip: false, available: true, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  updatedAt: "2026-02-17T12:00:00Z",
  createdAt: "2026-02-17T12:00:00Z",
});

const makeTaskMetadataPayload = (specMarkdown = "Spec Body") => ({
  spec: { markdown: specMarkdown, updatedAt: "2026-02-20T09:00:00Z" },
  plan: { markdown: "Plan Body", updatedAt: "2026-02-20T09:05:00Z" },
  qaReport: {
    markdown: "QA Body",
    verdict: "approved",
    updatedAt: "2026-02-20T09:10:00Z",
    revision: 2,
  },
  agentSessions: [
    {
      sessionId: "session-1",
      externalSessionId: "external-1",
      taskId: "task-1",
      role: "build",
      scenario: "build_implementation_start",
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
  ],
});

const createClient = (resolver: (command: string, args?: Record<string, unknown>) => unknown) => {
  const calls: InvokeCall[] = [];
  const invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    calls.push({ command, args });
    return resolver(command, args) as T;
  };
  return { client: new TauriHostClient(invoke), calls };
};

const assertClientType = (client: TauriHostClientType): TauriHostClientType => client;

describe("TauriHostClient", () => {
  test("exports a value and type-compatible host client", async () => {
    const { client } = createClient((command) => {
      if (command === "set_spec") {
        return { updatedAt: "2026-02-20T10:00:00Z" };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const typedClient = assertClientType(client);
    const output = await typedClient.setSpec({
      repoPath: "/repo",
      taskId: "task-1",
      markdown: "# Spec",
    });

    expect(output.updatedAt).toBe("2026-02-20T10:00:00Z");
  });

  test("delegated methods are writable and configurable for test doubles", async () => {
    const { client } = createClient((command) => {
      if (command === "tasks_list") {
        return [makeTaskCardPayload()];
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const descriptor = Object.getOwnPropertyDescriptor(client, "tasksList");
    expect(descriptor?.writable).toBe(true);
    expect(descriptor?.configurable).toBe(true);

    const original = client.tasksList.bind(client);
    const replacement = async (_repoPath: string) => [];
    client.tasksList = replacement;

    await expect(client.tasksList("/repo")).resolves.toEqual([]);

    client.tasksList = original;
    await expect(client.tasksList("/repo")).resolves.toHaveLength(1);
  });

  test("facade exposes every delegated API method", () => {
    const { client } = createClient((command) => {
      throw new Error(`Unexpected command: ${command}`);
    });

    // Keep this explicit: importing internal method-group constants from index.ts
    // would make this facade-surface assertion tautological.
    const expectedMethods = [
      "workspaceList",
      "workspaceAdd",
      "workspaceSelect",
      "workspaceUpdateRepoConfig",
      "workspaceSaveRepoSettings",
      "workspaceUpdateRepoHooks",
      "workspaceGetRepoConfig",
      "workspacePrepareTrustedHooksChallenge",
      "workspaceSetTrustedHooks",
      "getTheme",
      "setTheme",
      "tasksList",
      "taskCreate",
      "taskUpdate",
      "taskDelete",
      "taskTransition",
      "taskDefer",
      "taskResumeDeferred",
      "specGet",
      "setSpec",
      "saveSpecDocument",
      "setPlan",
      "savePlanDocument",
      "planGet",
      "qaGetReport",
      "qaApproved",
      "qaRejected",
      "agentSessionsList",
      "agentSessionUpsert",
      "systemCheck",
      "runtimeCheck",
      "beadsCheck",
      "runsList",
      "opencodeRuntimeList",
      "opencodeRuntimeStart",
      "opencodeRuntimeStop",
      "opencodeRepoRuntimeEnsure",
      "buildStart",
      "buildBlocked",
      "buildResumed",
      "buildCompleted",
      "humanRequestChanges",
      "humanApprove",
      "buildRespond",
      "buildStop",
      "buildCleanup",
      "gitGetBranches",
      "gitGetCurrentBranch",
      "gitSwitchBranch",
      "gitCreateWorktree",
      "gitRemoveWorktree",
      "gitPushBranch",
    ] as const;

    for (const methodName of expectedMethods) {
      expect(typeof client[methodName]).toBe("function");
    }
  });

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

  test("setPlan preserves host error details for invalid command payloads", async () => {
    const { client } = createClient((command) => {
      if (command === "set_plan") {
        throw new Error("invalid args: input.markdown is required");
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(
      client.setPlan({
        repoPath: "/repo",
        taskId: "epic-1",
        markdown: "## Plan",
      }),
    ).rejects.toThrow("invalid args: input.markdown is required");
  });

  test("runtimeCheck forwards force flag to IPC command", async () => {
    const { client, calls } = createClient((command) => {
      if (command === "runtime_check") {
        return {
          gitOk: true,
          gitVersion: "2.45.0",
          opencodeOk: true,
          opencodeVersion: "0.12.0",
          errors: [],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await client.runtimeCheck();
    await client.runtimeCheck(true);

    expect(calls).toEqual([
      {
        command: "runtime_check",
        args: { force: false },
      },
      {
        command: "runtime_check",
        args: { force: true },
      },
    ]);
  });

  test("taskTransition validates status before invoking host", async () => {
    const { client, calls } = createClient(() => makeTaskCardPayload());

    await expect(
      client.taskTransition("/repo", "task-1", "not_a_status" as never),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  test("workspaceSaveRepoSettings uses atomic repo-settings IPC route", async () => {
    const { client, calls } = createClient((command) => {
      if (command === "workspace_save_repo_settings") {
        return {
          path: "/repo",
          isActive: true,
          hasConfig: true,
          configuredWorktreeBasePath: "/tmp/worktrees",
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const result = await client.workspaceSaveRepoSettings("/repo", {
      worktreeBasePath: "/tmp/worktrees",
      branchPrefix: "codex",
      trustedHooks: true,
      hooks: {
        preStart: ["echo pre"],
        postComplete: ["echo post"],
      },
      agentDefaults: {
        build: {
          providerId: "openai",
          modelId: "gpt-5",
        },
      },
    });

    expect(result.hasConfig).toBe(true);
    expect(calls).toEqual([
      {
        command: "workspace_save_repo_settings",
        args: {
          repoPath: "/repo",
          settings: {
            worktreeBasePath: "/tmp/worktrees",
            branchPrefix: "codex",
            trustedHooks: true,
            hooks: {
              preStart: ["echo pre"],
              postComplete: ["echo post"],
            },
            agentDefaults: {
              build: {
                providerId: "openai",
                modelId: "gpt-5",
              },
            },
          },
        },
      },
    ]);
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
      if (command === "git_get_branches") {
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
    expect(current.detached).toBe(false);
    expect(switched.name).toBe("main");
    expect(worktree.worktreePath).toBe("/tmp/wt/task-1");
    expect(removed.ok).toBe(true);
    expect(pushed.remote).toBe("origin");

    expect(calls.map((entry) => entry.command)).toEqual([
      "git_get_branches",
      "git_get_current_branch",
      "git_switch_branch",
      "git_create_worktree",
      "git_remove_worktree",
      "git_push_branch",
    ]);
    expect(calls[2].args).toEqual({
      repoPath: "/repo",
      branch: "feature/task-1",
      create: true,
    });
    expect(calls[3].args).toEqual({
      repoPath: "/repo",
      worktreePath: "/tmp/wt/task-1",
      branch: "feature/task-1",
      createBranch: true,
    });
    expect(calls[5].args).toEqual({
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
      if (command === "task_metadata_get") {
        return {
          spec: { markdown: "", updatedAt: null },
          plan: { markdown: "", updatedAt: null },
          qaReport: null,
          agentSessions: [
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
          ],
        };
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
      "task_metadata_get",
      "agent_session_upsert",
    ]);
    expect(calls[0].args).toEqual({
      repoPath: "/repo",
      taskId: "task-1",
    });
  });

  test("agentSessionsList normalizes legacy scenarios and skips invalid rows", async () => {
    const { client } = createClient((command) => {
      if (command === "task_metadata_get") {
        return {
          spec: { markdown: "", updatedAt: null },
          plan: { markdown: "", updatedAt: null },
          qaReport: null,
          agentSessions: [
            {
              sessionId: "legacy-spec",
              externalSessionId: "legacy-ext-1",
              taskId: "task-1",
              role: "spec",
              scenario: "spec_revision",
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
            {
              sessionId: "legacy-planner",
              externalSessionId: "legacy-ext-2",
              taskId: "task-1",
              role: "planner",
              scenario: "planner_revision",
              status: "idle",
              startedAt: "2026-02-18T17:22:00Z",
              updatedAt: "2026-02-18T17:23:00Z",
              endedAt: null,
              runtimeId: "runtime-1",
              runId: null,
              baseUrl: "http://127.0.0.1:4173",
              workingDirectory: "/repo",
              selectedModel: null,
            },
            {
              sessionId: "bad-entry",
              externalSessionId: "legacy-ext-3",
              taskId: "task-1",
              role: "planner",
              scenario: "planner_unknown",
              status: "idle",
              startedAt: "2026-02-18T17:24:00Z",
              updatedAt: "2026-02-18T17:25:00Z",
              endedAt: null,
              runtimeId: "runtime-1",
              runId: null,
              baseUrl: "http://127.0.0.1:4173",
              workingDirectory: "/repo",
              selectedModel: null,
            },
          ],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const sessions = await client.agentSessionsList("/repo", "task-1");

    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.scenario).toBe("spec_initial");
    expect(sessions[1]?.scenario).toBe("planner_initial");
  });

  test("spec, plan, qa, and session reads share one metadata IPC call per task", async () => {
    const { client, calls } = createClient((command) => {
      if (command === "task_metadata_get") {
        return makeTaskMetadataPayload();
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const [spec, plan, qa, sessions] = await Promise.all([
      client.specGet("/repo", "task-1"),
      client.planGet("/repo", "task-1"),
      client.qaGetReport("/repo", "task-1"),
      client.agentSessionsList("/repo", "task-1"),
    ]);

    expect(spec.markdown).toBe("Spec Body");
    expect(plan.markdown).toBe("Plan Body");
    expect(qa.markdown).toBe("QA Body");
    expect(sessions).toHaveLength(1);
    expect(calls).toEqual([
      {
        command: "task_metadata_get",
        args: {
          repoPath: "/repo",
          taskId: "task-1",
        },
      },
    ]);
  });

  test("sequential metadata reads reuse cache for the same task", async () => {
    const { client, calls } = createClient((command) => {
      if (command === "task_metadata_get") {
        return makeTaskMetadataPayload();
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const spec = await client.specGet("/repo", "task-1");
    const plan = await client.planGet("/repo", "task-1");
    const qa = await client.qaGetReport("/repo", "task-1");
    const sessions = await client.agentSessionsList("/repo", "task-1");

    expect(spec.markdown).toBe("Spec Body");
    expect(plan.markdown).toBe("Plan Body");
    expect(qa.markdown).toBe("QA Body");
    expect(sessions).toHaveLength(1);
    expect(calls).toEqual([
      {
        command: "task_metadata_get",
        args: {
          repoPath: "/repo",
          taskId: "task-1",
        },
      },
    ]);
  });

  test("metadata cache invalidates after spec mutations", async () => {
    let metadataReadCount = 0;
    const { client, calls } = createClient((command) => {
      if (command === "task_metadata_get") {
        metadataReadCount += 1;
        return makeTaskMetadataPayload(metadataReadCount === 1 ? "Spec V1" : "Spec V2");
      }
      if (command === "set_spec") {
        return { updatedAt: "2026-02-20T10:00:00Z" };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const beforeMutation = await client.specGet("/repo", "task-1");
    await client.setSpec({ repoPath: "/repo", taskId: "task-1", markdown: "# Updated" });
    const afterMutation = await client.specGet("/repo", "task-1");

    expect(beforeMutation.markdown).toBe("Spec V1");
    expect(afterMutation.markdown).toBe("Spec V2");
    expect(calls.map((entry) => entry.command)).toEqual([
      "task_metadata_get",
      "set_spec",
      "task_metadata_get",
    ]);
  });
});
