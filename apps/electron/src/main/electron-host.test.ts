import type { GlobalConfig, RepoConfig, RuntimeInstanceSummary } from "@openducktor/contracts";
import {
  type CodexAppServerPort,
  createRuntimeDefinitionsService,
  createRuntimeRegistry,
  type DevServerProcessPort,
  type FilesystemPort,
  type GitPort,
  type HostEventBusPort,
  type LocalAttachmentPort,
  type OpenInToolsPort,
  type RuntimeHealthPort,
  type RuntimeRegistryPort,
  type RuntimeWorkspaceStarterPort,
  type SettingsConfigPort,
  type SystemCommandPort,
  type TaskStorePort,
  type WorktreeFilePort,
} from "@openducktor/host";
import { Effect } from "effect";
import { createElectronHostCommandRouter as createProductionElectronHostCommandRouter } from "./electron-host";

type RuntimeRegistryEntry = RuntimeInstanceSummary;

const createElectronHostCommandRouter = (
  input: Parameters<typeof createProductionElectronHostCommandRouter>[0] = {},
) =>
  createProductionElectronHostCommandRouter({
    processEnv: { PATH: "/usr/bin:/bin" },
    ...input,
  });

const createFilesystem = (): FilesystemPort => ({
  homeDirectory: () => "/home/dev",
  canonicalize: (path) => Effect.succeed(path),
  readDirectory: (path) =>
    Effect.succeed([
      {
        name: "repo",
        path: `${path}/repo`,
      },
    ]),
  stat: (path) =>
    Effect.succeed({
      isDirectory: !path.endsWith("file.txt"),
    }),
  exists: (path) => Effect.succeed(path.endsWith("/repo/.git")),
  join: (...paths) => paths.join("/").replaceAll(/\/+/g, "/"),
  parent: (path) => {
    const parent = path.split("/").slice(0, -1).join("/");
    return parent.length > 0 ? parent : null;
  },
});

const repoConfig = (overrides: Partial<RepoConfig> = {}): RepoConfig => ({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  defaultRuntimeKind: "opencode",
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: { providers: {} },
  hooks: { preStart: [], postComplete: [] },
  devServers: [],
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
  ...overrides,
});

const globalConfig = (overrides: Partial<GlobalConfig> = {}): GlobalConfig => ({
  version: 2,
  theme: "light",
  git: { defaultMergeMethod: "merge_commit" },
  general: { openAgentStudioTabOnBackgroundSessionStart: true },
  chat: { showThinkingMessages: false },
  reusablePrompts: [],
  kanban: { doneVisibleDays: 1, emptyColumnDisplay: "show" },
  autopilot: {
    rules: [
      { eventId: "taskProgressedToSpecReady", actionIds: [] },
      { eventId: "taskProgressedToReadyForDev", actionIds: [] },
      { eventId: "taskProgressedToAiReview", actionIds: [] },
      { eventId: "taskRejectedByQa", actionIds: [] },
      { eventId: "taskProgressedToHumanReview", actionIds: [] },
    ],
  },
  agentRuntimes: {
    opencode: { enabled: true },
    codex: { enabled: false },
  },
  workspaces: {},
  workspaceOrder: [],
  recentWorkspaces: [],
  globalPromptOverrides: {},
  ...overrides,
});

const createSettingsConfig = (config: unknown | null = null): SettingsConfigPort => ({
  readConfig: () => Effect.succeed(config),
  writeConfig: () => Effect.succeed(undefined),
  defaultWorktreeBasePath(workspaceId) {
    return `/home/dev/.openducktor/worktrees/${workspaceId}`;
  },
  defaultRepoWorktreeBasePath(repoPath) {
    return `/home/dev/.openducktor/worktrees/${repoPath.split("/").at(-1) ?? "repo"}-legacy`;
  },
  resolveConfiguredPath(rawPath) {
    return rawPath;
  },
  canonicalizePath: (rawPath) => Effect.succeed(rawPath),
  pathExists: () => Effect.succeed(true),
  join: (...paths) => paths.join("/").replaceAll(/\/+/g, "/"),
});

const createGit = (): GitPort => ({
  canonicalizePath: (path) => Effect.succeed(path),
  isGitRepository: () => Effect.succeed(true),
  shareGitCommonDirectory: () => Effect.succeed(true),
  referenceExists: (_workingDir, reference) => Effect.succeed(reference === "origin/main"),
  configureBranchUpstream: () =>
    Effect.succeed({ createdTrackingRef: "refs/remotes/origin/odt/task-1-task-1" }),
  deleteReference: () => Effect.succeed(undefined),
  listRemotes: () =>
    Effect.succeed([{ name: "origin", url: "git@github.com:openai/openducktor.git" }]),
  listBranches: () => Effect.succeed([{ name: "main", isCurrent: true, isRemote: false }]),
  getCurrentBranch: () => Effect.succeed({ name: "main", detached: false, revision: "abc123" }),
  getStatus: () => Effect.succeed([{ path: "src/main.ts", status: "modified", staged: false }]),
  getDiff: () =>
    Effect.succeed([
      {
        file: "src/main.ts",
        type: "modified",
        additions: 2,
        deletions: 1,
        diff: "@@ -1 +1 @@\n-old\n+new\n",
      },
    ]),
  getWorktreeStatusData: () =>
    Effect.succeed({
      currentBranch: { name: "main", detached: false, revision: "abc123" },
      fileStatuses: [{ path: "src/main.ts", status: "modified", staged: false }],
      fileDiffs: [
        {
          file: "src/main.ts",
          type: "modified",
          additions: 2,
          deletions: 1,
          diff: "@@ -1 +1 @@\n-old\n+new\n",
        },
      ],
      targetAheadBehind: { ahead: 3, behind: 2 },
      upstreamAheadBehind: { outcome: "untracked", ahead: 3 },
    }),
  getWorktreeStatusSummaryData: () =>
    Effect.succeed({
      currentBranch: { name: "main", detached: false, revision: "abc123" },
      fileStatuses: [{ path: "src/main.ts", status: "modified", staged: false }],
      fileStatusCounts: { total: 1, staged: 0, unstaged: 1 },
      targetAheadBehind: { ahead: 3, behind: 2 },
      upstreamAheadBehind: { outcome: "untracked", ahead: 3 },
    }),
  createWorktree: () => Effect.succeed(undefined),
  removeWorktree: () => Effect.succeed(undefined),
  deleteLocalBranch: () => Effect.succeed(undefined),
  isAncestor: () => Effect.succeed(true),
  suggestedSquashCommitMessage: () => Effect.succeed("Ship Electron host"),
  mergeBranch: () =>
    Effect.succeed({
      outcome: "merged",
      output: "Merged",
    }),
  switchBranch: () =>
    Effect.succeed({ name: "feature/electron", detached: false, revision: "def456" }),
  resetWorktreeSelection: () => Effect.succeed({ affectedPaths: ["src/main.ts"] }),
  commitsAheadBehind: () => Effect.succeed({ ahead: 3, behind: 2 }),
  fetchRemote: () => Effect.succeed({ outcome: "fetched", output: "Fetched origin" }),
  pullBranch: () => Effect.succeed({ outcome: "pulled", output: "Fast-forward" }),
  commitAll: () =>
    Effect.succeed({
      outcome: "committed",
      commitHash: "abc123",
      output: "[feature abc123] Ship Electron host",
    }),
  pushBranch: () =>
    Effect.succeed({
      outcome: "pushed",
      remote: "origin",
      branch: "feature/electron",
      output: "Pushed",
    }),
  rebaseBranch: () =>
    Effect.succeed({
      outcome: "rebased",
      output: "Successfully rebased",
    }),
  rebaseAbort: () =>
    Effect.succeed({
      outcome: "aborted",
      output: "Successfully aborted rebase",
    }),
  abortConflict: () =>
    Effect.succeed({
      output: "Conflict operation aborted",
    }),
});

