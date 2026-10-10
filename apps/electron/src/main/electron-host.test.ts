import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_AGENT_RUNTIMES,
  type GlobalConfig,
  type HostRuntimeStatus,
  hostRuntimeSnapshotSchema,
  type RepoConfig,
  type RuntimeKind,
  type RuntimeRoute,
  runtimeLifecycleImpactSchema,
  type TaskCard,
  type TaskMetadataPayload,
} from "@openducktor/contracts";
import {
  createArtifactRuntimeDistribution,
  createHostEventBus,
  createRuntimeDefinitionsService,
  Effect,
  type FilesystemPort,
  type GitPort,
  type LocalAttachmentPort,
  type OpenInToolsPort,
  ProcessEnvironmentError,
  type RuntimeHealthPort,
  type RuntimeStarterPort,
  type SettingsConfigPort,
  type SystemCommandPort,
  type TaskStorePort,
  type WorktreeFilePort,
} from "@openducktor/host";
import {
  createElectronEffectHostCommandRouter,
  createElectronHostCommandRouter as createProductionElectronHostCommandRouter,
} from "./electron-host";
import { HostOperationError } from "../../../../packages/host/src/effect/host-errors";
import { createFakeOpenCodeV2 } from "../../../../packages/host/src/test-support/opencode-v2-standalone";

type ElectronHostCommandRouterInput = Parameters<
  typeof createProductionElectronHostCommandRouter
>[0];

const testRuntimeDistribution = createArtifactRuntimeDistribution({
  mcpLauncher: {
    kind: "executable",
    executablePath: process.execPath,
  },
});

const createElectronHostCommandRouter = (input: Partial<ElectronHostCommandRouterInput> = {}) => {
  const defaultEnvironment = input.processEnvironmentInput
    ? {}
    : {
        processEnv: {
          OPENDUCKTOR_DEV_INSTANCE: "electron-0123456789ab",
          PATH: "/usr/bin:/bin",
        },
      };
  return createProductionElectronHostCommandRouter({
    isPackaged: false,
    onBackgroundFailure: () => Effect.void,
    ...defaultEnvironment,
    runtimeDistribution: testRuntimeDistribution,
    ...input,
  });
};

const pathFailure = (
  error: ProcessEnvironmentError,
  baseEnv: NodeJS.ProcessEnv = {},
): NonNullable<ElectronHostCommandRouterInput["processEnvironmentInput"]> => ({
  baseEnv: {
    HOME: "/home/dev",
    OPENDUCKTOR_DEV_INSTANCE: "electron-0123456789ab",
    PATH: "/usr/bin:/bin",
    ...baseEnv,
  },
  platform: "linux",
  readLoginShellPath: () => Effect.fail(error),
  readUserShell: () => process.execPath,
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
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {},
  hooks: { postComplete: [] },
  actions: { items: [], defaultActionId: null },
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
  ...overrides,
});

/** Saved runtime settings that enable the given kinds. */
const agentRuntimes = (
  enabled: Partial<Record<RuntimeKind, boolean>>,
): GlobalConfig["agentRuntimes"] => ({
  ...DEFAULT_AGENT_RUNTIMES,
  opencode: { enabled: enabled.opencode ?? false, executablePath: "opencode" },
  codex: {
    ...DEFAULT_AGENT_RUNTIMES.codex,
    enabled: enabled.codex ?? false,
    executablePath: "codex",
  },
  claude: { enabled: enabled.claude ?? false, executablePath: "claude" },
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
    alwaysStartQaReviewsFresh: false,
    rules: [
      { eventId: "taskProgressedToSpecReady", actionIds: [] },
      { eventId: "taskProgressedToReadyForDev", actionIds: [] },
      { eventId: "taskProgressedToAiReview", actionIds: [] },
      { eventId: "taskRejectedByQa", actionIds: [] },
      { eventId: "taskProgressedToHumanReview", actionIds: [] },
    ],
  },
  agentRuntimes: agentRuntimes({ opencode: true }),
  workspaces: {},
  workspaceOrder: [],
  recentWorkspaces: [],
  globalPromptOverrides: {},
  ...overrides,
});

const createSettingsConfig = (config: GlobalConfig | null = null): SettingsConfigPort => ({
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
  releaseReadCaptures: () => Effect.void,
  canonicalizePath: (path) => Effect.succeed(path),
  isGitRepository: () => Effect.succeed(true),
  shareGitCommonDirectory: () => Effect.succeed(true),
  referenceExists: (_workingDir, reference) => Effect.succeed(reference === "origin/main"),
  configureBranchUpstream: () =>
    Effect.succeed({
      createdTrackingRef: "refs/remotes/origin/odt/task-1-task-1",
    }),
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
    Effect.succeed({
      name: "feature/electron",
      detached: false,
      revision: "def456",
    }),
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
  resolveCommandPath: (command) => Effect.succeed(command === "bd" ? null : command),
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
  readVersion: (kind) => Effect.succeed(`${kind} 1.0.0`),
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
  listAgentSessionsForTasks: ({ taskIds }) =>
    Effect.succeed(taskIds.map((taskId) => ({ taskId, agentSessions: [] }))),
  getTask: () =>
    Effect.succeed({
      id: "task-1",
      title: "Task 1",
      description: "",
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
        spec: {
          required: false,
          canSkip: true,
          available: false,
          completed: false,
        },
        planner: {
          required: false,
          canSkip: true,
          available: false,
          completed: false,
        },
        builder: {
          required: true,
          canSkip: false,
          available: false,
          completed: false,
        },
        qa: {
          required: true,
          canSkip: false,
          available: false,
          completed: false,
        },
      },
      updatedAt: "2026-01-02T00:00:00Z",
      createdAt: "2026-01-01T00:00:00Z",
    }),
  getTaskMetadata: () =>
    Effect.succeed({
      spec: {
        markdown: "# Spec",
        updatedAt: "2026-01-02T00:00:00Z",
        revision: 1,
      },
      plan: {
        markdown: "# Plan",
        updatedAt: "2026-01-02T00:00:00Z",
        revision: 1,
      },
      agentSessions: [],
    }),
  createTask: () =>
    Effect.succeed({
      id: "task-2",
      title: "Task 2",
      description: "",
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
        spec: {
          required: false,
          canSkip: true,
          available: false,
          completed: false,
        },
        planner: {
          required: false,
          canSkip: true,
          available: false,
          completed: false,
        },
        builder: {
          required: true,
          canSkip: false,
          available: false,
          completed: false,
        },
        qa: {
          required: true,
          canSkip: false,
          available: false,
          completed: false,
        },
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
          spec: {
            required: false,
            canSkip: true,
            available: false,
            completed: false,
          },
          planner: {
            required: false,
            canSkip: true,
            available: false,
            completed: false,
          },
          builder: {
            required: true,
            canSkip: false,
            available: false,
            completed: false,
          },
          qa: {
            required: true,
            canSkip: false,
            available: false,
            completed: false,
          },
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
        spec: {
          required: false,
          canSkip: true,
          available: false,
          completed: false,
        },
        planner: {
          required: false,
          canSkip: true,
          available: false,
          completed: false,
        },
        builder: {
          required: true,
          canSkip: false,
          available: false,
          completed: false,
        },
        qa: {
          required: true,
          canSkip: false,
          available: false,
          completed: false,
        },
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
        spec: {
          required: false,
          canSkip: true,
          available: false,
          completed: false,
        },
        planner: {
          required: false,
          canSkip: true,
          available: false,
          completed: false,
        },
        builder: {
          required: true,
          canSkip: false,
          available: false,
          completed: false,
        },
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
        spec: {
          required: false,
          canSkip: true,
          available: false,
          completed: false,
        },
        planner: {
          required: false,
          canSkip: true,
          available: false,
          completed: false,
        },
        builder: {
          required: true,
          canSkip: false,
          available: false,
          completed: false,
        },
        qa: {
          required: true,
          canSkip: false,
          available: false,
          completed: false,
        },
      },
      updatedAt: "2026-01-02T00:00:00Z",
      createdAt: "2026-01-01T00:00:00Z",
    }),
  deleteTask: () => Effect.succeed(true),
  listPullRequestSyncCandidates: () => Effect.succeed([]),
  diagnoseRepoStore: () =>
    Effect.succeed({
      category: "database_unavailable",
      status: "blocking",
      isReady: false,
      detail: "SQLite task store database is unavailable.",
      databasePath: null,
    }),
});

