import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type {} from "./bun-test";
import type { TauriHostClient as TauriHostClientType } from "./index";
import { createTauriHostClient } from "./index";

type InvokeCall = {
  command: string;
  args?: Record<string, unknown>;
};

const makeTaskCardPayload = () => ({
  id: "task-1",
  title: "Task",
  description: "",
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
      role: "build",
      scenario: "build_implementation_start",
      startedAt: "2026-02-18T17:20:00Z",
      workingDirectory: "/repo",
      selectedModel: null,
    },
  ],
});

const createClient = (resolver: (command: string, args?: Record<string, unknown>) => unknown) => {
  const calls: InvokeCall[] = [];
  const invoke = async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
    calls.push({ command, args });
    return resolver(command, args);
  };
  const client: TauriHostClientType = createTauriHostClient(invoke);
  return { client, calls };
};

const assertClientType = (client: TauriHostClientType): TauriHostClientType => client;

describe("TauriHostClient", () => {
  test("does not export a redundant runtime constructor alias", async () => {
    const module = await import("./index");

    expect(module).not.toHaveProperty("TauriHostClient");
  });

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

    const rewritten = await client.tasksList("/repo");
    expect(rewritten).toEqual([]);

    client.tasksList = original;
    const rewrittenAfterReplace = await client.tasksList("/repo");
    expect(rewrittenAfterReplace).toHaveLength(1);
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
      "workspaceGetSettingsSnapshot",
      "workspaceUpdateGlobalGitConfig",
      "workspaceDetectGithubRepository",
      "workspaceSaveSettingsSnapshot",
      "workspacePrepareTrustedHooksChallenge",
      "workspaceSetTrustedHooks",
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
      "runtimeDefinitionsList",
      "runtimeList",
      "buildContinuationTargetGet",
      "runtimeStop",
      "runtimeEnsure",
      "buildStart",
      "buildBlocked",
      "buildResumed",
      "buildCompleted",
      "taskApprovalContextGet",
      "taskDirectMerge",
      "taskDirectMergeComplete",
      "taskPullRequestUpsert",
      "taskPullRequestUnlink",
      "taskPullRequestDetect",
      "taskPullRequestLinkMerged",
      "repoPullRequestSync",
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
      "gitPullBranch",
      "gitGetStatus",
      "gitGetDiff",
      "gitCommitsAheadBehind",
      "gitGetWorktreeStatus",
      "gitGetWorktreeStatusSummary",
      "gitResetWorktreeSelection",
      "gitCommitAll",
      "gitRebaseBranch",
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

    const output = await client.saveSpecDocument({
      repoPath: "/repo",
      taskId: "task-77",
      markdown: "# Updated Spec",
    });

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

    const output = await client.savePlanDocument({
      repoPath: "/repo",
      taskId: "task-88",
      markdown: "## Plan",
    });

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

  test("document mutation commands reject malformed updatedAt payloads", async () => {
    const { client } = createClient((command) => {
      switch (command) {
        case "set_spec":
          return { updatedAt: 123 };
        case "spec_save_document":
          return {};
        case "set_plan":
          return null;
        case "plan_save_document":
          return { updatedAt: "" };
        default:
          throw new Error(`Unexpected command: ${command}`);
      }
    });

    await expect(
      client.setSpec({ repoPath: "/repo", taskId: "task-1", markdown: "# Spec" }),
    ).rejects.toThrow("Expected { updatedAt: string } payload from host command set_spec");
    await expect(
      client.saveSpecDocument({
        repoPath: "/repo",
        taskId: "task-1",
        markdown: "# Spec",
      }),
    ).rejects.toThrow(
      "Expected { updatedAt: string } payload from host command spec_save_document",
    );
    await expect(
      client.setPlan({ repoPath: "/repo", taskId: "task-1", markdown: "## Plan" }),
    ).rejects.toThrow("Expected { updatedAt: string } payload from host command set_plan");
    await expect(
      client.savePlanDocument({
        repoPath: "/repo",
        taskId: "task-1",
        markdown: "## Plan",
      }),
    ).rejects.toThrow(
      "Expected { updatedAt: string } payload from host command plan_save_document",
    );
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
          runtimes: [{ kind: "opencode", ok: true, version: "0.12.0" }],
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
          defaultWorktreeBasePath: "/Users/dev/.openducktor/worktrees/repo",
          effectiveWorktreeBasePath: "/tmp/worktrees",
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

  test("workspaceGetSettingsSnapshot uses snapshot IPC route", async () => {
    const { client, calls } = createClient((command) => {
      if (command === "workspace_get_settings_snapshot") {
        return {
          theme: "light",
          git: {
            defaultMergeMethod: "merge_commit",
          },
          chat: {
            showThinkingMessages: false,
          },
          kanban: {
            doneVisibleDays: 1,
          },
          repos: {
            "/repo": {
              defaultRuntimeKind: "opencode",
              branchPrefix: "obp",
              defaultTargetBranch: { remote: "origin", branch: "main" },
              git: {
                providers: {},
              },
              trustedHooks: false,
              hooks: { preStart: [], postComplete: [] },
              worktreeFileCopies: [],
              promptOverrides: {},
              agentDefaults: {},
            },
          },
          globalPromptOverrides: {},
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const snapshot = await client.workspaceGetSettingsSnapshot();

    expect(snapshot.theme).toBe("light");
    expect(Object.keys(snapshot.repos)).toEqual(["/repo"]);
    expect(calls).toEqual([
      {
        command: "workspace_get_settings_snapshot",
        args: undefined,
      },
    ]);
  });

  test("workspaceSaveSettingsSnapshot uses atomic snapshot IPC route", async () => {
    const { client, calls } = createClient((command) => {
      if (command === "workspace_save_settings_snapshot") {
        return [
          {
            path: "/repo",
            isActive: true,
            hasConfig: true,
            configuredWorktreeBasePath: "/tmp/worktrees",
            defaultWorktreeBasePath: "/Users/dev/.openducktor/worktrees/repo",
            effectiveWorktreeBasePath: "/tmp/worktrees",
          },
        ];
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const result = await client.workspaceSaveSettingsSnapshot({
      theme: "light",
      git: {
        defaultMergeMethod: "merge_commit",
      },
      chat: {
        showThinkingMessages: false,
      },
      kanban: {
        doneVisibleDays: 1,
      },
      repos: {
        "/repo": {
          defaultRuntimeKind: "opencode",
          branchPrefix: "obp",
          defaultTargetBranch: { remote: "origin", branch: "main" },
          git: {
            providers: {},
          },
          trustedHooks: false,
          hooks: { preStart: [], postComplete: [] },
          worktreeFileCopies: [],
          promptOverrides: {},
          agentDefaults: {},
        },
      },
      globalPromptOverrides: {},
    });

    expect(result).toHaveLength(1);
    expect(calls).toEqual([
      {
        command: "workspace_save_settings_snapshot",
        args: {
          snapshot: {
            theme: "light",
            git: {
              defaultMergeMethod: "merge_commit",
            },
            chat: {
              showThinkingMessages: false,
            },
            kanban: {
              doneVisibleDays: 1,
            },
            repos: {
              "/repo": {
                defaultRuntimeKind: "opencode",
                branchPrefix: "obp",
                defaultTargetBranch: { remote: "origin", branch: "main" },
                git: {
                  providers: {},
                },
                trustedHooks: false,
                hooks: { preStart: [], postComplete: [] },
                worktreeFileCopies: [],
                promptOverrides: {},
                agentDefaults: {},
              },
            },
            globalPromptOverrides: {},
          },
        },
      },
    ]);
  });

  test("workspaceUpdateGlobalGitConfig uses dedicated IPC route", async () => {
    const { client, calls } = createClient((command) => {
      if (command === "workspace_update_global_git_config") {
        return undefined;
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await client.workspaceUpdateGlobalGitConfig({
      defaultMergeMethod: "squash",
    });

    expect(calls).toEqual([
      {
        command: "workspace_update_global_git_config",
        args: {
          git: {
            defaultMergeMethod: "squash",
          },
        },
      },
    ]);
  });

  test("workspaceDetectGithubRepository uses dedicated IPC route", async () => {
    const { client, calls } = createClient((command) => {
      if (command === "workspace_detect_github_repository") {
        return {
          host: "github.com",
          owner: "openai",
          name: "openducktor",
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const result = await client.workspaceDetectGithubRepository("/repo");

    expect(result).toEqual({
      host: "github.com",
      owner: "openai",
      name: "openducktor",
    });
    expect(calls).toEqual([
      {
        command: "workspace_detect_github_repository",
        args: {
          repoPath: "/repo",
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

  test("taskDelete rejects malformed ack payloads", async () => {
    const { client } = createClient((command) => {
      if (command === "task_delete") {
        return { ok: "true" };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(client.taskDelete("/repo", "epic-1", true)).rejects.toThrow(
      "Expected { ok: boolean } payload from host command task_delete",
    );
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
      if (command === "git_commit_all") {
        return { outcome: "no_changes", output: "nothing to commit" };
      }
      if (command === "git_rebase_branch") {
        return { outcome: "rebased", output: "rebased onto origin/main" };
      }
      if (command === "git_remove_worktree") {
        return { ok: true };
      }
      if (command === "git_push_branch") {
        return {
          outcome: "pushed",
          remote: "origin",
          branch: "feature/task-1",
          output: "Everything up-to-date",
        };
      }
      if (command === "git_rebase_abort") {
        return { outcome: "aborted", output: "rebase aborted" };
      }
      if (command === "git_pull_branch") {
        return { outcome: "pulled", output: "updated from origin/feature/task-1" };
      }
      if (command === "git_get_worktree_status") {
        return {
          currentBranch: { name: "feature/task-1", detached: false },
          fileStatuses: [{ path: "src/main.ts", status: "M", staged: false }],
          fileDiffs: [
            {
              file: "src/main.ts",
              type: "modified",
              additions: 2,
              deletions: 1,
              diff: "@@ -1 +1 @@",
            },
          ],
          targetAheadBehind: { ahead: 1, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
          snapshot: {
            effectiveWorkingDir: "/tmp/wt/task-1",
            targetBranch: "origin/main",
            diffScope: "target",
            observedAtMs: 1731000000000,
            hashVersion: 1,
            statusHash: "0123456789abcdef",
            diffHash: "fedcba9876543210",
          },
        };
      }
      if (command === "git_get_worktree_status_summary") {
        return {
          currentBranch: { name: "feature/task-1", detached: false },
          fileStatusCounts: { total: 1, staged: 0, unstaged: 1 },
          targetAheadBehind: { ahead: 1, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
          snapshot: {
            effectiveWorkingDir: "/tmp/wt/task-1",
            targetBranch: "origin/main",
            diffScope: "target",
            observedAtMs: 1731000000000,
            hashVersion: 1,
            statusHash: "0123456789abcdef",
            diffHash: "fedcba9876543210",
          },
        };
      }
      if (command === "git_reset_worktree_selection") {
        return {
          affectedPaths: ["src/main.ts"],
        };
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
    const committed = await client.gitCommitAll("/repo", "Build all changes");
    const rebased = await client.gitRebaseBranch("/repo", "origin/main", "/tmp/wt/task-1");
    const aborted = await client.gitRebaseAbort("/repo", "/tmp/wt/task-1");
    const pulled = await client.gitPullBranch("/repo", "/tmp/wt/task-1");
    const pushed = await client.gitPushBranch("/repo", "feature/task-1", {
      remote: "origin",
      setUpstream: true,
      forceWithLease: true,
      workingDir: "/tmp/wt/task-1",
    });
    const worktreeStatus = await client.gitGetWorktreeStatus(
      "/repo",
      "origin/main",
      "target",
      "/tmp/wt/task-1",
    );
    const worktreeStatusSummary = await client.gitGetWorktreeStatusSummary(
      "/repo",
      "origin/main",
      "target",
      "/tmp/wt/task-1",
    );
    const resetResult = await client.gitResetWorktreeSelection({
      repoPath: "/repo",
      workingDir: "/tmp/wt/task-1",
      targetBranch: "origin/main",
      snapshot: {
        hashVersion: 1,
        statusHash: "0123456789abcdef",
        diffHash: "fedcba9876543210",
      },
      selection: {
        kind: "hunk",
        filePath: "src/main.ts",
        hunkIndex: 1,
      },
    });

    expect(branches).toHaveLength(1);
    expect(current.detached).toBe(false);
    expect(switched.name).toBe("main");
    expect(worktree.worktreePath).toBe("/tmp/wt/task-1");
    expect(removed.ok).toBe(true);
    expect(committed.outcome).toBe("no_changes");
    expect(rebased.outcome).toBe("rebased");
    expect(aborted.outcome).toBe("aborted");
    expect(pulled.outcome).toBe("pulled");
    expect(pushed.outcome).toBe("pushed");
    expect(pushed.remote).toBe("origin");
    expect(worktreeStatus.currentBranch.name).toBe("feature/task-1");
    expect(worktreeStatus.targetAheadBehind.ahead).toBe(1);
    expect(worktreeStatusSummary.fileStatusCounts.total).toBe(1);
    expect(resetResult.affectedPaths).toEqual(["src/main.ts"]);

    expect(calls.map((entry) => entry.command)).toEqual([
      "git_get_branches",
      "git_get_current_branch",
      "git_switch_branch",
      "git_create_worktree",
      "git_remove_worktree",
      "git_commit_all",
      "git_rebase_branch",
      "git_rebase_abort",
      "git_pull_branch",
      "git_push_branch",
      "git_get_worktree_status",
      "git_get_worktree_status_summary",
      "git_reset_worktree_selection",
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
    expect(calls[4].args).toEqual({
      repoPath: "/repo",
      worktreePath: "/tmp/wt/task-1",
      force: true,
    });
    expect(calls[5].args).toEqual({
      repoPath: "/repo",
      message: "Build all changes",
      workingDir: null,
    });
    expect(calls[6].args).toEqual({
      repoPath: "/repo",
      targetBranch: "origin/main",
      workingDir: "/tmp/wt/task-1",
    });
    expect(calls[7].args).toEqual({
      repoPath: "/repo",
      workingDir: "/tmp/wt/task-1",
    });
    expect(calls[8].args).toEqual({
      repoPath: "/repo",
      workingDir: "/tmp/wt/task-1",
    });
    expect(calls[9].args).toEqual({
      repoPath: "/repo",
      branch: "feature/task-1",
      remote: "origin",
      setUpstream: true,
      forceWithLease: true,
      workingDir: "/tmp/wt/task-1",
    });
    expect(calls[10].args).toEqual({
      repoPath: "/repo",
      targetBranch: "origin/main",
      diffScope: "target",
      workingDir: "/tmp/wt/task-1",
    });
    expect(calls[11].args).toEqual({
      repoPath: "/repo",
      targetBranch: "origin/main",
      diffScope: "target",
      workingDir: "/tmp/wt/task-1",
    });
    expect(calls[12].args).toEqual({
      repoPath: "/repo",
      workingDir: "/tmp/wt/task-1",
      targetBranch: "origin/main",
      snapshot: {
        hashVersion: 1,
        statusHash: "0123456789abcdef",
        diffHash: "fedcba9876543210",
      },
      selection: {
        kind: "hunk",
        filePath: "src/main.ts",
        hunkIndex: 1,
      },
    });
  });

  test("gitRemoveWorktree rejects malformed ack payloads", async () => {
    const { client } = createClient((command) => {
      if (command === "git_remove_worktree") {
        return {};
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(client.gitRemoveWorktree("/repo", "/tmp/wt/task-1")).rejects.toThrow(
      "Expected { ok: boolean } payload from host command git_remove_worktree",
    );
  });

  test("git commit-all, pull, and rebase parse and reject malformed host payloads", async () => {
    const { client } = createClient((command) => {
      if (command === "git_commit_all") {
        return { outcome: "committed" };
      }
      if (command === "git_pull_branch") {
        return { outcome: "pulled" };
      }
      if (command === "git_rebase_branch") {
        return { outcome: "conflicts", conflictedFiles: ["src/index.ts"] };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(client.gitCommitAll("/repo", "Build all changes")).rejects.toThrow();
    await expect(client.gitPullBranch("/repo")).rejects.toThrow();
    await expect(client.gitRebaseBranch("/repo", "origin/main")).rejects.toThrow();
  });

  test("git reset worktree selection validates payloads and rejects malformed host responses", async () => {
    const { client } = createClient((command) => {
      if (command === "git_reset_worktree_selection") {
        return { affectedPaths: [] };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(
      client.gitResetWorktreeSelection({
        repoPath: "/repo",
        targetBranch: "origin/main",
        snapshot: {
          hashVersion: 1,
          statusHash: "bad-hash",
          diffHash: "fedcba9876543210",
        },
        selection: {
          kind: "file",
          filePath: "src/main.ts",
        },
      }),
    ).rejects.toThrow();

    await expect(
      client.gitResetWorktreeSelection({
        repoPath: "/repo",
        targetBranch: "origin/main",
        snapshot: {
          hashVersion: 1,
          statusHash: "0123456789abcdef",
          diffHash: "fedcba9876543210",
        },
        selection: {
          kind: "file",
          filePath: "src/main.ts",
        },
      }),
    ).rejects.toThrow();
  });

  test("git worktree status rejects malformed hash metadata payloads", async () => {
    const { client } = createClient((command) => {
      if (command === "git_get_worktree_status") {
        return {
          currentBranch: { name: "feature/task-1", detached: false },
          fileStatuses: [{ path: "src/main.ts", status: "M", staged: false }],
          fileDiffs: [
            {
              file: "src/main.ts",
              type: "modified",
              additions: 2,
              deletions: 1,
              diff: "@@ -1 +1 @@",
            },
          ],
          targetAheadBehind: { ahead: 1, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
          snapshot: {
            effectiveWorkingDir: "/tmp/wt/task-1",
            targetBranch: "origin/main",
            diffScope: "target",
            observedAtMs: 1731000000000,
            hashVersion: 1,
            statusHash: "status-hash",
            diffHash: "fedcba9876543210",
          },
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(
      client.gitGetWorktreeStatus("/repo", "origin/main", "target", "/tmp/wt/task-1"),
    ).rejects.toThrow();
  });

  test("git worktree status summary rejects malformed payloads", async () => {
    const { client } = createClient((command) => {
      if (command === "git_get_worktree_status_summary") {
        return {
          currentBranch: { name: "feature/task-1", detached: false },
          fileStatusCounts: { total: -1, staged: 0, unstaged: 0 },
          targetAheadBehind: { ahead: 1, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
          snapshot: {
            effectiveWorkingDir: "/tmp/wt/task-1",
            targetBranch: "origin/main",
            diffScope: "target",
            observedAtMs: 1731000000000,
            hashVersion: 1,
            statusHash: "0123456789abcdef",
            diffHash: "fedcba9876543210",
          },
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(
      client.gitGetWorktreeStatusSummary("/repo", "origin/main", "target", "/tmp/wt/task-1"),
    ).rejects.toThrow();
  });

  test("git pull parses typed conflicts outcome", async () => {
    const { client } = createClient((command) => {
      if (command === "git_pull_branch") {
        return {
          outcome: "conflicts",
          conflictedFiles: ["src/index.ts"],
          output: "Automatic merge failed; fix conflicts and then commit the result.",
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const result = await client.gitPullBranch("/repo");

    expect(result).toEqual({
      outcome: "conflicts",
      conflictedFiles: ["src/index.ts"],
      output: "Automatic merge failed; fix conflicts and then commit the result.",
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
    const { client } = createClient(() => ({ tasks: [] }));
    await expect(client.tasksList("/repo")).rejects.toThrow(
      "Expected array payload from host command tasks_list",
    );
  });

  test("runtime commands use expected IPC routes", async () => {
    const { client, calls } = createClient((command) => {
      if (command === "runtime_definitions_list") {
        return [
          {
            kind: "opencode",
            label: "OpenCode",
            description: "OpenCode local runtime with OpenDucktor MCP integration.",
            readOnlyRoleBlockedTools: [
              "edit",
              "write",
              "apply_patch",
              "ast_grep_replace",
              "lsp_rename",
            ],
            capabilities: {
              supportsProfiles: true,
              supportsVariants: true,
              supportsOdtWorkflowTools: true,
              supportsPermissionRequests: true,
              supportsQuestionRequests: true,
              supportsSessionFork: true,
              supportsTodos: true,
              supportsDiff: true,
              supportsFileStatus: true,
              supportsMcpStatus: true,
              supportedScopes: ["workspace", "task", "build"],
              provisioningMode: "host_managed",
            },
          },
        ];
      }
      if (command === "build_continuation_target_get") {
        return {
          workingDirectory: "/repo/worktrees/task-1",
          source: "active_build_run",
        };
      }
      if (command === "runtime_list") {
        return [
          {
            kind: "opencode",
            runtimeId: "runtime-1",
            repoPath: "/repo",
            taskId: null,
            role: "workspace",
            workingDirectory: "/repo",
            runtimeRoute: {
              type: "local_http",
              endpoint: "http://127.0.0.1:4173",
            },
            startedAt: "2026-02-17T12:00:00Z",
            descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
          },
        ];
      }
      if (command === "runtime_ensure") {
        return {
          kind: "opencode",
          runtimeId: "runtime-main",
          repoPath: "/repo",
          taskId: null,
          role: "workspace",
          workingDirectory: "/repo",
          runtimeRoute: {
            type: "local_http",
            endpoint: "http://127.0.0.1:4180",
          },
          startedAt: "2026-02-17T12:00:00Z",
          descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
        };
      }
      if (command === "runtime_stop") {
        return { ok: true };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const definitions = await client.runtimeDefinitionsList();
    const qaTarget = await client.buildContinuationTargetGet("/repo", "task-1");
    const runtimes = await client.runtimeList("/repo", "opencode");
    const ensured = await client.runtimeEnsure("/repo", "opencode");
    const stopped = await client.runtimeStop("runtime-1");

    expect(definitions[0]?.kind).toBe("opencode");
    expect(qaTarget).toEqual({
      workingDirectory: "/repo/worktrees/task-1",
      source: "active_build_run",
    });
    expect(runtimes).toHaveLength(1);
    expect(ensured.runtimeId).toBe("runtime-main");
    expect(stopped.ok).toBe(true);
    expect(calls.map((entry) => entry.command)).toEqual([
      "runtime_definitions_list",
      "build_continuation_target_get",
      "runtime_list",
      "runtime_ensure",
      "runtime_stop",
    ]);
    expect(calls[2]?.args).toEqual({
      repoPath: "/repo",
      runtimeKind: "opencode",
    });
    expect(calls[3]?.args).toEqual({
      repoPath: "/repo",
      runtimeKind: "opencode",
    });
  });

  test("build continuation target returns null when host reports no target", async () => {
    const { client } = createClient((command) => {
      if (command === "build_continuation_target_get") {
        return null;
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(client.buildContinuationTargetGet("/repo", "task-1")).resolves.toBeNull();
  });

  test("runtime and build ack commands reject malformed host payloads", async () => {
    const { client } = createClient((command) => {
      switch (command) {
        case "runtime_stop":
          return { ok: "yes" };
        case "build_respond":
          return { ok: 1 };
        case "build_stop":
          return {};
        case "build_cleanup":
          return null;
        default:
          throw new Error(`Unexpected command: ${command}`);
      }
    });

    await expect(client.runtimeStop("runtime-1")).rejects.toThrow(
      "Expected { ok: boolean } payload from host command runtime_stop",
    );
    await expect(client.buildRespond("run-1", { action: "approve" })).rejects.toThrow(
      "Expected { ok: boolean } payload from host command build_respond",
    );
    await expect(client.buildStop("run-1")).rejects.toThrow(
      "Expected { ok: boolean } payload from host command build_stop",
    );
    await expect(client.buildCleanup("run-1", "success")).rejects.toThrow(
      "Expected { ok: boolean } payload from host command build_cleanup",
    );
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
              role: "spec",
              scenario: "spec_initial",
              startedAt: "2026-02-18T17:20:00Z",
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

  test("agentSessionsList rejects legacy persisted scenarios", async () => {
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
              role: "spec",
              scenario: "spec_revision",
              startedAt: "2026-02-18T17:20:00Z",
              workingDirectory: "/repo",
              selectedModel: null,
            },
            {
              sessionId: "legacy-planner",
              externalSessionId: "legacy-ext-2",
              role: "planner",
              scenario: "planner_revision",
              startedAt: "2026-02-18T17:22:00Z",
              workingDirectory: "/repo",
              selectedModel: null,
            },
          ],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(client.agentSessionsList("/repo", "task-1")).rejects.toThrow(
      "Task metadata for task-1 contains invalid persisted agent sessions",
    );
  });

  test("agentSessionsList rejects invalid persisted agent session entries", async () => {
    const { client } = createClient((command) => {
      if (command === "task_metadata_get") {
        return {
          spec: { markdown: "", updatedAt: null },
          plan: { markdown: "", updatedAt: null },
          qaReport: null,
          agentSessions: [
            {
              sessionId: "bad-entry",
              externalSessionId: "legacy-ext-3",
              role: "planner",
              scenario: "planner_unknown",
              startedAt: "2026-02-18T17:24:00Z",
              workingDirectory: "/repo",
              selectedModel: null,
            },
          ],
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(client.agentSessionsList("/repo", "task-1")).rejects.toThrow(
      "Task metadata for task-1 contains invalid persisted agent sessions",
    );
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

  test("forceFresh metadata reads bypass stale cache and repopulate steady-state reads", async () => {
    let metadataReadCount = 0;
    const { client, calls } = createClient((command) => {
      if (command === "task_metadata_get") {
        metadataReadCount += 1;
        return makeTaskMetadataPayload(metadataReadCount === 1 ? "Spec V1" : "Spec V2");
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    expect((await client.specGet("/repo", "task-1")).markdown).toBe("Spec V1");
    expect((await client.specGet("/repo", "task-1")).markdown).toBe("Spec V1");
    expect((await client.specGet("/repo", "task-1", { forceFresh: true })).markdown).toBe(
      "Spec V2",
    );
    expect((await client.specGet("/repo", "task-1")).markdown).toBe("Spec V2");

    expect(calls.map((entry) => entry.command)).toEqual(["task_metadata_get", "task_metadata_get"]);
  });

  test("forceFresh metadata reads do not get stuck behind older in-flight reads", async () => {
    let metadataReadCount = 0;
    const createDeferredMetadataRead = () => {
      let resolve!: (value: ReturnType<typeof makeTaskMetadataPayload>) => void;
      const promise = new Promise<ReturnType<typeof makeTaskMetadataPayload>>((nextResolve) => {
        resolve = nextResolve;
      });
      return { promise, resolve };
    };
    const staleReadPromise = createDeferredMetadataRead();
    const freshReadPromise = createDeferredMetadataRead();
    const { client, calls } = createClient((command) => {
      if (command === "task_metadata_get") {
        metadataReadCount += 1;
        if (metadataReadCount === 1) {
          return staleReadPromise.promise;
        }
        if (metadataReadCount === 2) {
          return freshReadPromise.promise;
        }
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const staleRead = client.specGet("/repo", "task-1");
    const freshSpecRead = client.specGet("/repo", "task-1", { forceFresh: true });
    const freshPlanRead = client.planGet("/repo", "task-1", { forceFresh: true });

    freshReadPromise.resolve(makeTaskMetadataPayload("Spec V2"));

    expect((await freshSpecRead).markdown).toBe("Spec V2");
    expect((await freshPlanRead).markdown).toBe("Plan Body");

    staleReadPromise.resolve(makeTaskMetadataPayload("Spec V1"));

    expect((await staleRead).markdown).toBe("Spec V1");
    expect((await client.specGet("/repo", "task-1")).markdown).toBe("Spec V2");
    expect((await client.planGet("/repo", "task-1")).markdown).toBe("Plan Body");

    expect(calls.map((entry) => entry.command)).toEqual(["task_metadata_get", "task_metadata_get"]);
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

  test("metadata cache invalidates after approval mutations and PR sync", async () => {
    let metadataReadCount = 0;
    const { client, calls } = createClient((command) => {
      if (command === "task_metadata_get") {
        metadataReadCount += 1;
        return makeTaskMetadataPayload(`Spec V${metadataReadCount}`);
      }
      if (command === "task_direct_merge") {
        return {
          outcome: "completed",
          task: makeTaskCardPayload(),
        };
      }
      if (command === "task_direct_merge_complete") {
        return makeTaskCardPayload();
      }
      if (command === "task_pull_request_upsert") {
        return {
          providerId: "github",
          number: 17,
          url: "https://github.com/openai/openducktor/pull/17",
          state: "open",
          createdAt: "2026-02-20T10:00:00Z",
          updatedAt: "2026-02-20T10:00:00Z",
          lastSyncedAt: "2026-02-20T10:00:00Z",
          mergedAt: null,
          closedAt: null,
        };
      }
      if (command === "task_pull_request_unlink") {
        return {
          ok: true,
        };
      }
      if (command === "task_pull_request_detect") {
        return {
          outcome: "linked",
          pullRequest: {
            providerId: "github",
            number: 17,
            url: "https://github.com/openai/openducktor/pull/17",
            state: "open",
            createdAt: "2026-02-20T10:00:00Z",
            updatedAt: "2026-02-20T10:00:00Z",
            lastSyncedAt: "2026-02-20T10:00:00Z",
            mergedAt: null,
            closedAt: null,
          },
        };
      }
      if (command === "task_pull_request_link_merged") {
        return makeTaskCardPayload();
      }
      if (command === "repo_pull_request_sync") {
        return { ok: true };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    expect((await client.specGet("/repo", "task-1")).markdown).toBe("Spec V1");
    await client.taskDirectMerge("/repo", "task-1", { mergeMethod: "merge_commit" });
    expect((await client.specGet("/repo", "task-1")).markdown).toBe("Spec V2");

    await client.taskDirectMergeComplete("/repo", "task-1");
    expect((await client.specGet("/repo", "task-1")).markdown).toBe("Spec V3");

    await client.taskPullRequestUpsert("/repo", "task-1", "Title", "Body");
    expect((await client.specGet("/repo", "task-1")).markdown).toBe("Spec V4");

    await client.taskPullRequestUnlink("/repo", "task-1");
    expect((await client.specGet("/repo", "task-1")).markdown).toBe("Spec V5");

    await client.taskPullRequestDetect("/repo", "task-1");
    expect((await client.specGet("/repo", "task-1")).markdown).toBe("Spec V6");

    await client.taskPullRequestLinkMerged("/repo", "task-1", {
      providerId: "github",
      number: 17,
      url: "https://github.com/openai/openducktor/pull/17",
      state: "merged",
      createdAt: "2026-02-20T10:00:00Z",
      updatedAt: "2026-02-20T10:00:00Z",
      lastSyncedAt: "2026-02-20T10:00:00Z",
      mergedAt: "2026-02-20T10:00:00Z",
      closedAt: "2026-02-20T10:00:00Z",
    });
    expect((await client.specGet("/repo", "task-1")).markdown).toBe("Spec V7");

    await client.repoPullRequestSync("/repo");
    expect((await client.specGet("/repo", "task-1")).markdown).toBe("Spec V8");

    expect(calls.map((entry) => entry.command)).toEqual([
      "task_metadata_get",
      "task_direct_merge",
      "task_metadata_get",
      "task_direct_merge_complete",
      "task_metadata_get",
      "task_pull_request_upsert",
      "task_metadata_get",
      "task_pull_request_unlink",
      "task_metadata_get",
      "task_pull_request_detect",
      "task_metadata_get",
      "task_pull_request_link_merged",
      "task_metadata_get",
      "repo_pull_request_sync",
      "task_metadata_get",
    ]);
  });

  test("taskDirectMerge invalidates metadata cache for conflict outcomes", async () => {
    let metadataReadCount = 0;
    const { client, calls } = createClient((command) => {
      if (command === "task_metadata_get") {
        metadataReadCount += 1;
        return makeTaskMetadataPayload(`Spec V${metadataReadCount}`);
      }
      if (command === "task_direct_merge") {
        return {
          outcome: "conflicts",
          conflict: {
            operation: "direct_merge_rebase",
            currentBranch: "feature/task-1",
            targetBranch: "origin/main",
            conflictedFiles: ["src/index.ts"],
            output: "CONFLICT (content): Merge conflict in src/index.ts",
            workingDir: "/tmp/wt/task-1",
          },
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    expect((await client.specGet("/repo", "task-1")).markdown).toBe("Spec V1");
    await expect(
      client.taskDirectMerge("/repo", "task-1", { mergeMethod: "merge_commit" }),
    ).resolves.toEqual({
      outcome: "conflicts",
      conflict: {
        operation: "direct_merge_rebase",
        currentBranch: "feature/task-1",
        targetBranch: "origin/main",
        conflictedFiles: ["src/index.ts"],
        output: "CONFLICT (content): Merge conflict in src/index.ts",
        workingDir: "/tmp/wt/task-1",
      },
    });
    expect((await client.specGet("/repo", "task-1")).markdown).toBe("Spec V2");

    expect(calls.map((entry) => entry.command)).toEqual([
      "task_metadata_get",
      "task_direct_merge",
      "task_metadata_get",
    ]);
  });

  test("taskDirectMerge sends structured squash input", async () => {
    const { client, calls } = createClient((command) => {
      if (command === "task_direct_merge") {
        return {
          outcome: "completed",
          task: makeTaskCardPayload(),
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await client.taskDirectMerge("/repo", "task-1", {
      mergeMethod: "squash",
      squashCommitMessage: "feat: add Microsoft login",
    });

    expect(calls).toEqual([
      {
        command: "task_direct_merge",
        args: {
          repoPath: "/repo",
          taskId: "task-1",
          input: {
            mergeMethod: "squash",
            squashCommitMessage: "feat: add Microsoft login",
          },
        },
      },
    ]);
  });

  test("task approval ack commands reject malformed host payloads", async () => {
    const { client } = createClient((command) => {
      if (command === "task_pull_request_unlink") {
        return { ok: "nope" };
      }
      if (command === "repo_pull_request_sync") {
        return {};
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(client.taskPullRequestUnlink("/repo", "task-1")).rejects.toThrow(
      "Expected { ok: boolean } payload from host command task_pull_request_unlink",
    );
    await expect(client.repoPullRequestSync("/repo")).rejects.toThrow(
      "Expected { ok: boolean } payload from host command repo_pull_request_sync",
    );
  });

  test("workspacePrepareTrustedHooksChallenge validates host payload shape", async () => {
    const { client, calls } = createClient((command) => {
      if (command === "workspace_prepare_trusted_hooks_challenge") {
        return {
          nonce: "nonce-1",
          repoPath: "/repo",
          fingerprint: "fp-1",
          expiresAt: "2026-03-15T01:00:00Z",
          preStartCount: 1,
          postCompleteCount: 2,
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(client.workspacePrepareTrustedHooksChallenge("/repo")).resolves.toEqual({
      nonce: "nonce-1",
      repoPath: "/repo",
      fingerprint: "fp-1",
      expiresAt: "2026-03-15T01:00:00Z",
      preStartCount: 1,
      postCompleteCount: 2,
    });
    expect(calls).toEqual([
      {
        command: "workspace_prepare_trusted_hooks_challenge",
        args: {
          repoPath: "/repo",
        },
      },
    ]);
  });

  test("workspacePrepareTrustedHooksChallenge rejects malformed host payloads", async () => {
    const { client } = createClient((command) => {
      if (command === "workspace_prepare_trusted_hooks_challenge") {
        return {
          nonce: "nonce-1",
          repoPath: "/repo",
          fingerprint: "fp-1",
          expiresAt: "2026-03-15T01:00:00Z",
          preStartCount: "1",
          postCompleteCount: 2,
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(client.workspacePrepareTrustedHooksChallenge("/repo")).rejects.toThrow(
      "Expected non-negative integer field 'preStartCount' in trusted hooks challenge payload",
    );
  });
});