const createOpenInTools = (): OpenInToolsPort => ({
  canonicalizeDirectory: (directoryPath) => Effect.succeed(directoryPath),
  isDirectory: () => Effect.succeed(true),
  discoverOpenInTools: () => Effect.succeed([{ toolId: "finder", iconDataUrl: null }]),
  openDirectoryInTool: () => Effect.succeed(undefined),
  openExternalUrl: () => Effect.succeed(undefined),
});

const createLocalAttachments = (): LocalAttachmentPort => ({
  stageDirectory() {
    return "/tmp/openducktor-local-attachments";
  },
  joinPath(...segments) {
    return segments.join("/").replaceAll(/\/+/g, "/");
  },
  relativePath(from, to) {
    return to.startsWith(`${from}/`) ? to.slice(from.length + 1) : "../outside";
  },
  isAbsolutePath(path) {
    return path.startsWith("/");
  },
  canonicalizePath: (path) => Effect.succeed(path),
  ensureDirectory: () => Effect.succeed(undefined),
  writeFile: () => Effect.succeed(undefined),
  readDirectory: () =>
    Effect.succeed([
      {
        path: "/tmp/openducktor-local-attachments/00000000-0000-0000-0000-000000000000-brief.pdf",
        fileName: "00000000-0000-0000-0000-000000000000-brief.pdf",
      },
    ]),
  modifiedTimeMs: () => Effect.succeed(1),
  exists: () => Effect.succeed(true),
});

const createSystemCommands = (): SystemCommandPort => ({
  requiredCommandError: (command) =>
    Effect.succeed(command === "bd" ? "Required command `bd` not found." : null),
  versionCommand: (command) => Effect.succeed(`${command} version 1.0.0`),
  runCommandAllowFailure: (command) => {
    if (command === "gh") {
      return Effect.succeed({
        ok: true,
        stdout: "Logged in to github.com account octocat\n",
        stderr: "",
      });
    }
    return Effect.succeed({ ok: true, stdout: "", stderr: "" });
  },
});

const createRuntimeHealth = (): RuntimeHealthPort => ({
  getRuntimeHealth: (kind) =>
    Effect.succeed({
      kind,
      enabled: true,
      ok: true,
      version: `${kind} 1.0.0`,
      error: null,
    }),
});