type RuntimeStartInput = Parameters<RuntimeStarterPort["startRuntime"]>[0];
type FakeRuntimeStarter = RuntimeStarterPort & {
  starts: RuntimeStartInput[];
  stops: string[];
};

/** Starts an in-memory runtime of each requested kind. */
const createRuntimeStarter = (
  runtimeRoute: RuntimeRoute = { type: "local_http", endpoint: "http://127.0.0.1:4096" },
): FakeRuntimeStarter => {
  const starts: RuntimeStartInput[] = [];
  const stops: string[] = [];
  return {
    starts,
    stops,
    startRuntime: (input) =>
      Effect.sync(() => {
        starts.push(input);
        const kindStarts = starts.filter((start) => start.runtimeKind === input.runtimeKind);
        const runtimeId = `${input.runtimeKind}-${kindStarts.length}`;
        return {
          runtime: {
            kind: input.runtimeKind,
            runtimeId,
            runtimeRoute,
            startedAt: "2026-05-10T10:00:00.000Z",
            descriptor: input.descriptor,
          },
          configuredExecutablePath: input.runtimeKind,
          effectiveExecutablePath: `/bin/${input.runtimeKind}`,
          stop: () => Effect.sync(() => void stops.push(runtimeId)),
        };
      }),
  };
};

type ElectronHostCommandRouter = Awaited<ReturnType<typeof createElectronHostCommandRouter>>;

const runtimeStatuses = async (router: ElectronHostCommandRouter): Promise<HostRuntimeStatus[]> =>
  hostRuntimeSnapshotSchema.parse(await router.invoke("runtime_status")).runtimes;