const createTaskStore = (): TaskStorePort => ({
  getTask: () =>
    Effect.succeed({
      id: "task-1",
      title: "Task 1",
      description: "",
      notes: "",
      status: "blocked",
      priority: 2,
      issueType: "task",
      aiReviewEnabled: true,
      availableActions: [],
      labels: [],
      subtaskIds: [],
      documentSummary: {
        spec: { has: false },
        plan: { has: false },
        qaReport: { has: false, verdict: "not_reviewed" },
      },
      agentWorkflows: {
        spec: { required: false, canSkip: true, available: false, completed: false },
        planner: { required: false, canSkip: true, available: false, completed: false },
        builder: { required: true, canSkip: false, available: false, completed: false },
        qa: { required: true, canSkip: false, available: false, completed: false },
      },
      updatedAt: "2026-01-02T00:00:00Z",
      createdAt: "2026-01-01T00:00:00Z",
    }),
  getTaskMetadata: () =>
    Effect.succeed({
      spec: { markdown: "# Spec", updatedAt: "2026-01-02T00:00:00Z", revision: 1 },
      plan: { markdown: "# Plan", updatedAt: "2026-01-02T00:00:00Z", revision: 1 },
      agentSessions: [],
    }),
  createTask: () =>
    Effect.succeed({
      id: "task-2",
      title: "Task 2",
      description: "",
      notes: "",
      status: "open",
      priority: 2,
      issueType: "task",
      aiReviewEnabled: true,
      availableActions: [],
      labels: [],
      subtaskIds: [],
      documentSummary: {
        spec: { has: false },
        plan: { has: false },
        qaReport: { has: false, verdict: "not_reviewed" },
      },
      agentWorkflows: {
        spec: { required: false, canSkip: true, available: false, completed: false },
        planner: { required: false, canSkip: true, available: false, completed: false },
        builder: { required: true, canSkip: false, available: false, completed: false },
        qa: { required: true, canSkip: false, available: false, completed: false },
      },
      updatedAt: "2026-01-02T00:00:00Z",
      createdAt: "2026-01-01T00:00:00Z",
    }),
  listTasks: () =>
    Effect.succeed([
      {
        id: "task-1",
        title: "Task 1",
        description: "",
        notes: "",
        status: "open",
        priority: 2,
        issueType: "task",
        aiReviewEnabled: true,
        availableActions: [],
        labels: [],
        subtaskIds: [],
        documentSummary: {
          spec: { has: false },
          plan: { has: false },
          qaReport: { has: false, verdict: "not_reviewed" },
        },
        agentWorkflows: {
          spec: { required: false, canSkip: true, available: false, completed: false },
          planner: { required: false, canSkip: true, available: false, completed: false },
          builder: { required: true, canSkip: false, available: false, completed: false },
          qa: { required: true, canSkip: false, available: false, completed: false },
        },
        updatedAt: "2026-01-02T00:00:00Z",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ]),
  updateTask: () =>
    Effect.succeed({
      id: "task-1",
      title: "Updated task",
      description: "",
      notes: "",
      status: "ready_for_dev",
      priority: 2,
      issueType: "task",
      aiReviewEnabled: true,
      availableActions: [],
      labels: [],
      subtaskIds: [],
      documentSummary: {
        spec: { has: false },
        plan: { has: false },
        qaReport: { has: false, verdict: "not_reviewed" },
      },
      agentWorkflows: {
        spec: { required: false, canSkip: true, available: false, completed: false },
        planner: { required: false, canSkip: true, available: false, completed: false },
        builder: { required: true, canSkip: false, available: false, completed: false },
        qa: { required: true, canSkip: false, available: false, completed: false },
      },
      updatedAt: "2026-01-02T00:00:00Z",
      createdAt: "2026-01-01T00:00:00Z",
    }),
  setSpecDocument: (input) =>
    Effect.succeed({
      markdown: input.markdown,
      updatedAt: "2026-01-02T00:00:00Z",
      revision: 1,
    }),
  setPlanDocument: (input) =>
    Effect.succeed({
      markdown: input.markdown,
      updatedAt: "2026-01-02T00:00:00Z",
      revision: 1,
    }),
  recordQaOutcome: (input) =>
    Effect.succeed({
      id: input.taskId,
      title: "Task 1",
      description: "",
      notes: "",
      status: input.status,
      priority: 2,
      issueType: "task",
      aiReviewEnabled: true,
      availableActions: [],
      labels: [],
      subtaskIds: [],
      documentSummary: {
        spec: { has: false },
        plan: { has: false },
        qaReport: { has: true, verdict: input.verdict },
      },
      agentWorkflows: {
        spec: { required: false, canSkip: true, available: false, completed: false },
        planner: { required: false, canSkip: true, available: false, completed: false },
        builder: { required: true, canSkip: false, available: false, completed: false },
        qa: {
          required: true,
          canSkip: false,
          available: false,
          completed: input.verdict === "approved",
        },
      },
      updatedAt: "2026-01-02T00:00:00Z",
      createdAt: "2026-01-01T00:00:00Z",
    }),
  upsertAgentSession: () => Effect.succeed(true),
  setPullRequest: () => Effect.succeed(true),
  setDirectMerge: () => Effect.succeed(true),
  clearAgentSessionsByRoles: () => Effect.succeed(true),
  clearWorkflowDocuments: () => Effect.succeed(true),
  clearQaReports: () => Effect.succeed(true),
  transitionTask: (input) =>
    Effect.succeed({
      id: input.taskId,
      title: "Task 1",
      description: "",
      notes: "",
      status: input.status,
      priority: 2,
      issueType: "task",
      aiReviewEnabled: true,
      availableActions: [],
      labels: [],
      subtaskIds: [],
      documentSummary: {
        spec: { has: false },
        plan: { has: false },
        qaReport: { has: false, verdict: "not_reviewed" },
      },
      agentWorkflows: {
        spec: { required: false, canSkip: true, available: false, completed: false },
        planner: { required: false, canSkip: true, available: false, completed: false },
        builder: { required: true, canSkip: false, available: false, completed: false },
        qa: { required: true, canSkip: false, available: false, completed: false },
      },
      updatedAt: "2026-01-02T00:00:00Z",
      createdAt: "2026-01-01T00:00:00Z",
    }),
  deleteTask: () => Effect.succeed(true),
  listPullRequestSyncCandidates: () => Effect.succeed([]),
  diagnoseRepoStore: () =>
    Effect.succeed({
      category: "attachment_verification_failed",
      status: "blocking",
      isReady: false,
      detail: "Required command `bd` not found.",
      attachment: {
        path: null,
        databaseName: null,
      },
      sharedServer: {
        host: null,
        port: null,
        ownershipState: "unavailable",
      },
    }),
});

const createDevServerProcesses = (): DevServerProcessPort => ({
  start: (input) =>
    Effect.sync(() => {
      input.onOutput({ data: "ready\n" });
      return {
        pid: 1234,
        stop() {
          input.onExit({ pid: 1234, exitCode: 0, signal: null, error: null });
          return Effect.succeed(undefined);
        },
      };
    }),
});

const createEventBus = () => {
  const events: unknown[] = [];
  const eventBus: HostEventBusPort = {
    publish(channel, payload) {
      events.push({ channel, payload });
    },
    subscribe() {
      return () => {};
    },
  };
  return { eventBus, events };
};

describe("createElectronHostCommandRouter", () => {
  test("disposes registered runtimes on host shutdown", async () => {
    const stoppedRuntimes: string[] = [];
    const lifecycleLogs: string[] = [];
    const router = createElectronHostCommandRouter({
      lifecycleLogger: {
        info(message) {
          lifecycleLogs.push(message);
        },
        error(message) {
          lifecycleLogs.push(message);
        },
      },
      runtimeRegistry: {
        ensureWorkspaceRuntime: () => Effect.dieMessage("unexpected runtime start"),
        listRuntimes: () =>
          Effect.succeed([
            {
              kind: "opencode",
              runtimeId: "runtime-1",
              repoPath: "/repo",
              taskId: null,
              role: "workspace",
              workingDirectory: "/repo",
              runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:9999" },
              startedAt: "2026-05-13T00:00:00Z",
              descriptor: createRuntimeDefinitionsService().listRuntimeDefinitions()[0],
            },
          ]),
        stopRuntime: (runtimeId) =>
          Effect.sync(() => {
            stoppedRuntimes.push(runtimeId);
            return true;
          }),
        stopSession: () => Effect.succeed(undefined),
      },
      settingsConfig: createSettingsConfig(),
    });

    await expect(router.dispose()).resolves.toBeUndefined();

    expect(stoppedRuntimes).toEqual(["runtime-1"]);
    expect(lifecycleLogs).toEqual(
      expect.arrayContaining([
        "Shutting down OpenDucktor host services",
        "No dev servers are running",
        "Stopping 1 active agent runtime(s)",
        "Stopping opencode runtime runtime-1 for task workspace (workspace)",
        "No MCP host bridge server is running",
        "No shared Dolt server owned by this OpenDucktor process",
        "OpenDucktor host services stopped",
      ]),
    );
  });

  test("registers migrated filesystem host commands", async () => {
    const router = createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(),
    });

    await expect(
      router.invoke("filesystem_list_directory", { path: "/workspace" }),
    ).resolves.toMatchObject({
      currentPath: "/workspace",
      entries: [
        {
          name: "repo",
          isGitRepo: true,
        },
      ],
    });
  });

  test("registers migrated workspace settings host commands", async () => {
    const router = createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(),
    });

    await expect(router.invoke("workspace_list")).resolves.toEqual([]);
    await expect(router.invoke("workspace_get_settings_snapshot")).resolves.toMatchObject({
      theme: "light",
      workspaces: {},
    });
  });

  test("registers migrated local attachment host commands", async () => {
    const router = createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      localAttachments: createLocalAttachments(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(),
    });

    await expect(
      router.invoke("workspace_stage_local_attachment", {
        name: "brief.pdf",
        base64Data: "YnJpZWY=",
      }),
    ).resolves.toMatchObject({
      path: expect.stringContaining("/tmp/openducktor-local-attachments/"),
    });
    await expect(
      router.invoke("workspace_resolve_local_attachment_path", { path: "brief.pdf" }),
    ).resolves.toEqual({
      path: "/tmp/openducktor-local-attachments/00000000-0000-0000-0000-000000000000-brief.pdf",
    });
  });

  test("registers migrated runtime definition host commands", async () => {
    const runtimeStarts: unknown[] = [];
    const opencodeDescriptor = createRuntimeDefinitionsService()
      .listRuntimeDefinitions()
      .find((descriptor) => descriptor.kind === "opencode");
    if (!opencodeDescriptor) {
      throw new Error("OpenCode runtime descriptor missing from test fixture.");
    }
    const workspaceStarter: RuntimeWorkspaceStarterPort = {
      startWorkspaceRuntime: (input) =>
        Effect.sync(() => {
          runtimeStarts.push(input);
          const runtime = {
            kind: "opencode",
            runtimeId: "runtime-1",
            repoPath: input.repoPath,
            taskId: null,
            role: "workspace",
            workingDirectory: input.workingDirectory,
            runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4096" },
            startedAt: "2026-05-10T10:00:00.000Z",
            descriptor: opencodeDescriptor,
          };
          return {
            runtime,
            stop: () => Effect.succeed(undefined),
          };
        }),
    };
    const runtimeRegistry = createRuntimeRegistry({ workspaceStarter });
    const router = createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      runtimeRegistry: {
        ...runtimeRegistry,
        probeMcpStatus: () =>
          Effect.succeed({
            supported: true,
            connected: true,
            serverStatus: "connected",
            toolIds: ["odt_read_task"],
            detail: null,
            failureKind: null,
          }),
      },
      settingsConfig: createSettingsConfig(),
    });

    await expect(router.invoke("runtime_definitions_list", {})).resolves.toMatchObject([
      { kind: "opencode" },
      { kind: "codex" },
    ]);
    await expect(
      router.invoke("runtime_list", { runtimeKind: "opencode", repoPath: "/repo" }),
    ).resolves.toEqual([]);
    await expect(
      router.invoke("runtime_startup_status", {
        runtimeKind: "opencode",
        repoPath: "/repo",
      }),
    ).resolves.toMatchObject({
      runtimeKind: "opencode",
      repoPath: "/repo",
      stage: "idle",
      runtime: null,
    });
    await expect(
      router.invoke("repo_runtime_health_status", {
        runtimeKind: "opencode",
        repoPath: "/repo",
      }),
    ).resolves.toMatchObject({
      status: "not_started",
      runtime: { status: "not_started", stage: "idle" },
      mcp: { status: "waiting_for_runtime" },
    });
    await expect(
      router.invoke("repo_runtime_health", {
        runtimeKind: "opencode",
        repoPath: "/repo",
      }),
    ).resolves.toMatchObject({
      status: "ready",
      runtime: { status: "ready", stage: "runtime_ready" },
      mcp: { status: "connected", toolIds: ["odt_read_task"] },
    });
    await expect(
      router.invoke("runtime_ensure", { runtimeKind: "opencode", repoPath: "/repo" }),
    ).resolves.toMatchObject({
      kind: "opencode",
      repoPath: "/repo",
      role: "workspace",
      workingDirectory: "/repo",
    });
    await expect(
      router.invoke("runtime_list", { runtimeKind: "opencode", repoPath: "/repo" }),
    ).resolves.toMatchObject([{ runtimeId: "runtime-1" }]);
    expect(runtimeStarts).toEqual([
      {
        runtimeKind: "opencode",
        repoPath: "/repo",
        workingDirectory: "/repo",
        descriptor: opencodeDescriptor,
      },
    ]);
    await expect(router.invoke("runtime_stop", { runtimeId: "missing" })).rejects.toThrow(
      "Runtime not found: missing",
    );
  });

  test("registers migrated Codex app-server host commands", async () => {
    const calls: unknown[] = [];
    const codexAppServer: CodexAppServerPort = {
      request: (input) =>
        Effect.sync(() => {
          calls.push({ method: "request", input });
          return { ok: true };
        }),
      drainNotifications: (runtimeId) =>
        Effect.sync(() => {
          calls.push({ method: "drainNotifications", runtimeId });
          return [{ method: "codex/app-server/ready" }];
        }),
      drainServerRequests: (runtimeId) =>
        Effect.sync(() => {
          calls.push({ method: "drainServerRequests", runtimeId });
          return [{ id: 7, method: "approval/request" }];
        }),
      respond: (input) =>
        Effect.sync(() => {
          calls.push({ method: "respond", input });
        }),
    };
    const router = createElectronHostCommandRouter({
      codexAppServer,
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(),
    });

    await expect(
      router.invoke("codex_app_server_request", {
        runtimeId: "runtime-1",
        method: "model/list",
        params: { request: "catalog" },
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      router.invoke("codex_app_server_notifications", { runtimeId: "runtime-1" }),
    ).resolves.toEqual([{ method: "codex/app-server/ready" }]);
    await expect(
      router.invoke("codex_app_server_requests", { runtimeId: "runtime-1" }),
    ).resolves.toEqual([{ id: 7, method: "approval/request" }]);
    await expect(
      router.invoke("codex_app_server_respond", {
        runtimeId: "runtime-1",
        requestId: 7,
        result: { approved: true },
      }),
    ).resolves.toBeUndefined();

    expect(calls).toEqual([
      {
        method: "request",
        input: {
          runtimeId: "runtime-1",
          method: "model/list",
          params: { request: "catalog" },
        },
      },
      { method: "drainNotifications", runtimeId: "runtime-1" },
      { method: "drainServerRequests", runtimeId: "runtime-1" },
      {
        method: "respond",
        input: {
          runtimeId: "runtime-1",
          requestId: 7,
          result: { approved: true },
        },
      },
    ]);
  });

  test("keeps Codex app-server commands fail-fast without a registered transport", async () => {
    const router = createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(),
    });

    await expect(
      router.invoke("codex_app_server_notifications", { runtimeId: "runtime-1" }),
    ).rejects.toThrow("Codex app-server transport not found for runtime runtime-1");
  });

  test("registers migrated passive dev server state command", async () => {
    const { eventBus, events } = createEventBus();
    const router = createElectronHostCommandRouter({
      devServerProcesses: createDevServerProcesses(),
      eventBus,
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(
        globalConfig({
          workspaces: {
            repo: repoConfig({
              devServers: [
                {
                  id: "web",
                  name: "Web",
                  command: "bun run dev",
                },
              ],
            }),
          },
          workspaceOrder: ["repo"],
        }),
      ),
    });

    await expect(
      router.invoke("dev_server_get_state", {
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).resolves.toMatchObject({
      repoPath: "/repo",
      taskId: "task-1",
      worktreePath: "/home/dev/.openducktor/worktrees/repo/task-1",
      scripts: [
        {
          scriptId: "web",
          name: "Web",
          command: "bun run dev",
          status: "stopped",
        },
      ],
    });
    await expect(
      router.invoke("task_worktree_get", {
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).resolves.toEqual({
      workingDirectory: "/home/dev/.openducktor/worktrees/repo/task-1",
    });
    await expect(
      router.invoke("dev_server_start", {
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).resolves.toMatchObject({
      scripts: [
        {
          scriptId: "web",
          status: "running",
          pid: 1234,
        },
      ],
    });
    await expect(
      router.invoke("dev_server_stop", {
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).resolves.toMatchObject({
      scripts: [
        {
          scriptId: "web",
          status: "stopped",
          pid: null,
        },
      ],
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: "openducktor://dev-server-event",
          payload: expect.objectContaining({ type: "snapshot" }),
        }),
      ]),
    );
  });

  test("registers migrated read-only git host commands", async () => {
    const router = createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(),
    });

    await expect(router.invoke("git_get_branches", { repoPath: "/repo" })).resolves.toEqual([
      { name: "main", isCurrent: true, isRemote: false },
    ]);
    await expect(router.invoke("git_get_current_branch", { repoPath: "/repo" })).resolves.toEqual({
      name: "main",
      detached: false,
      revision: "abc123",
    });
    await expect(router.invoke("git_get_status", { repoPath: "/repo" })).resolves.toEqual([
      { path: "src/main.ts", status: "modified", staged: false },
    ]);
    await expect(router.invoke("git_get_diff", { repoPath: "/repo" })).resolves.toEqual([
      {
        file: "src/main.ts",
        type: "modified",
        additions: 2,
        deletions: 1,
        diff: "@@ -1 +1 @@\n-old\n+new\n",
      },
    ]);
    const worktreeStatus = await router.invoke("git_get_worktree_status", {
      repoPath: "/repo",
      targetBranch: "origin/main",
      diffScope: "uncommitted",
    });
    expect(worktreeStatus).toMatchObject({
      currentBranch: { name: "main" },
      fileDiffs: [{ file: "src/main.ts" }],
      snapshot: { targetBranch: "origin/main", diffScope: "uncommitted" },
    });
    await expect(
      router.invoke("git_get_worktree_status_summary", {
        repoPath: "/repo",
        targetBranch: "origin/main",
      }),
    ).resolves.toMatchObject({
      currentBranch: { name: "main" },
      fileStatusCounts: { total: 1, staged: 0, unstaged: 1 },
      snapshot: { targetBranch: "origin/main", diffScope: "target" },
    });
    await expect(
      router.invoke("git_commits_ahead_behind", {
        repoPath: "/repo",
        targetBranch: "origin/main",
      }),
    ).resolves.toEqual({ ahead: 3, behind: 2 });
    await expect(
      router.invoke("git_switch_branch", {
        repoPath: "/repo",
        branch: "feature/electron",
      }),
    ).resolves.toEqual({ name: "feature/electron", detached: false, revision: "def456" });
    await expect(
      router.invoke("git_reset_worktree_selection", {
        repoPath: "/repo",
        targetBranch: "origin/main",
        snapshot: (worktreeStatus as { snapshot: unknown }).snapshot,
        selection: {
          kind: "file",
          filePath: "src/main.ts",
        },
      }),
    ).resolves.toEqual({ affectedPaths: ["src/main.ts"] });
    await expect(
      router.invoke("git_fetch_remote", {
        repoPath: "/repo",
        targetBranch: "origin/main",
      }),
    ).resolves.toEqual({ outcome: "fetched", output: "Fetched origin" });
    await expect(
      router.invoke("git_pull_branch", {
        repoPath: "/repo",
      }),
    ).resolves.toEqual({ outcome: "pulled", output: "Fast-forward" });
    await expect(
      router.invoke("git_commit_all", {
        repoPath: "/repo",
        message: "Ship Electron host",
      }),
    ).resolves.toEqual({
      outcome: "committed",
      commitHash: "abc123",
      output: "[feature abc123] Ship Electron host",
    });
    await expect(
      router.invoke("git_push_branch", {
        repoPath: "/repo",
        branch: "feature/electron",
      }),
    ).resolves.toEqual({
      outcome: "pushed",
      remote: "origin",
      branch: "feature/electron",
      output: "Pushed",
    });
    await expect(
      router.invoke("git_rebase_branch", {
        repoPath: "/repo",
        targetBranch: "origin/main",
      }),
    ).resolves.toEqual({
      outcome: "rebased",
      output: "Successfully rebased",
    });
    await expect(router.invoke("git_rebase_abort", { repoPath: "/repo" })).resolves.toEqual({
      outcome: "aborted",
      output: "Successfully aborted rebase",
    });
    await expect(
      router.invoke("git_abort_conflict", {
        repoPath: "/repo",
        operation: "direct_merge_merge_commit",
      }),
    ).resolves.toEqual({
      output: "Conflict operation aborted",
    });
  });

  test("registers migrated open-in system host commands", async () => {
    const router = createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(),
    });

    await expect(router.invoke("system_list_open_in_tools", {})).resolves.toEqual([
      { toolId: "finder", iconDataUrl: null },
    ]);
    await expect(
      router.invoke("system_open_directory_in_tool", {
        directoryPath: "/repo",
        toolId: "finder",
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      router.invoke("open_external_url", {
        url: "https://example.com",
      }),
    ).resolves.toEqual({ ok: true });
  });

  test("registers migrated GitHub repository detection command", async () => {
    const router = createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(),
    });

    await expect(
      router.invoke("workspace_detect_github_repository", { repoPath: "/repo" }),
    ).resolves.toEqual({
      host: "github.com",
      owner: "openai",
      name: "openducktor",
    });
  });

  test("registers migrated diagnostics host commands", async () => {
    const router = createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      runtimeHealth: createRuntimeHealth(),
      settingsConfig: createSettingsConfig(),
      systemCommands: createSystemCommands(),
    });

    await expect(router.invoke("runtime_check", { force: true })).resolves.toMatchObject({
      gitOk: true,
      ghOk: true,
      ghAuthLogin: "octocat",
      runtimes: [
        { kind: "opencode", ok: true },
        { kind: "codex", ok: true },
      ],
    });
    await expect(router.invoke("beads_check", { repoPath: "/repo" })).resolves.toMatchObject({
      beadsOk: false,
      beadsError: "Required command `bd` not found.",
      repoStoreHealth: { status: "blocking" },
    });
  });

  test("registers migrated task list host command", async () => {
    const router = createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(),
      taskStore: createTaskStore(),
    });

    await expect(router.invoke("tasks_list", { repoPath: "/repo" })).resolves.toMatchObject([
      {
        id: "task-1",
        availableActions: [
          "view_details",
          "set_spec",
          "set_plan",
          "build_start",
          "reset_task",
          "defer_issue",
        ],
      },
    ]);
    await expect(
      router.invoke("task_create", {
        repoPath: "/repo",
        input: { title: "Task 2", issueType: "task", priority: 2 },
      }),
    ).resolves.toMatchObject({
      id: "task-2",
      availableActions: [
        "view_details",
        "set_spec",
        "set_plan",
        "build_start",
        "reset_task",
        "defer_issue",
      ],
    });
    await expect(
      router.invoke("agent_session_upsert", {
        repoPath: "/repo",
        taskId: "task-1",
        session: {
          externalSessionId: "session-1",
          role: "build",
          startedAt: "2026-05-10T10:00:00.000Z",
          runtimeKind: "opencode",
          workingDirectory: "/repo/task-1",
          selectedModel: null,
        },
      }),
    ).resolves.toBe(true);
    await expect(
      router.invoke("task_transition", {
        repoPath: "/repo",
        taskId: "task-1",
        status: "in_progress",
      }),
    ).resolves.toMatchObject({
      id: "task-1",
      status: "in_progress",
      availableActions: expect.arrayContaining(["open_builder"]),
    });
    await expect(
      router.invoke("task_metadata_get", {
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).resolves.toEqual({
      spec: { markdown: "# Spec", updatedAt: "2026-01-02T00:00:00Z", revision: 1 },
      plan: { markdown: "# Plan", updatedAt: "2026-01-02T00:00:00Z", revision: 1 },
      agentSessions: [],
    });
    await expect(
      router.invoke("spec_get", { repoPath: "/repo", taskId: "task-1" }),
    ).resolves.toEqual({ markdown: "# Spec", updatedAt: "2026-01-02T00:00:00Z", revision: 1 });
    await expect(
      router.invoke("plan_get", { repoPath: "/repo", taskId: "task-1" }),
    ).resolves.toEqual({ markdown: "# Plan", updatedAt: "2026-01-02T00:00:00Z", revision: 1 });
    await expect(
      router.invoke("qa_get_report", { repoPath: "/repo", taskId: "task-1" }),
    ).resolves.toEqual({ markdown: "" });
    await expect(
      router.invoke("agent_sessions_list", {
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).resolves.toEqual([]);
    await expect(
      router.invoke("agent_sessions_list_bulk", {
        repoPath: "/repo",
        taskIds: ["task-1"],
      }),
    ).resolves.toEqual({ "task-1": [] });

    const stoppedSessions: unknown[] = [];
    const opencodeDescriptor = createRuntimeDefinitionsService()
      .listRuntimeDefinitions()
      .find((descriptor) => descriptor.kind === "opencode");
    if (!opencodeDescriptor) {
      throw new Error("OpenCode runtime descriptor missing from test fixture.");
    }
    const sessionRuntime: RuntimeRegistryEntry = {
      kind: "opencode",
      runtimeId: "runtime-1",
      repoPath: "/repo",
      taskId: null,
      role: "workspace",
      workingDirectory: "/repo/worktree",
      runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4096" },
      startedAt: "2026-05-10T10:00:00.000Z",
      descriptor: opencodeDescriptor,
    };
    const sessionRuntimeRegistry: RuntimeRegistryPort = {
      ensureWorkspaceRuntime: () => Effect.dieMessage("unexpected runtime ensure"),
      listRuntimes: () => Effect.succeed([sessionRuntime]),
      stopRuntime: () => Effect.dieMessage("unexpected runtime stop"),
      stopSession: (input) =>
        Effect.sync(() => {
          stoppedSessions.push(input);
        }),
    };
    const sessionTaskStore = createTaskStore();
    const sessionStopRouter = createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      runtimeRegistry: sessionRuntimeRegistry,
      settingsConfig: createSettingsConfig(),
      taskStore: {
        ...sessionTaskStore,
        getTaskMetadata: () =>
          Effect.succeed({
            spec: { markdown: "# Spec", updatedAt: "2026-01-02T00:00:00Z", revision: 1 },
            plan: { markdown: "# Plan", updatedAt: "2026-01-02T00:00:00Z", revision: 1 },
            agentSessions: [
              {
                externalSessionId: "external-session-1",
                role: "build" as const,
                startedAt: "2026-05-10T10:00:00.000Z",
                runtimeKind: "opencode",
                workingDirectory: "/repo/worktree",
                selectedModel: null,
              },
            ],
          }),
      },
    });
    await expect(
      sessionStopRouter.invoke("agent_session_stop", {
        request: {
          repoPath: "/repo",
          taskId: "task-1",
          externalSessionId: "external-session-1",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
        },
      }),
    ).resolves.toEqual({ ok: true });
    expect(stoppedSessions).toEqual([
      {
        runtimeKind: "opencode",
        runtimeRoute: sessionRuntime.runtimeRoute,
        externalSessionId: "external-session-1",
        workingDirectory: "/repo/worktree",
      },
    ]);

    await expect(
      router.invoke("set_spec", {
        repoPath: "/repo",
        taskId: "task-1",
        markdown: "# Spec",
      }),
    ).resolves.toEqual({
      markdown: "# Spec",
      updatedAt: "2026-01-02T00:00:00Z",
      revision: 1,
    });
    await expect(
      router.invoke("spec_save_document", {
        repoPath: "/repo",
        taskId: "task-1",
        markdown: "# Spec v2",
      }),
    ).resolves.toEqual({
      markdown: "# Spec v2",
      updatedAt: "2026-01-02T00:00:00Z",
      revision: 1,
    });
    await expect(
      router.invoke("set_plan", {
        repoPath: "/repo",
        taskId: "task-1",
        input: { markdown: "# Plan" },
      }),
    ).resolves.toEqual({
      markdown: "# Plan",
      updatedAt: "2026-01-02T00:00:00Z",
      revision: 1,
    });
    await expect(
      router.invoke("plan_save_document", {
        repoPath: "/repo",
        taskId: "task-1",
        markdown: "# Plan v2",
      }),
    ).resolves.toEqual({
      markdown: "# Plan v2",
      updatedAt: "2026-01-02T00:00:00Z",
      revision: 1,
    });
    const deleteRouter = createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(
        globalConfig({
          workspaces: { repo: repoConfig() },
          workspaceOrder: ["repo"],
        }),
      ),
      taskStore: createTaskStore(),
    });
    await expect(
      deleteRouter.invoke("task_delete", { repoPath: "/repo", taskId: "task-1" }),
    ).resolves.toEqual({ ok: true });
    await expect(
      deleteRouter.invoke("task_reset", { repoPath: "/repo", taskId: "task-1" }),
    ).resolves.toMatchObject({ id: "task-1", status: "open" });
    const resetImplementationTaskStore = createTaskStore();
    const resetImplementationRouter = createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(
        globalConfig({
          workspaces: { repo: repoConfig() },
          workspaceOrder: ["repo"],
        }),
      ),
      taskStore: {
        ...resetImplementationTaskStore,
        listTasks: (input) =>
          resetImplementationTaskStore.listTasks(input).pipe(
            Effect.map((entries) =>
              entries.map((entry) => ({
                ...entry,
                status: "ai_review" as const,
                documentSummary: {
                  ...entry.documentSummary,
                  plan: { has: true, updatedAt: "2026-01-02T00:00:00Z" },
                },
              })),
            ),
          ),
      },
    });
    await expect(
      resetImplementationRouter.invoke("task_reset_implementation", {
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).resolves.toMatchObject({ id: "task-1", status: "ready_for_dev" });
    const pullRequestTaskStore = createTaskStore();
    const pullRequestRouter = createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(),
      taskStore: {
        ...pullRequestTaskStore,
        getTask: (input) =>
          pullRequestTaskStore
            .getTask(input)
            .pipe(Effect.map((task) => ({ ...task, status: "human_review" }))),
        getTaskMetadata: () =>
          Effect.succeed({
            spec: { markdown: "# Spec" },
            plan: { markdown: "# Plan" },
            pullRequest: {
              providerId: "github" as const,
              number: 42,
              url: "https://github.com/openai/openducktor/pull/42",
              state: "open" as const,
              createdAt: "2026-05-01T00:00:00.000Z",
              updatedAt: "2026-05-02T00:00:00.000Z",
            },
            agentSessions: [],
          }),
      },
    });
    await expect(
      pullRequestRouter.invoke("task_pull_request_unlink", {
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).resolves.toBe(true);

    const approvalRouter = createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(
        globalConfig({
          workspaces: {
            repo: repoConfig({
              git: {
                providers: {
                  github: {
                    enabled: true,
                    repository: {
                      host: "github.com",
                      owner: "openai",
                      name: "openducktor",
                    },
                    autoDetected: false,
                  },
                },
              },
            }),
          },
          workspaceOrder: ["repo"],
        }),
      ),
      systemCommands: createSystemCommands(),
      taskStore: {
        ...createTaskStore(),
        getTask: (input) =>
          createTaskStore()
            .getTask(input)
            .pipe(Effect.map((task) => ({ ...task, status: "human_review" }))),
      },
    });
    await expect(
      approvalRouter.invoke("task_approval_context_get", {
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).resolves.toMatchObject({
      outcome: "ready",
      approvalContext: {
        taskId: "task-1",
        taskStatus: "human_review",
        sourceBranch: "main",
        targetBranch: { remote: "origin", branch: "main" },
        hasUncommittedChanges: true,
        uncommittedFileCount: 1,
        providers: [{ providerId: "github", enabled: true, available: true }],
      },
    });

    const detectPullRequestRouter = createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(
        globalConfig({
          workspaces: {
            repo: repoConfig({
              git: {
                providers: {
                  github: {
                    enabled: true,
                    repository: {
                      host: "github.com",
                      owner: "openai",
                      name: "openducktor",
                    },
                    autoDetected: false,
                  },
                },
              },
            }),
          },
          workspaceOrder: ["repo"],
        }),
      ),
      systemCommands: {
        ...createSystemCommands(),
        runCommandAllowFailure: (_command, args) => {
          if (args.includes("auth")) {
            return Effect.succeed({
              ok: true,
              stdout: "Logged in to github.com account octocat\n",
              stderr: "",
            });
          }
          return Effect.succeed({
            ok: true,
            stdout: JSON.stringify([
              {
                number: 42,
                html_url: "https://github.com/openai/openducktor/pull/42",
                draft: false,
                state: "open",
                created_at: "2026-05-10T09:00:00.000Z",
                updated_at: "2026-05-10T10:00:00.000Z",
                merged_at: null,
                closed_at: null,
                head: { ref: "main" },
                base: { ref: "main" },
              },
            ]),
            stderr: "",
          });
        },
      },
      taskStore: {
        ...createTaskStore(),
        getTask: (input) =>
          createTaskStore()
            .getTask(input)
            .pipe(Effect.map((task) => ({ ...task, status: "human_review" }))),
      },
    });
    await expect(
      detectPullRequestRouter.invoke("task_pull_request_detect", {
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).resolves.toMatchObject({
      outcome: "linked",
      pullRequest: {
        providerId: "github",
        number: 42,
        state: "open",
      },
    });

    const upsertPullRequestRouter = createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: {
        ...createGit(),
        getWorktreeStatusSummaryData: () =>
          Effect.succeed({
            currentBranch: { name: "main", detached: false, revision: "abc123" },
            fileStatuses: [],
            fileStatusCounts: { total: 0, staged: 0, unstaged: 0 },
            targetAheadBehind: { ahead: 3, behind: 2 },
            upstreamAheadBehind: { outcome: "untracked", ahead: 3 },
          }),
      },
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(
        globalConfig({
          workspaces: {
            repo: repoConfig({
              git: {
                providers: {
                  github: {
                    enabled: true,
                    repository: {
                      host: "github.com",
                      owner: "openai",
                      name: "openducktor",
                    },
                    autoDetected: false,
                  },
                },
              },
            }),
          },
          workspaceOrder: ["repo"],
        }),
      ),
      systemCommands: {
        ...createSystemCommands(),
        runCommandAllowFailure: (_command, args) => {
          if (args.includes("auth")) {
            return Effect.succeed({
              ok: true,
              stdout: "Logged in to github.com account octocat\n",
              stderr: "",
            });
          }
          return Effect.succeed({
            ok: true,
            stdout: JSON.stringify({
              number: 77,
              html_url: "https://github.com/openai/openducktor/pull/77",
              draft: false,
              state: "open",
              created_at: "2026-05-10T09:00:00.000Z",
              updated_at: "2026-05-10T10:00:00.000Z",
              merged_at: null,
              closed_at: null,
              head: { ref: "main" },
              base: { ref: "main" },
            }),
            stderr: "",
          });
        },
      },
      taskStore: {
        ...createTaskStore(),
        getTask: (input) =>
          createTaskStore()
            .getTask(input)
            .pipe(Effect.map((task) => ({ ...task, status: "human_review" }))),
      },
    });
    await expect(
      upsertPullRequestRouter.invoke("task_pull_request_upsert", {
        repoPath: "/repo",
        taskId: "task-1",
        input: { title: "Create PR", body: "Body" },
      }),
    ).resolves.toMatchObject({
      providerId: "github",
      number: 77,
      state: "open",
    });

    const pullRequestSyncRouter = createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(
        globalConfig({
          workspaces: {
            repo: repoConfig({
              git: {
                providers: {
                  github: {
                    enabled: true,
                    repository: {
                      host: "github.com",
                      owner: "openai",
                      name: "openducktor",
                    },
                    autoDetected: false,
                  },
                },
              },
            }),
          },
          workspaceOrder: ["repo"],
        }),
      ),
      systemCommands: {
        ...createSystemCommands(),
        runCommandAllowFailure: () =>
          Effect.succeed({
            ok: true,
            stdout: JSON.stringify({
              number: 42,
              html_url: "https://github.com/openai/openducktor/pull/42",
              draft: false,
              state: "open",
              created_at: "2026-05-10T09:00:00.000Z",
              updated_at: "2026-05-10T10:00:00.000Z",
              merged_at: null,
              closed_at: null,
              head: { ref: "main" },
              base: { ref: "main" },
            }),
            stderr: "",
          }),
      },
      taskStore: {
        ...createTaskStore(),
        listPullRequestSyncCandidates: () =>
          Effect.succeed([
            {
              id: "task-1",
              title: "Task 1",
              description: "",
              notes: "",
              status: "human_review",
              priority: 2,
              issueType: "task",
              aiReviewEnabled: true,
              availableActions: [],
              labels: [],
              subtaskIds: [],
              pullRequest: {
                providerId: "github",
                number: 42,
                url: "https://github.com/openai/openducktor/pull/42",
                state: "open",
                createdAt: "2026-05-01T00:00:00.000Z",
                updatedAt: "2026-05-02T00:00:00.000Z",
              },
              documentSummary: {
                spec: { has: false },
                plan: { has: false },
                qaReport: { has: false, verdict: "not_reviewed" },
              },
              agentWorkflows: {
                spec: { required: false, canSkip: true, available: false, completed: false },
                planner: { required: false, canSkip: true, available: false, completed: false },
                builder: { required: true, canSkip: false, available: false, completed: false },
                qa: { required: true, canSkip: false, available: false, completed: false },
              },
              updatedAt: "2026-01-02T00:00:00Z",
              createdAt: "2026-01-01T00:00:00Z",
            },
          ]),
      },
    });
    await expect(
      pullRequestSyncRouter.invoke("repo_pull_request_sync", {
        repoPath: "/repo",
      }),
    ).resolves.toEqual({ ok: true });

    const reviewRouter = createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(),
      taskStore: {
        ...createTaskStore(),
        getTaskMetadata: () =>
          Effect.succeed({
            spec: { markdown: "# Spec" },
            plan: { markdown: "# Plan" },
            agentSessions: [],
          }),
        getTask: () =>
          Effect.succeed({
            id: "task-1",
            title: "Task 1",
            description: "",
            notes: "",
            status: "human_review",
            priority: 2,
            issueType: "task",
            aiReviewEnabled: true,
            availableActions: [],
            labels: [],
            subtaskIds: [],
            documentSummary: {
              spec: { has: false },
              plan: { has: false },
              qaReport: { has: false, verdict: "not_reviewed" },
            },
            agentWorkflows: {
              spec: { required: false, canSkip: true, available: false, completed: false },
              planner: { required: false, canSkip: true, available: false, completed: false },
              builder: { required: true, canSkip: false, available: false, completed: false },
              qa: { required: true, canSkip: false, available: false, completed: false },
            },
            updatedAt: "2026-01-02T00:00:00Z",
            createdAt: "2026-01-01T00:00:00Z",
          }),
        listTasks: () =>
          Effect.succeed([
            {
              id: "task-1",
              title: "Task 1",
              description: "",
              notes: "",
              status: "human_review",
              priority: 2,
              issueType: "task",
              aiReviewEnabled: true,
              availableActions: [],
              labels: [],
              subtaskIds: [],
              documentSummary: {
                spec: { has: false },
                plan: { has: false },
                qaReport: { has: false, verdict: "not_reviewed" },
              },
              agentWorkflows: {
                spec: { required: false, canSkip: true, available: false, completed: false },
                planner: { required: false, canSkip: true, available: false, completed: false },
                builder: { required: true, canSkip: false, available: false, completed: false },
                qa: { required: true, canSkip: false, available: false, completed: false },
              },
              updatedAt: "2026-01-02T00:00:00Z",
              createdAt: "2026-01-01T00:00:00Z",
            },
          ]),
      },
    });
    await expect(
      reviewRouter.invoke("qa_approved", {
        repoPath: "/repo",
        taskId: "task-1",
        reportMarkdown: "Looks good",
      }),
    ).resolves.toMatchObject({
      id: "task-1",
      status: "human_review",
      agentWorkflows: { qa: { completed: true } },
    });
    await expect(
      reviewRouter.invoke("qa_rejected", {
        repoPath: "/repo",
        taskId: "task-1",
        reportMarkdown: "Needs work",
      }),
    ).resolves.toMatchObject({
      id: "task-1",
      status: "in_progress",
    });
    await expect(
      reviewRouter.invoke("human_request_changes", {
        repoPath: "/repo",
        taskId: "task-1",
        note: "Please adjust",
      }),
    ).resolves.toMatchObject({
      id: "task-1",
      status: "in_progress",
    });
    await expect(
      reviewRouter.invoke("human_approve", {
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).resolves.toMatchObject({
      id: "task-1",
      status: "closed",
    });

    const directMergeStartRouter = createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: {
        ...createGit(),
        getWorktreeStatusSummaryData: () =>
          Effect.succeed({
            currentBranch: { name: "odt/task-1", detached: false, revision: "abc123" },
            fileStatuses: [],
            fileStatusCounts: { total: 0, staged: 0, unstaged: 0 },
            targetAheadBehind: { ahead: 1, behind: 0 },
            upstreamAheadBehind: { outcome: "untracked", ahead: 1 },
          }),
      },
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(
        globalConfig({
          workspaces: { repo: repoConfig() },
          workspaceOrder: ["repo"],
        }),
      ),
      taskStore: {
        ...createTaskStore(),
        listTasks: () =>
          Effect.succeed([
            {
              id: "task-1",
              title: "Task 1",
              description: "",
              notes: "",
              status: "ai_review",
              priority: 2,
              issueType: "task",
              aiReviewEnabled: true,
              availableActions: [],
              labels: [],
              subtaskIds: [],
              documentSummary: {
                spec: { has: false },
                plan: { has: false },
                qaReport: { has: false, verdict: "not_reviewed" },
              },
              agentWorkflows: {
                spec: { required: false, canSkip: true, available: false, completed: false },
                planner: { required: false, canSkip: true, available: false, completed: false },
                builder: { required: true, canSkip: false, available: false, completed: false },
                qa: { required: true, canSkip: false, available: false, completed: false },
              },
              updatedAt: "2026-01-02T00:00:00Z",
              createdAt: "2026-01-01T00:00:00Z",
            },
          ]),
      },
    });
    await expect(
      directMergeStartRouter.invoke("task_direct_merge", {
        repoPath: "/repo",
        taskId: "task-1",
        input: { mergeMethod: "merge_commit" },
      }),
    ).resolves.toMatchObject({
      outcome: "completed",
      task: { id: "task-1", status: "human_review" },
    });

    await expect(
      router.invoke("build_resumed", {
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).resolves.toMatchObject({
      id: "task-1",
      status: "in_progress",
      availableActions: expect.arrayContaining(["open_builder"]),
    });

    const completionRouter = createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(
        globalConfig({
          workspaces: {
            repo: repoConfig({
              hooks: { preStart: [], postComplete: [] },
            }),
          },
          workspaceOrder: ["repo"],
        }),
      ),
      systemCommands: createSystemCommands(),
      taskStore: {
        ...createTaskStore(),
        listTasks: () =>
          Effect.succeed([
            {
              id: "task-1",
              title: "Task 1",
              description: "",
              notes: "",
              status: "in_progress",
              priority: 2,
              issueType: "task",
              aiReviewEnabled: true,
              availableActions: [],
              labels: [],
              subtaskIds: [],
              documentSummary: {
                spec: { has: false },
                plan: { has: false },
                qaReport: { has: false, verdict: "not_reviewed" },
              },
              agentWorkflows: {
                spec: { required: false, canSkip: true, available: false, completed: false },
                planner: { required: false, canSkip: true, available: false, completed: false },
                builder: { required: true, canSkip: false, available: false, completed: false },
                qa: { required: true, canSkip: false, available: false, completed: false },
              },
              updatedAt: "2026-01-02T00:00:00Z",
              createdAt: "2026-01-01T00:00:00Z",
            },
          ]),
      },
    });
    await expect(
      completionRouter.invoke("build_completed", {
        repoPath: "/repo",
        taskId: "task-1",
        input: { summary: "Done" },
      }),
    ).resolves.toMatchObject({
      id: "task-1",
      status: "ai_review",
      availableActions: expect.arrayContaining(["qa_start"]),
    });

    const directMergeRouter = createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(
        globalConfig({
          workspaces: {
            repo: repoConfig(),
          },
          workspaceOrder: ["repo"],
        }),
      ),
      taskStore: {
        ...createTaskStore(),
        listTasks: () =>
          Effect.succeed([
            {
              id: "task-1",
              title: "Task 1",
              description: "",
              notes: "",
              status: "human_review",
              priority: 2,
              issueType: "task",
              aiReviewEnabled: true,
              availableActions: [],
              labels: [],
              subtaskIds: [],
              documentSummary: {
                spec: { has: false },
                plan: { has: false },
                qaReport: { has: false, verdict: "not_reviewed" },
              },
              agentWorkflows: {
                spec: { required: false, canSkip: true, available: false, completed: false },
                planner: { required: false, canSkip: true, available: false, completed: false },
                builder: { required: true, canSkip: false, available: false, completed: false },
                qa: { required: true, canSkip: false, available: false, completed: false },
              },
              updatedAt: "2026-01-02T00:00:00Z",
              createdAt: "2026-01-01T00:00:00Z",
            },
          ]),
        getTaskMetadata: () =>
          Effect.succeed({
            spec: { markdown: "# Spec" },
            plan: { markdown: "# Plan" },
            directMerge: {
              method: "merge_commit" as const,
              sourceBranch: "odt/task-1",
              targetBranch: { branch: "main" },
              mergedAt: "2026-05-10T11:00:00.000Z",
            },
            agentSessions: [],
          }),
      },
    });
    await expect(
      directMergeRouter.invoke("task_direct_merge_complete", {
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).resolves.toMatchObject({
      id: "task-1",
      status: "closed",
    });

    const mergedPullRequestRouter = createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(
        globalConfig({
          workspaces: {
            repo: repoConfig(),
          },
          workspaceOrder: ["repo"],
        }),
      ),
      taskStore: {
        ...createTaskStore(),
        listTasks: () =>
          Effect.succeed([
            {
              id: "task-1",
              title: "Task 1",
              description: "",
              notes: "",
              status: "human_review",
              priority: 2,
              issueType: "task",
              aiReviewEnabled: true,
              availableActions: [],
              labels: [],
              subtaskIds: [],
              documentSummary: {
                spec: { has: false },
                plan: { has: false },
                qaReport: { has: false, verdict: "not_reviewed" },
              },
              agentWorkflows: {
                spec: { required: false, canSkip: true, available: false, completed: false },
                planner: { required: false, canSkip: true, available: false, completed: false },
                builder: { required: true, canSkip: false, available: false, completed: false },
                qa: { required: true, canSkip: false, available: false, completed: false },
              },
              updatedAt: "2026-01-02T00:00:00Z",
              createdAt: "2026-01-01T00:00:00Z",
            },
          ]),
      },
    });
    await expect(
      mergedPullRequestRouter.invoke("task_pull_request_link_merged", {
        repoPath: "/repo",
        taskId: "task-1",
        pullRequest: {
          providerId: "github",
          number: 12,
          url: "https://github.com/acme/repo/pull/12",
          state: "merged",
          createdAt: "2026-05-10T10:00:00.000Z",
          updatedAt: "2026-05-10T11:00:00.000Z",
          mergedAt: "2026-05-10T11:00:00.000Z",
        },
      }),
    ).resolves.toMatchObject({
      id: "task-1",
      status: "closed",
    });

    await expect(
      router.invoke("task_defer", {
        repoPath: "/repo",
        taskId: "task-1",
        reason: "Later",
      }),
    ).resolves.toMatchObject({
      id: "task-1",
      status: "deferred",
      availableActions: expect.arrayContaining(["resume_deferred"]),
    });

    const blockRouter = createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(),
      taskStore: {
        ...createTaskStore(),
        listTasks: () =>
          Effect.succeed([
            {
              id: "task-1",
              title: "Task 1",
              description: "",
              notes: "",
              status: "in_progress",
              priority: 2,
              issueType: "task",
              aiReviewEnabled: true,
              availableActions: [],
              labels: [],
              subtaskIds: [],
              documentSummary: {
                spec: { has: false },
                plan: { has: false },
                qaReport: { has: false, verdict: "not_reviewed" },
              },
              agentWorkflows: {
                spec: { required: false, canSkip: true, available: false, completed: false },
                planner: { required: false, canSkip: true, available: false, completed: false },
                builder: { required: true, canSkip: false, available: false, completed: false },
                qa: { required: true, canSkip: false, available: false, completed: false },
              },
              updatedAt: "2026-01-02T00:00:00Z",
              createdAt: "2026-01-01T00:00:00Z",
            },
          ]),
      },
    });
    await expect(
      blockRouter.invoke("build_blocked", {
        repoPath: "/repo",
        taskId: "task-1",
        reason: "Blocked by dependency",
      }),
    ).resolves.toMatchObject({
      id: "task-1",
      status: "blocked",
      availableActions: expect.arrayContaining(["open_builder"]),
    });
    await expect(
      router.invoke("task_update", {
        repoPath: "/repo",
        taskId: "task-1",
        patch: { title: "Updated task" },
      }),
    ).resolves.toMatchObject({
      id: "task-1",
      title: "Updated task",
      availableActions: [
        "view_details",
        "set_spec",
        "set_plan",
        "build_start",
        "reset_task",
        "defer_issue",
      ],
    });

    const resumeRouter = createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(),
      taskStore: {
        ...createTaskStore(),
        listTasks: () =>
          Effect.succeed([
            {
              id: "task-1",
              title: "Task 1",
              description: "",
              notes: "",
              status: "deferred",
              priority: 2,
              issueType: "task",
              aiReviewEnabled: true,
              availableActions: [],
              labels: [],
              subtaskIds: [],
              documentSummary: {
                spec: { has: false },
                plan: { has: false },
                qaReport: { has: false, verdict: "not_reviewed" },
              },
              agentWorkflows: {
                spec: { required: false, canSkip: true, available: false, completed: false },
                planner: { required: false, canSkip: true, available: false, completed: false },
                builder: { required: true, canSkip: false, available: false, completed: false },
                qa: { required: true, canSkip: false, available: false, completed: false },
              },
              updatedAt: "2026-01-02T00:00:00Z",
              createdAt: "2026-01-01T00:00:00Z",
            },
          ]),
      },
    });
    await expect(
      resumeRouter.invoke("task_resume_deferred", {
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).resolves.toMatchObject({
      id: "task-1",
      status: "open",
      availableActions: expect.arrayContaining(["defer_issue"]),
    });
  });

  test("registers migrated build start host command", async () => {
    const config = globalConfig({
      workspaces: { repo: repoConfig() },
      workspaceOrder: ["repo"],
    });
    const settingsConfig: SettingsConfigPort = {
      ...createSettingsConfig(config),
      pathExists: (path) => Effect.succeed(path === "/repo"),
    };
    const runtimeRegistry: RuntimeRegistryPort = {
      ensureWorkspaceRuntime: (input) =>
        Effect.succeed({
          kind: input.runtimeKind,
          runtimeId: "runtime-1",
          repoPath: input.repoPath,
          taskId: null,
          role: "workspace",
          workingDirectory: input.workingDirectory,
          runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4096" },
          startedAt: "2026-05-10T10:00:00.000Z",
          descriptor: input.descriptor,
        }),
      listRuntimes: () => Effect.succeed([]),
      stopRuntime: () => Effect.succeed(false),
      stopSession: () => Effect.succeed(undefined),
    };
    const worktreeFiles: WorktreeFilePort = {
      ensureDirectory: () => Effect.succeed(undefined),
      copyConfiguredPaths: () => Effect.succeed(undefined),
      removePathIfPresent: () => Effect.succeed(undefined),
      resolveWorktreePath(_repoPath, worktreePath) {
        return worktreePath;
      },
      pathIsWithinRoot: () => Effect.succeed(true),
    };
    const router = createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      runtimeRegistry,
      settingsConfig,
      taskStore: createTaskStore(),
      worktreeFiles,
    });

    await expect(
      router.invoke("build_start", {
        repoPath: "/repo",
        taskId: "task-1",
        runtimeKind: "opencode",
      }),
    ).resolves.toEqual({
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      workingDirectory: "/home/dev/.openducktor/worktrees/repo/task-1",
    });
  });
});