/** Polls `runtime_status` until every listed kind reaches the state. */
const waitForRuntimeState = async (
  router: ElectronHostCommandRouter,
  kinds: ReadonlyArray<RuntimeKind>,
  state: HostRuntimeStatus["state"],
): Promise<HostRuntimeStatus[]> => {
  const deadline = Date.now() + 800;
  while (Date.now() < deadline) {
    const statuses = await runtimeStatuses(router);
    const matching = statuses.filter(
      (status) => kinds.includes(status.kind) && status.state === state,
    );
    if (matching.length === kinds.length) {
      return matching;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for the ${kinds.join(", ")} runtimes to become ${state}.`);
};

describe("createElectronHostCommandRouter", () => {
  test("stops every shared runtime on host shutdown", async () => {
    const configDirectory = await mkdtemp(path.join(tmpdir(), "openducktor-electron-dispose-"));
    const lifecycleLogs: string[] = [];
    const runtimeStarter = createRuntimeStarter();
    try {
      const router = await createElectronHostCommandRouter({
        lifecycleLogger: {
          info(message) {
            return Effect.sync(() => lifecycleLogs.push(message));
          },
          error(message) {
            return Effect.sync(() => lifecycleLogs.push(message));
          },
        },
        processEnv: {
          OPENDUCKTOR_CONFIG_DIR: configDirectory,
          OPENDUCKTOR_DEV_INSTANCE: "electron-0123456789ab",
          PATH: "/usr/bin:/bin",
        },
        runtimeHealth: createRuntimeHealth(),
        runtimeStarter,
        settingsConfig: createSettingsConfig(
          globalConfig({ agentRuntimes: agentRuntimes({ opencode: true, codex: true }) }),
        ),
      });
      await router.initialize();
      await waitForRuntimeState(router, ["opencode", "codex"], "ready");

      expect(await router.dispose()).toBeUndefined();

      expect(runtimeStarter.stops.toSorted()).toEqual(["codex-1", "opencode-1"]);
      expect(lifecycleLogs).toEqual(
        expect.arrayContaining([
          "Shutting down OpenDucktor host services",
          "Stopping registered agent runtimes",
          "Stopping the OpenCode runtime opencode-1.",
          "The OpenCode runtime stopped.",
          "Stopping the Codex runtime codex-1.",
          "The Codex runtime stopped.",
          "OpenDucktor host services stopped",
        ]),
      );
    } finally {
      await rm(configDirectory, { force: true, recursive: true });
    }
  });

  test("registers migrated filesystem host commands", async () => {
    const router = await createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(),
    });

    expect(await router.invoke("filesystem_list_directory", { path: "/workspace" })).toMatchObject({
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
    const router = await createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(),
    });

    expect(await router.invoke("workspace_list")).toEqual([]);
    expect(await router.invoke("workspace_get_settings_snapshot")).toMatchObject({
      theme: "system",
      workspaces: {},
    });
  });

  test("does not write runtime paths when PATH resolution fails", async () => {
    const configDirectory = await mkdtemp(path.join(tmpdir(), "openducktor-path-config-"));
    const configPath = path.join(configDirectory, "config.json");
    const diagnostic = new ProcessEnvironmentError({
      message:
        "Failed to resolve PATH from interactive login shell /bin/zsh: the probe timed out after 5000 ms. Check shell startup files for commands that wait for input.",
      reason: "timed_out",
      shell: "/bin/zsh",
    });
    try {
      const router = await createElectronHostCommandRouter({
        processEnvironmentInput: pathFailure(diagnostic, {
          OPENDUCKTOR_CONFIG_DIR: configDirectory,
        }),
      });

      await expect(router.invoke("workspace_get_settings_snapshot")).rejects.toThrow(
        diagnostic.message,
      );
      await expect(readFile(configPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

      const legacyConfig = JSON.stringify({
        version: 2,
        agentRuntimes: {
          opencode: { enabled: true },
          codex: { enabled: true },
          claude: { enabled: false },
        },
      });
      await writeFile(configPath, legacyConfig);

      await expect(router.invoke("workspace_get_settings_snapshot")).rejects.toThrow(
        diagnostic.message,
      );
      expect(await readFile(configPath, "utf8")).toBe(legacyConfig);

      await writeFile(configPath, JSON.stringify({ version: 3 }));
      expect(await router.invoke("workspace_get_settings_snapshot")).toMatchObject({
        theme: "system",
      });
    } finally {
      await rm(configDirectory, { force: true, recursive: true });
    }
  });

  test("registers migrated local attachment host commands", async () => {
    const router = await createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      localAttachments: createLocalAttachments(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(),
    });

    expect(
      await router.invoke("workspace_stage_local_attachment", {
        name: "brief.pdf",
        base64Data: "YnJpZWY=",
      }),
    ).toMatchObject({
      path: expect.stringContaining("/tmp/openducktor-local-attachments/"),
    });
    expect(
      await router.invoke("workspace_resolve_local_attachment_path", {
        path: "brief.pdf",
      }),
    ).toEqual({
      path: "/tmp/openducktor-local-attachments/00000000-0000-0000-0000-000000000000-brief.pdf",
    });
  });

  test("lists, requires, and restarts shared runtimes through host commands", async () => {
    const opencodeDescriptor = createRuntimeDefinitionsService()
      .listRuntimeDefinitions()
      .find((descriptor) => descriptor.kind === "opencode");
    if (!opencodeDescriptor) {
      throw new Error("OpenCode runtime descriptor missing from test fixture.");
    }
    const runtimeStarter = createRuntimeStarter();
    const router = await createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      runtimeHealth: createRuntimeHealth(),
      runtimeStarter,
      settingsConfig: createSettingsConfig(globalConfig()),
    });

    try {
      expect(await router.invoke("runtime_definitions_list", {})).toMatchObject([
        { kind: "opencode" },
        { kind: "codex" },
        { kind: "claude" },
      ]);

      await router.initialize();
      const [ready] = await waitForRuntimeState(router, ["opencode"], "ready");
      expect(ready).toMatchObject({
        kind: "opencode",
        enabled: true,
        runtimeId: "opencode-1",
        trigger: "host_startup",
        failure: null,
      });
      expect(await router.invoke("runtime_require", { runtimeKind: "opencode" })).toEqual({
        kind: "opencode",
        runtimeId: "opencode-1",
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4096" },
        startedAt: "2026-05-10T10:00:00.000Z",
        descriptor: opencodeDescriptor,
      });
      await expect(router.invoke("runtime_require", { runtimeKind: "codex" })).rejects.toThrow();

      const impact = runtimeLifecycleImpactSchema.parse(
        await router.invoke("runtime_restart_impact", { runtimeKind: "opencode" }),
      );
      expect(impact.kinds).toEqual([
        expect.objectContaining({ kind: "opencode", runtimeId: "opencode-1", effect: "restart" }),
      ]);
      expect(impact.workspaces).toEqual([]);
      expect(
        await router.invoke("runtime_restart", {
          runtimeKind: "opencode",
          confirmation: impact.confirmation,
        }),
      ).toMatchObject({
        type: "completed",
        status: { kind: "opencode", state: "ready", runtimeId: "opencode-2", failure: null },
      });
      expect(
        runtimeStarter.starts.map(({ runtimeKind, descriptor }) => ({ runtimeKind, descriptor })),
      ).toEqual([
        { runtimeKind: "opencode", descriptor: opencodeDescriptor },
        { runtimeKind: "opencode", descriptor: opencodeDescriptor },
      ]);
      expect(runtimeStarter.stops).toEqual(["opencode-1"]);
    } finally {
      await router.dispose();
    }
  });

  test("resolves PATH again on a forced PATH check", async () => {
    const diagnostic = new ProcessEnvironmentError({
      message:
        "Failed to resolve PATH from interactive login shell /bin/zsh: the probe timed out after 15000 ms.",
      reason: "timed_out",
      shell: "/bin/zsh",
    });
    let probeCalls = 0;
    const router = await createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      processEnvironmentInput: {
        ...pathFailure(diagnostic),
        readLoginShellPath: () =>
          Effect.suspend(() => {
            probeCalls += 1;
            return probeCalls === 1 ? Effect.fail(diagnostic) : Effect.succeed("/opt/tools/bin");
          }),
      },
      runtimeHealth: createRuntimeHealth(),
      settingsConfig: createSettingsConfig(
        globalConfig({ workspaces: { repo: repoConfig() }, workspaceOrder: ["repo"] }),
      ),
      systemCommands: createSystemCommands(),
    });

    await expect(router.invoke("path_check", { force: false })).resolves.toMatchObject({
      ok: false,
      error: diagnostic.message,
    });
    await expect(router.invoke("path_check", { force: true })).resolves.toMatchObject({
      ok: true,
      error: null,
    });

    expect(probeCalls).toBe(2);
  });

  test("blocks every runtime start when the user PATH is unavailable", async () => {
    const diagnostic = new ProcessEnvironmentError({
      message:
        "Failed to resolve PATH from interactive login shell /bin/tcsh: the probe ended with exit code 1. Fix errors in the shell startup files and restart OpenDucktor.",
      reason: "unexpected_exit",
      shell: "/bin/tcsh",
    });
    const router = await createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      processEnvironmentInput: pathFailure(diagnostic),
      runtimeHealth: createRuntimeHealth(),
      settingsConfig: createSettingsConfig(
        globalConfig({
          agentRuntimes: agentRuntimes({ opencode: true, codex: true, claude: true }),
          workspaces: { repo: repoConfig() },
          workspaceOrder: ["repo"],
        }),
      ),
    });

    try {
      await router.initialize();
      const statuses = await waitForRuntimeState(router, ["claude", "codex", "opencode"], "error");

      for (const runtimeKind of ["claude", "codex", "opencode"] as const) {
        expect(statuses.find((status) => status.kind === runtimeKind)).toMatchObject({
          runtimeId: null,
          failure: {
            phase: "start",
            message: expect.stringContaining(
              `Failed to start ${runtimeKind} runtime because the user PATH is unavailable. ${diagnostic.message}`,
            ),
          },
        });
        await expect(router.invoke("runtime_require", { runtimeKind })).rejects.toThrow();
      }
    } finally {
      await router.dispose();
    }
  });

  test("blocks an injected runtime starter when the user PATH is unavailable", async () => {
    const diagnostic = new ProcessEnvironmentError({
      message:
        "Failed to resolve PATH from interactive login shell /bin/zsh: the probe timed out after 5000 ms. Check shell startup files for commands that wait for input.",
      reason: "timed_out",
      shell: "/bin/zsh",
    });
    const runtimeStarter = createRuntimeStarter();
    const router = await createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      processEnvironmentInput: pathFailure(diagnostic),
      runtimeHealth: createRuntimeHealth(),
      runtimeStarter,
      settingsConfig: createSettingsConfig(
        globalConfig({
          workspaces: { repo: repoConfig() },
          workspaceOrder: ["repo"],
        }),
      ),
    });

    try {
      await router.initialize();
      const [status] = await waitForRuntimeState(router, ["opencode"], "error");

      expect(status?.failure).toMatchObject({
        phase: "start",
        message: expect.stringContaining(
          `Failed to start opencode runtime because the user PATH is unavailable. ${diagnostic.message}`,
        ),
      });
      expect(runtimeStarter.starts).toEqual([]);
    } finally {
      await router.dispose();
    }
  });

  test("registers migrated read-only git host commands", async () => {
    const router = await createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(),
    });

    expect(await router.invoke("git_get_branches", { repoPath: "/repo" })).toEqual([
      { name: "main", isCurrent: true, isRemote: false },
    ]);
    expect(await router.invoke("git_get_current_branch", { repoPath: "/repo" })).toEqual({
      name: "main",
      detached: false,
      revision: "abc123",
    });
    expect(await router.invoke("git_get_status", { repoPath: "/repo" })).toEqual([
      { path: "src/main.ts", status: "modified", staged: false },
    ]);
    expect(await router.invoke("git_get_diff", { repoPath: "/repo" })).toEqual([
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
    if (!("snapshot" in worktreeStatus)) {
      throw new Error("Expected git worktree status to include a reset snapshot.");
    }
    expect(
      await router.invoke("git_get_worktree_status_summary", {
        repoPath: "/repo",
        targetBranch: "origin/main",
      }),
    ).toMatchObject({
      currentBranch: { name: "main" },
      fileStatusCounts: { total: 1, staged: 0, unstaged: 1 },
      snapshot: { targetBranch: "origin/main", diffScope: "target" },
    });
    expect(
      await router.invoke("git_commits_ahead_behind", {
        repoPath: "/repo",
        targetBranch: "origin/main",
      }),
    ).toEqual({ ahead: 3, behind: 2 });
    expect(
      await router.invoke("git_switch_branch", {
        repoPath: "/repo",
        branch: "feature/electron",
      }),
    ).toEqual({
      name: "feature/electron",
      detached: false,
      revision: "def456",
    });
    expect(
      await router.invoke("git_reset_worktree_selection", {
        repoPath: "/repo",
        targetBranch: "origin/main",
        snapshot: worktreeStatus.snapshot,
        selection: {
          kind: "file",
          filePath: "src/main.ts",
        },
      }),
    ).toEqual({ affectedPaths: ["src/main.ts"] });
    expect(
      await router.invoke("git_fetch_remote", {
        repoPath: "/repo",
        targetBranch: "origin/main",
      }),
    ).toEqual({ outcome: "fetched", output: "Fetched origin" });
    expect(
      await router.invoke("git_pull_branch", {
        repoPath: "/repo",
      }),
    ).toEqual({ outcome: "pulled", output: "Fast-forward" });
    expect(
      await router.invoke("git_commit_all", {
        repoPath: "/repo",
        message: "Ship Electron host",
      }),
    ).toEqual({
      outcome: "committed",
      commitHash: "abc123",
      output: "[feature abc123] Ship Electron host",
    });
    expect(
      await router.invoke("git_push_branch", {
        repoPath: "/repo",
        branch: "feature/electron",
      }),
    ).toEqual({
      outcome: "pushed",
      remote: "origin",
      branch: "feature/electron",
      output: "Pushed",
    });
    expect(
      await router.invoke("git_rebase_branch", {
        repoPath: "/repo",
        targetBranch: "origin/main",
      }),
    ).toEqual({
      outcome: "rebased",
      output: "Successfully rebased",
    });
    expect(await router.invoke("git_rebase_abort", { repoPath: "/repo" })).toEqual({
      outcome: "aborted",
      output: "Successfully aborted rebase",
    });
    expect(
      await router.invoke("git_abort_conflict", {
        repoPath: "/repo",
        operation: "direct_merge_merge_commit",
      }),
    ).toEqual({
      output: "Conflict operation aborted",
    });
  });

  test("registers migrated open-in system host commands", async () => {
    const router = await createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(),
    });

    expect(await router.invoke("system_list_open_in_tools", {})).toEqual([
      { toolId: "finder", iconDataUrl: null },
    ]);
    expect(
      await router.invoke("system_open_directory_in_tool", {
        directoryPath: "/repo",
        toolId: "finder",
      }),
    ).toEqual({ ok: true });
    expect(
      await router.invoke("open_external_url", {
        url: "https://example.com",
      }),
    ).toEqual({ ok: true });
  });

  test("registers migrated Git provider commands", async () => {
    const configuredRepo = repoConfig({
      git: {
        provider: {
          id: "github",
          enabled: true,
          autoDetected: false,
          repository: { host: "github.com", owner: "openai", name: "openducktor" },
        },
      },
    });
    const router = await createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(
        globalConfig({
          workspaces: { repo: configuredRepo },
          workspaceOrder: ["repo"],
          recentWorkspaces: ["repo"],
        }),
      ),
      systemCommands: createSystemCommands(),
    });

    expect(
      await router.invoke("workspace_detect_github_repository", {
        repoPath: "/repo",
      }),
    ).toEqual({
      host: "github.com",
      owner: "openai",
      name: "openducktor",
    });
    expect(
      await router.invoke("workspace_get_git_provider_context", { repoPath: "/repo" }),
    ).toMatchObject({
      descriptor: {
        id: "github",
        capabilities: {
          supportsPullRequests: true,
          supportsPullRequestReview: true,
        },
      },
      config: {
        id: "github",
        enabled: true,
      },
      health: {
        providerId: "github",
        enabled: true,
        available: true,
        version: "gh version 1.0.0",
        authenticated: true,
        repositoryMappingValid: true,
      },
    });
  });

  test.each(["runtime failure", "runtime hang", "settings failure"] as const)(
    "PATH and Git diagnostics do not depend on %s",
    async (failure) => {
      let settingsReads = 0;
      let runtimeProbes = 0;
      const unrelatedError = new HostOperationError({
        operation: "test.runtime",
        message: "OpenCode is unavailable.",
      });
      const router = await Effect.runPromise(
        createElectronEffectHostCommandRouter({
          isPackaged: false,
          onBackgroundFailure: () => Effect.void,
          processEnv: {
            OPENDUCKTOR_DEV_INSTANCE: "electron-0123456789ab",
            PATH: "/usr/bin:/bin",
          },
          runtimeDistribution: testRuntimeDistribution,
          filesystem: createFilesystem(),
          git: createGit(),
          openInTools: createOpenInTools(),
          settingsConfig: {
            ...createSettingsConfig(globalConfig()),
            readConfig: () => {
              settingsReads += 1;
              return failure === "settings failure"
                ? Effect.fail(unrelatedError)
                : Effect.succeed(globalConfig());
            },
          },
          runtimeHealth: {
            ...createRuntimeHealth(),
            getRuntimeHealth: () => {
              runtimeProbes += 1;
              return failure === "runtime hang" ? Effect.never : Effect.fail(unrelatedError);
            },
          },
          systemCommands: createSystemCommands(),
        }),
      );
      const settingsReadsBeforeCheck = settingsReads;
      try {
        const check = await Effect.runPromise(
          router.invoke("git_check", {}).pipe(Effect.timeout("250 millis")),
        );
        expect(check).toMatchObject({ ok: true });
        expect(
          await Effect.runPromise(
            router.invoke("path_check", {}).pipe(Effect.timeout("250 millis")),
          ),
        ).toEqual({ ok: true, error: null });
        expect(runtimeProbes).toBe(0);
        expect(settingsReads).toBe(settingsReadsBeforeCheck);
      } finally {
        await Effect.runPromise(router.dispose());
      }
    },
  );

  test("registers migrated diagnostics host commands", async () => {
    const processEnvironmentError = new ProcessEnvironmentError({
      message:
        "Failed to resolve PATH from interactive login shell /bin/zsh: the probe timed out after 5000 ms. Check shell startup files for commands that wait for input.",
      reason: "timed_out",
      shell: "/bin/zsh",
    });
    const router = await createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      processEnvironmentInput: pathFailure(processEnvironmentError),
      runtimeHealth: createRuntimeHealth(),
      settingsConfig: createSettingsConfig(),
      systemCommands: createSystemCommands(),
    });

    expect(await router.invoke("path_check", { force: true })).toMatchObject({
      ok: false,
      error: processEnvironmentError.message,
    });
    expect(await router.invoke("task_store_check", { repoPath: "/repo" })).toMatchObject({
      taskStoreOk: false,
      taskStoreError: "Workspace is not configured for repository: /repo",
      repoStoreHealth: { status: "blocking" },
    });
  });

  test("reports PATH failure without creating or migrating runtime config", async () => {
    const processEnvironmentError = new ProcessEnvironmentError({
      message:
        "Failed to resolve PATH from interactive login shell /bin/zsh: the probe timed out after 5000 ms. Check shell startup files for commands that wait for input.",
      reason: "timed_out",
      shell: "/bin/zsh",
    });
    const fixtures = [
      { name: "missing", config: null },
      {
        name: "version 2",
        config: {
          version: 2,
          agentRuntimes: {
            opencode: { enabled: false },
            codex: { enabled: true },
            claude: { enabled: false },
          },
        },
      },
    ] as const;

    for (const fixture of fixtures) {
      const root = await mkdtemp(path.join(tmpdir(), `odt-path-diagnostic-${fixture.name}-`));
      const configPath = path.join(root, "config.json");
      try {
        if (fixture.config) {
          await writeFile(configPath, JSON.stringify(fixture.config));
        }
        const router = await createElectronHostCommandRouter({
          filesystem: createFilesystem(),
          git: createGit(),
          openInTools: createOpenInTools(),
          processEnvironmentInput: pathFailure(processEnvironmentError, {
            OPENDUCKTOR_CONFIG_DIR: root,
          }),
          runtimeHealth: createRuntimeHealth(),
          systemCommands: createSystemCommands(),
        });

        expect(await router.invoke("path_check", { force: true })).toMatchObject({
          ok: false,
          error: processEnvironmentError.message,
        });
        if (fixture.config) {
          expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({ version: 2 });
        } else {
          await expect(readFile(configPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
        }
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    }
  }, 10_000);

  test("routes saved OpenCode session stops through the authenticated V2 runtime", async () => {
    const opencode = await createFakeOpenCodeV2();
    const ready = Promise.withResolvers<void>();
    const eventBus = createHostEventBus({ report: ({ cause }) => ready.reject(cause) });
    const unsubscribe = eventBus.subscribe("openducktor://runtime-changed", (event) => {
      if (
        event.channel !== "openducktor://runtime-changed" ||
        event.payload.type !== "runtime_changed"
      )
        return;
      const { status } = event.payload;
      if (status.kind !== "opencode") return;
      if (status.state === "ready") ready.resolve();
      if (status.state === "error") ready.reject(new Error(JSON.stringify(status.failure)));
    });
    const sessionTaskStore = createTaskStore();
    const sessionStopRouter = await createElectronHostCommandRouter({
      eventBus,
      // The native fixture needs the platform's command shell and PATH.
      processEnv: {
        ...process.env,
        OPENDUCKTOR_DEV_INSTANCE: "electron-0123456789ab",
      },
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      runtimeHealth: createRuntimeHealth(),
      settingsConfig: createSettingsConfig(
        globalConfig({
          agentRuntimes: {
            ...agentRuntimes({ opencode: true }),
            opencode: { enabled: true, executablePath: opencode.executablePath },
          },
        }),
      ),
      taskStore: {
        ...sessionTaskStore,
        getTaskMetadata: () =>
          Effect.succeed({
            spec: {
              markdown: "# Spec",
              updatedAt: "2026-01-02T00:00:00Z",
              revision: 1,
            },
            plan: {
              markdown: "# Plan",
              updatedAt: "2026-01-02T00:00:00Z",
              revision: 1,
            },
            agentSessions: [
              {
                externalSessionId: "external-session-1",
                role: "build",
                startedAt: "2026-05-10T10:00:00.000Z",
                runtimeKind: "opencode",
                workingDirectory: "/repo/worktree",
                selectedModel: null,
              },
            ],
          } satisfies TaskMetadataPayload),
      },
    });
    try {
      await sessionStopRouter.initialize();
      await ready.promise;
      expect(
        await sessionStopRouter.invoke("agent_session_stop", {
          request: {
            repoPath: "/repo",
            taskId: "task-1",
            externalSessionId: "external-session-1",
            runtimeKind: "opencode",
            workingDirectory: "/repo/worktree",
          },
        }),
      ).toEqual({ ok: true });
      const record = await opencode.readRecord();
      expect(record.requests.filter(({ path }) => path.endsWith("/interrupt"))).toEqual([
        { path: "/api/session/external-session-1/interrupt", authorized: true },
      ]);
      expect(record.requests.every(({ authorized }) => authorized)).toBe(true);
    } finally {
      unsubscribe();
      await sessionStopRouter.dispose();
      await opencode.cleanup();
    }
  }, 10_000);

  test("registers migrated task list host command", async () => {
    const router = await createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(),
      taskStore: createTaskStore(),
    });

    expect(await router.invoke("tasks_list", { repoPath: "/repo" })).toEqual([
      expect.objectContaining({
        id: "task-1",
        availableActions: [
          "view_details",
          "set_spec",
          "set_plan",
          "build_start",
          "reset_task",
          "close_task",
        ],
      }),
    ]);
    expect(
      await router.invoke("task_create", {
        repoPath: "/repo",
        input: { title: "Task 2", issueType: "task", priority: 2 },
      }),
    ).toMatchObject({
      id: "task-2",
      availableActions: [
        "view_details",
        "set_spec",
        "set_plan",
        "build_start",
        "reset_task",
        "close_task",
      ],
    });
    expect(
      await router.invoke("task_transition", {
        repoPath: "/repo",
        taskId: "task-1",
        status: "in_progress",
      }),
    ).toMatchObject({
      id: "task-1",
      status: "in_progress",
      availableActions: expect.arrayContaining(["open_builder"]),
    });
    expect(
      await router.invoke("task_metadata_get", {
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).toEqual({
      spec: {
        markdown: "# Spec",
        updatedAt: "2026-01-02T00:00:00Z",
        revision: 1,
      },
      plan: {
        markdown: "# Plan",
        updatedAt: "2026-01-02T00:00:00Z",
        revision: 1,
      },
      agentSessions: [],
    });
    expect(await router.invoke("spec_get", { repoPath: "/repo", taskId: "task-1" })).toEqual({
      markdown: "# Spec",
      updatedAt: "2026-01-02T00:00:00Z",
      revision: 1,
    });
    expect(await router.invoke("plan_get", { repoPath: "/repo", taskId: "task-1" })).toEqual({
      markdown: "# Plan",
      updatedAt: "2026-01-02T00:00:00Z",
      revision: 1,
    });
    expect(await router.invoke("qa_get_report", { repoPath: "/repo", taskId: "task-1" })).toEqual({
      markdown: "",
    });
    expect(
      await router.invoke("agent_sessions_list", {
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).toEqual([]);

    expect(
      await router.invoke("set_spec", {
        repoPath: "/repo",
        taskId: "task-1",
        markdown: "# Spec",
      }),
    ).toEqual({
      markdown: "# Spec",
      updatedAt: "2026-01-02T00:00:00Z",
      revision: 1,
    });
    expect(
      await router.invoke("spec_save_document", {
        repoPath: "/repo",
        taskId: "task-1",
        markdown: "# Spec v2",
      }),
    ).toEqual({
      markdown: "# Spec v2",
      updatedAt: "2026-01-02T00:00:00Z",
      revision: 1,
    });
    expect(
      await router.invoke("set_plan", {
        repoPath: "/repo",
        taskId: "task-1",
        input: { markdown: "# Plan" },
      }),
    ).toEqual({
      markdown: "# Plan",
      updatedAt: "2026-01-02T00:00:00Z",
      revision: 1,
    });
    expect(
      await router.invoke("plan_save_document", {
        repoPath: "/repo",
        taskId: "task-1",
        markdown: "# Plan v2",
      }),
    ).toEqual({
      markdown: "# Plan v2",
      updatedAt: "2026-01-02T00:00:00Z",
      revision: 1,
    });
    const deleteRouter = await createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: {
        ...createSettingsConfig(
          globalConfig({
            workspaces: { repo: repoConfig() },
            workspaceOrder: ["repo"],
          }),
        ),
        pathExists: () => Effect.succeed(false),
      },
      taskStore: createTaskStore(),
    });
    expect(
      await deleteRouter.invoke("task_delete", {
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).toEqual({ ok: true });
    expect(
      await deleteRouter.invoke("task_reset", {
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).toMatchObject({ id: "task-1", status: "open" });
    const resetImplementationTaskStore = createTaskStore();
    const resetImplementationRouter = await createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: {
        ...createSettingsConfig(
          globalConfig({
            workspaces: { repo: repoConfig() },
            workspaceOrder: ["repo"],
          }),
        ),
        pathExists: () => Effect.succeed(false),
      },
      taskStore: {
        ...resetImplementationTaskStore,
        listTasks: (input) =>
          resetImplementationTaskStore.listTasks(input).pipe(
            Effect.map((entries) =>
              entries.map((entry): TaskCard => ({
                ...entry,
                status: "ai_review",
                documentSummary: {
                  ...entry.documentSummary,
                  plan: { has: true, updatedAt: "2026-01-02T00:00:00Z" },
                },
              })),
            ),
          ),
      },
    });
    expect(
      await resetImplementationRouter.invoke("task_reset_implementation", {
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).toMatchObject({ id: "task-1", status: "ready_for_dev" });
    const pullRequestTaskStore = createTaskStore();
    const pullRequestRouter = await createElectronHostCommandRouter({
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
              providerId: "github",
              number: 42,
              url: "https://github.com/openai/openducktor/pull/42",
              state: "open",
              createdAt: "2026-05-01T00:00:00.000Z",
              updatedAt: "2026-05-02T00:00:00.000Z",
            },
            agentSessions: [],
          } satisfies TaskMetadataPayload),
      },
    });
    expect(
      await pullRequestRouter.invoke("task_pull_request_unlink", {
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).toBe(true);

    const approvalRouter = await createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(
        globalConfig({
          workspaces: {
            repo: repoConfig({
              git: {
                provider: {
                  id: "github",
                  enabled: true,
                  repository: {
                    host: "github.com",
                    owner: "openai",
                    name: "openducktor",
                  },
                  autoDetected: false,
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
    const approvalContext = await approvalRouter.invoke("task_approval_context_get", {
      repoPath: "/repo",
      taskId: "task-1",
    });
    expect(approvalContext).toMatchObject({
      outcome: "ready",
      approvalContext: {
        taskId: "task-1",
        taskStatus: "human_review",
        sourceBranch: "main",
        targetBranch: { remote: "origin", branch: "main" },
        hasUncommittedChanges: true,
        uncommittedFileCount: 1,
      },
    });

    const detectPullRequestRouter = await createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(
        globalConfig({
          workspaces: {
            repo: repoConfig({
              git: {
                provider: {
                  id: "github",
                  enabled: true,
                  repository: {
                    host: "github.com",
                    owner: "openai",
                    name: "openducktor",
                  },
                  autoDetected: false,
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
    expect(
      await detectPullRequestRouter.invoke("task_pull_request_detect", {
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).toMatchObject({
      outcome: "linked",
      pullRequest: {
        providerId: "github",
        number: 42,
        state: "open",
      },
    });

    const upsertPullRequestRouter = await createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: {
        ...createGit(),
        getWorktreeStatusSummaryData: () =>
          Effect.succeed({
            currentBranch: {
              name: "main",
              detached: false,
              revision: "abc123",
            },
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
                provider: {
                  id: "github",
                  enabled: true,
                  repository: {
                    host: "github.com",
                    owner: "openai",
                    name: "openducktor",
                  },
                  autoDetected: false,
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
    expect(
      await upsertPullRequestRouter.invoke("task_pull_request_upsert", {
        repoPath: "/repo",
        taskId: "task-1",
        input: { title: "Create PR", body: "Body" },
      }),
    ).toMatchObject({
      providerId: "github",
      number: 77,
      state: "open",
    });

    const pullRequestSyncRouter = await createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(
        globalConfig({
          workspaces: {
            repo: repoConfig({
              git: {
                provider: {
                  id: "github",
                  enabled: true,
                  repository: {
                    host: "github.com",
                    owner: "openai",
                    name: "openducktor",
                  },
                  autoDetected: false,
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
                spec: {
                  required: false,
                  canSkip: true,
                  available: false,
                  completed: false,
                },
                planner: {
                  required: false,
                  canSkip: true,
                  available: false,
                  completed: false,
                },
                builder: {
                  required: true,
                  canSkip: false,
                  available: false,
                  completed: false,
                },
                qa: {
                  required: true,
                  canSkip: false,
                  available: false,
                  completed: false,
                },
              },
              updatedAt: "2026-01-02T00:00:00Z",
              createdAt: "2026-01-01T00:00:00Z",
            },
          ]),
      },
    });
    expect(
      await pullRequestSyncRouter.invoke("repo_pull_request_sync", {
        repoPath: "/repo",
      }),
    ).toEqual({ ok: true });

    const reviewRouter = await createElectronHostCommandRouter({
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
              spec: {
                required: false,
                canSkip: true,
                available: false,
                completed: false,
              },
              planner: {
                required: false,
                canSkip: true,
                available: false,
                completed: false,
              },
              builder: {
                required: true,
                canSkip: false,
                available: false,
                completed: false,
              },
              qa: {
                required: true,
                canSkip: false,
                available: false,
                completed: false,
              },
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
                spec: {
                  required: false,
                  canSkip: true,
                  available: false,
                  completed: false,
                },
                planner: {
                  required: false,
                  canSkip: true,
                  available: false,
                  completed: false,
                },
                builder: {
                  required: true,
                  canSkip: false,
                  available: false,
                  completed: false,
                },
                qa: {
                  required: true,
                  canSkip: false,
                  available: false,
                  completed: false,
                },
              },
              updatedAt: "2026-01-02T00:00:00Z",
              createdAt: "2026-01-01T00:00:00Z",
            },
          ]),
      },
    });
    expect(
      await reviewRouter.invoke("qa_approved", {
        repoPath: "/repo",
        taskId: "task-1",
        reportMarkdown: "Looks good",
      }),
    ).toMatchObject({
      id: "task-1",
      status: "human_review",
      agentWorkflows: { qa: { completed: true } },
    });
    expect(
      await reviewRouter.invoke("qa_rejected", {
        repoPath: "/repo",
        taskId: "task-1",
        reportMarkdown: "Needs work",
      }),
    ).toMatchObject({
      id: "task-1",
      status: "in_progress",
    });
    expect(
      await reviewRouter.invoke("human_request_changes", {
        repoPath: "/repo",
        taskId: "task-1",
        note: "Please adjust",
      }),
    ).toMatchObject({
      id: "task-1",
      status: "in_progress",
    });
    expect(
      await reviewRouter.invoke("human_approve", {
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).toMatchObject({
      id: "task-1",
      status: "closed",
    });

    const directMergeStartRouter = await createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: {
        ...createGit(),
        getWorktreeStatusSummaryData: () =>
          Effect.succeed({
            currentBranch: {
              name: "odt/task-1",
              detached: false,
              revision: "abc123",
            },
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
                spec: {
                  required: false,
                  canSkip: true,
                  available: false,
                  completed: false,
                },
                planner: {
                  required: false,
                  canSkip: true,
                  available: false,
                  completed: false,
                },
                builder: {
                  required: true,
                  canSkip: false,
                  available: false,
                  completed: false,
                },
                qa: {
                  required: true,
                  canSkip: false,
                  available: false,
                  completed: false,
                },
              },
              updatedAt: "2026-01-02T00:00:00Z",
              createdAt: "2026-01-01T00:00:00Z",
            },
          ]),
      },
    });
    expect(
      await directMergeStartRouter.invoke("task_direct_merge", {
        repoPath: "/repo",
        taskId: "task-1",
        input: { mergeMethod: "merge_commit" },
      }),
    ).toMatchObject({
      outcome: "completed",
      task: { id: "task-1", status: "human_review" },
    });

    expect(
      await router.invoke("build_resumed", {
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).toMatchObject({
      id: "task-1",
      status: "in_progress",
      availableActions: expect.arrayContaining(["open_builder"]),
    });

    const completionRouter = await createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      settingsConfig: createSettingsConfig(
        globalConfig({
          workspaces: {
            repo: repoConfig({
              hooks: { postComplete: [] },
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
                spec: {
                  required: false,
                  canSkip: true,
                  available: false,
                  completed: false,
                },
                planner: {
                  required: false,
                  canSkip: true,
                  available: false,
                  completed: false,
                },
                builder: {
                  required: true,
                  canSkip: false,
                  available: false,
                  completed: false,
                },
                qa: {
                  required: true,
                  canSkip: false,
                  available: false,
                  completed: false,
                },
              },
              updatedAt: "2026-01-02T00:00:00Z",
              createdAt: "2026-01-01T00:00:00Z",
            },
          ]),
      },
    });
    expect(
      await completionRouter.invoke("build_completed", {
        repoPath: "/repo",
        taskId: "task-1",
        input: { summary: "Done" },
      }),
    ).toMatchObject({
      id: "task-1",
      status: "ai_review",
      availableActions: expect.arrayContaining(["qa_start"]),
    });

    const directMergeRouter = await createElectronHostCommandRouter({
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
                spec: {
                  required: false,
                  canSkip: true,
                  available: false,
                  completed: false,
                },
                planner: {
                  required: false,
                  canSkip: true,
                  available: false,
                  completed: false,
                },
                builder: {
                  required: true,
                  canSkip: false,
                  available: false,
                  completed: false,
                },
                qa: {
                  required: true,
                  canSkip: false,
                  available: false,
                  completed: false,
                },
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
              method: "merge_commit",
              sourceBranch: "odt/task-1",
              targetBranch: { branch: "main" },
              mergedAt: "2026-05-10T11:00:00.000Z",
            },
            agentSessions: [],
          } satisfies TaskMetadataPayload),
      },
    });
    expect(
      await directMergeRouter.invoke("task_direct_merge_complete", {
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).toMatchObject({
      id: "task-1",
      status: "closed",
    });

    const removedMergedWorktreePaths: string[] = [];
    const mergedPullRequestRouter = await createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      worktreeFiles: {
        ensureDirectory: () => Effect.void,
        copyConfiguredPaths: () => Effect.void,
        removePathIfPresent: (worktreePath) =>
          Effect.sync(() => {
            removedMergedWorktreePaths.push(worktreePath);
          }),
        resolveWorktreePath: (_repoPath, worktreePath) => worktreePath,
        resolvePathWithinRoot: (_root, candidate) =>
          Effect.succeed({
            canonicalPath: candidate,
            cleanupPath: candidate,
            isSymlink: false,
            kind: "descendant",
          }),
        pathIsWithinRoot: () => Effect.succeed(false),
      },
      settingsConfig: createSettingsConfig(
        globalConfig({
          workspaces: {
            repo: repoConfig({
              git: {
                provider: {
                  id: "github",
                  enabled: true,
                  repository: {
                    host: "github.com",
                    owner: "acme",
                    name: "repo",
                  },
                  autoDetected: false,
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
        listTasks: () =>
          Effect.succeed([
            {
              id: "task-1",
              title: "Task 1",
              description: "",
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
                spec: {
                  required: false,
                  canSkip: true,
                  available: false,
                  completed: false,
                },
                planner: {
                  required: false,
                  canSkip: true,
                  available: false,
                  completed: false,
                },
                builder: {
                  required: true,
                  canSkip: false,
                  available: false,
                  completed: false,
                },
                qa: {
                  required: true,
                  canSkip: false,
                  available: false,
                  completed: false,
                },
              },
              updatedAt: "2026-01-02T00:00:00Z",
              createdAt: "2026-01-01T00:00:00Z",
            },
          ]),
      },
    });
    expect(
      await mergedPullRequestRouter.invoke("task_pull_request_link_merged", {
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
    ).toMatchObject({
      id: "task-1",
      status: "closed",
    });
    expect(removedMergedWorktreePaths).toEqual(["/home/dev/.openducktor/worktrees/repo/task-1"]);

    const blockRouter = await createElectronHostCommandRouter({
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
                spec: {
                  required: false,
                  canSkip: true,
                  available: false,
                  completed: false,
                },
                planner: {
                  required: false,
                  canSkip: true,
                  available: false,
                  completed: false,
                },
                builder: {
                  required: true,
                  canSkip: false,
                  available: false,
                  completed: false,
                },
                qa: {
                  required: true,
                  canSkip: false,
                  available: false,
                  completed: false,
                },
              },
              updatedAt: "2026-01-02T00:00:00Z",
              createdAt: "2026-01-01T00:00:00Z",
            },
          ]),
      },
    });
    expect(
      await blockRouter.invoke("build_blocked", {
        repoPath: "/repo",
        taskId: "task-1",
        reason: "Blocked by dependency",
      }),
    ).toMatchObject({
      id: "task-1",
      status: "blocked",
      availableActions: expect.arrayContaining(["open_builder"]),
    });
    expect(
      await router.invoke("task_update", {
        repoPath: "/repo",
        taskId: "task-1",
        patch: { title: "Updated task" },
      }),
    ).toMatchObject({
      id: "task-1",
      title: "Updated task",
      availableActions: [
        "view_details",
        "set_spec",
        "set_plan",
        "build_start",
        "reset_task",
        "close_task",
      ],
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
    const runtimeStarter = createRuntimeStarter();
    const worktreeFiles: WorktreeFilePort = {
      ensureDirectory: () => Effect.succeed(undefined),
      copyConfiguredPaths: () => Effect.succeed(undefined),
      removePathIfPresent: () => Effect.succeed(undefined),
      resolveWorktreePath(_repoPath, worktreePath) {
        return worktreePath;
      },
      pathIsWithinRoot: () => Effect.succeed(true),
    };
    const router = await createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      runtimeHealth: createRuntimeHealth(),
      runtimeStarter,
      settingsConfig,
      taskStore: createTaskStore(),
      worktreeFiles,
    });

    try {
      await router.initialize();
      await waitForRuntimeState(router, ["opencode"], "ready");
      expect(
        await router.invoke("build_start", {
          repoPath: "/repo",
          taskId: "task-1",
          runtimeKind: "opencode",
        }),
      ).toEqual({
        runtimeKind: "opencode",
        workingDirectory: "/home/dev/.openducktor/worktrees/repo/task-1",
      });
      expect(runtimeStarter.starts.map((start) => start.runtimeKind)).toEqual(["opencode"]);
    } finally {
      await router.dispose();
    }
  });
});
