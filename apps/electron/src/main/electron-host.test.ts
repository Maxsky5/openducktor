import { afterEach, beforeEach, describe, expect, onTestFinished, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createDefaultNotificationSettings,
  DEFAULT_AGENT_RUNTIMES,
  type GlobalConfig,
  globalConfigSchema,
  type HostRuntimeStatus,
  hostRuntimeSnapshotSchema,
  type RepoConfig,
  type RuntimeHealth,
  type RuntimeKind,
  type RuntimeRoute,
  runtimeLifecycleImpactSchema,
  taskCardSchema,
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
  type SystemCommandPort,
  type ProcessInspectorPort,
  type TerminalPtyPort,
} from "@openducktor/host";
import {
  createElectronEffectHostCommandRouter,
  createElectronHostCommandRouter as createProductionElectronHostCommandRouter,
} from "./electron-host";
import { createTaskStoreTestDouble } from "../../../../packages/host/src/test-support/task-store-test-double";
import { createFakeOpenCodeV2 } from "../../../../packages/host/src/test-support/opencode-v2-standalone";
import { createBrowserEngineTestDouble } from "../../../../packages/host/src/test-support/browser-engine-test-double";
import { createGitPortTestDouble } from "../../../../packages/host/src/test-support/service-test-doubles";

type ElectronHostCommandRouterInput = Parameters<
  typeof createProductionElectronHostCommandRouter
>[0];

const testRuntimeDistribution = createArtifactRuntimeDistribution({
  mcpLauncher: {
    kind: "executable",
    executablePath: process.execPath,
  },
});
const quietLifecycleLogger = { info: () => Effect.void, error: () => Effect.void };

const routers: Awaited<ReturnType<typeof createProductionElectronHostCommandRouter>>[] = [];
const configDirectories: string[] = [];
let repoPath: string;
let worktreeBasePath: string;
beforeEach(async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "odt-electron-repo-")));
  configDirectories.push(root);
  repoPath = path.join(root, "repo");
  worktreeBasePath = path.join(root, "worktrees");
  await mkdir(repoPath);
});
afterEach(async () => {
  await Promise.all(routers.splice(0).map((router) => router.dispose()));
  // Windows can lock a file of a closed database for a short time after the host stops.
  await Promise.all(
    configDirectories
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 })),
  );
});

const createElectronHostCommandRouter = async ({
  config,
  ...ports
}: Partial<ElectronHostCommandRouterInput> & { config?: GlobalConfig } = {}) => {
  let input = ports;
  const configRoot = await mkdtemp(path.join(tmpdir(), "odt-electron-router-"));
  configDirectories.push(configRoot);
  const selectedRoot = (value: string | undefined) =>
    value && value !== process.env.OPENDUCKTOR_CONFIG_DIR ? value : configRoot;
  const root = selectedRoot(
    input.processEnvironmentInput
      ? input.processEnvironmentInput.baseEnv?.OPENDUCKTOR_CONFIG_DIR
      : input.processEnv?.OPENDUCKTOR_CONFIG_DIR,
  );
  if (input.processEnvironmentInput) {
    input = {
      ...input,
      processEnvironmentInput: {
        ...input.processEnvironmentInput,
        baseEnv: {
          ...input.processEnvironmentInput.baseEnv,
          OPENDUCKTOR_CONFIG_DIR: root,
        },
      },
    };
  } else {
    input = {
      ...input,
      processEnv: {
        OPENDUCKTOR_DEV_INSTANCE: "electron-0123456789ab",
        PATH: "/usr/bin:/bin",
        ...input.processEnv,
        OPENDUCKTOR_CONFIG_DIR: root,
      },
    };
  }
  if (config) {
    await writeFile(path.join(root, "config.json"), JSON.stringify(config));
  }
  const router = await createProductionElectronHostCommandRouter({
    isPackaged: false,
    eventBus: createHostEventBus({ report: () => {} }),
    onBackgroundFailure: () => Effect.void,
    lifecycleLogger: quietLifecycleLogger,
    runtimeDistribution: testRuntimeDistribution,
    browserEngine: () => Effect.succeed(createBrowserEngineTestDouble().engine),
    terminalPty: unexpectedTerminalPty,
    processInspector: unexpectedProcessInspector,
    processNativeDirectory: "/missing-process-native",
    taskEventPublicationReporter: { report: () => Effect.void },
    ...input,
  });
  routers.push(router);
  return router;
};

/** These router tests open no terminal. */
const unexpectedTerminalPty: TerminalPtyPort = {
  start: () => Effect.die(new Error("A terminal PTY is not expected in this test.")),
};

const unexpectedProcessInspector: ProcessInspectorPort = {
  listProcesses: () => Effect.die(new Error("Process reads are not expected in this test.")),
  inspectProcesses: () => Effect.die(new Error("Process reads are not expected in this test.")),
  stopMode: () => Effect.die(new Error("Process reads are not expected in this test.")),
  stopProcess: () => Effect.die(new Error("Process stops are not expected in this test.")),
  readStandardInputs: () => Effect.die(new Error("Process reads are not expected in this test.")),
};

const pathFailure = (
  error: ProcessEnvironmentError,
  baseEnv: NodeJS.ProcessEnv = {},
): NonNullable<ElectronHostCommandRouterInput["processEnvironmentInput"]> => ({
  baseEnv: {
    HOME: "/home/dev",
    OPENDUCKTOR_CONFIG_DIR: process.env.OPENDUCKTOR_CONFIG_DIR,
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
  relative: (from, to) => path.relative(from, to),
  extension: (filePath) => path.extname(filePath),
  readFileBytes: () => Effect.die(new Error("Unexpected filesystem readFileBytes.")),
  readFileSnapshot: () => Effect.die(new Error("Unexpected filesystem readFileSnapshot.")),
  replaceFileBytes: () => Effect.die(new Error("Unexpected filesystem replaceFileBytes.")),
});

const repoConfig = (overrides: Partial<RepoConfig> = {}): RepoConfig => ({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath,
  worktreeBasePath,
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {},
  hooks: { beforeWorktreeRemoval: [] },
  actions: { items: [], defaultActionId: null },
  worktreeCopyPaths: [],
  promptOverrides: {},
  promptAppends: {},
  agentDefaults: {},
  agentStudioState: { openTaskIds: [] },
  ...overrides,
});

/** Saved runtime settings that enable the given kinds. */
const agentRuntimes = (
  enabled: Partial<Record<RuntimeKind, boolean>>,
): GlobalConfig["agentRuntimes"] => ({
  ...DEFAULT_AGENT_RUNTIMES,
  opencode: {
    ...DEFAULT_AGENT_RUNTIMES.opencode,
    enabled: enabled.opencode ?? false,
    executablePath: "opencode",
  },
  codex: {
    ...DEFAULT_AGENT_RUNTIMES.codex,
    enabled: enabled.codex ?? false,
    executablePath: "codex",
  },
  claude: {
    ...DEFAULT_AGENT_RUNTIMES.claude,
    enabled: enabled.claude ?? false,
    executablePath: "claude",
  },
});

/** A saved config: the schema fills each setting that the test does not set. */
const globalConfig = (overrides: Partial<GlobalConfig> = {}): GlobalConfig => ({
  ...globalConfigSchema.parse({ version: 4 }),
  theme: "light",
  general: { openAgentStudioTabOnBackgroundSessionStart: true },
  autopilot: {
    alwaysStartQaReviewsFresh: false,
    rules: [
      {
        workflowId: "openducktor-spec-plan-build",
        eventId: "taskProgressedToSpecReady",
        actionIds: [],
      },
      {
        workflowId: "openducktor-spec-plan-build",
        eventId: "taskProgressedToReadyForDev",
        actionIds: [],
      },
      {
        workflowId: "openducktor-spec-plan-build",
        eventId: "taskProgressedToAiReview",
        actionIds: [],
      },
      {
        workflowId: "openducktor-spec-plan-build",
        eventId: "taskRejectedByQa",
        actionIds: [],
      },
      {
        workflowId: "openducktor-spec-plan-build",
        eventId: "taskProgressedToHumanReview",
        actionIds: [],
      },
    ],
  },
  agentRuntimes: agentRuntimes({ opencode: true }),
  workspaces: {},
  workspaceOrder: [],
  recentWorkspaces: [],
  globalPromptOverrides: {},
  globalPromptAppends: {},
  notifications: createDefaultNotificationSettings(),
  ...overrides,
});

const createGit = (): GitPort =>
  createGitPortTestDouble({
    releaseReadCaptures: () => Effect.void,
    canonicalizePath: (path) => Effect.succeed(path),
    isGitRepository: () => Effect.succeed(true),
    readCheckout: (directory) =>
      Effect.succeed({ root: directory, commonDirectory: path.join(repoPath, ".git") }),
    isRegisteredWorktree: () => Effect.succeed(true),
    referenceExists: (_workingDir, reference) => Effect.succeed(reference === "origin/main"),
    configureBranchUpstream: () =>
      Effect.succeed({ ref: "refs/remotes/origin/odt/task-1-task-1", oid: "c0ffee" }),
    deleteOwnedReference: () => Effect.succeed(undefined),
    listRemoteNames: () => Effect.succeed(["origin"]),
    listRemotes: () =>
      Effect.succeed([{ name: "origin", url: "git@github.com:openai/openducktor.git" }]),
    listBranches: () => Effect.succeed([{ name: "main", isCurrent: true, isRemote: false }]),
    isMergeIncluded: () => Effect.succeed(true),
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
    commitsAheadBehind: () => Effect.succeed({ ahead: 3, behind: 2 }),
    resolveFetchRemotes: () => Effect.succeed(["origin"]),
    fetchRemote: () => Effect.succeed("Fetched origin"),
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
  fileInfo: () => Effect.die(new Error("Unexpected local attachment fileInfo.")),
  readFile: () => Effect.die(new Error("Unexpected local attachment readFile.")),
});

const createSystemCommands = (): SystemCommandPort => ({
  resolveCommandPath: (command) => Effect.succeed(command === "bd" ? null : command),
  // Merge detection needs Git 2.41 or later.
  versionCommand: (command) =>
    Effect.succeed(command === "git" ? "git version 2.41.0" : `${command} version 1.0.0`),
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
  readVersion: () => Effect.succeed("1.0.0"),
  getRuntimeHealth: (kind, executablePath) =>
    Effect.succeed({
      kind,
      enabled: true,
      ok: true,
      executablePath,
      version: `${kind} 1.0.0`,
      error: null,
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

const observeRuntimeStates = (
  kinds: ReadonlyArray<RuntimeKind>,
  state: HostRuntimeStatus["state"],
) => {
  const matches = new Map<RuntimeKind, HostRuntimeStatus>();
  const statuses = Promise.withResolvers<HostRuntimeStatus[]>();
  const eventBus = createHostEventBus({ report: ({ cause }) => statuses.reject(cause) });
  const unsubscribe = eventBus.subscribe("openducktor://runtime-changed", (event) => {
    if (
      event.channel !== "openducktor://runtime-changed" ||
      event.payload.type !== "runtime_changed"
    )
      return;
    const { status } = event.payload;
    if (!kinds.includes(status.kind) || status.state !== state) return;
    matches.set(status.kind, status);
    if (matches.size === kinds.length) statuses.resolve([...matches.values()]);
  });
  onTestFinished(unsubscribe);
  return { eventBus, statuses: statuses.promise };
};

describe("createElectronHostCommandRouter", () => {
  test("stops every shared runtime on host shutdown", async () => {
    const configDirectory = await mkdtemp(path.join(tmpdir(), "openducktor-electron-dispose-"));
    const lifecycleLogs: string[] = [];
    const runtimeStarter = createRuntimeStarter();
    const { eventBus, statuses } = observeRuntimeStates(["opencode", "codex"], "ready");
    try {
      const router = await createElectronHostCommandRouter({
        eventBus,
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
        config: globalConfig({ agentRuntimes: agentRuntimes({ opencode: true, codex: true }) }),
      });
      await router.initialize();
      await statuses;

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
      const start = () =>
        createElectronHostCommandRouter({
          processEnvironmentInput: pathFailure(diagnostic, {
            OPENDUCKTOR_CONFIG_DIR: configDirectory,
          }),
        });

      await expect(start()).rejects.toThrow(diagnostic.message);
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

      await expect(start()).rejects.toThrow(diagnostic.message);
      expect(await readFile(configPath, "utf8")).toBe(legacyConfig);

      await writeFile(configPath, JSON.stringify({ version: 3 }));
      const router = await start();
      try {
        expect(await router.invoke("workspace_get_settings_snapshot")).toMatchObject({
          theme: "system",
        });
      } finally {
        await router.dispose();
      }
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
    const { eventBus, statuses } = observeRuntimeStates(["opencode"], "ready");
    const router = await createElectronHostCommandRouter({
      eventBus,
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      runtimeHealth: createRuntimeHealth(),
      runtimeStarter,
      config: globalConfig(),
    });

    try {
      expect(await router.invoke("runtime_definitions_list", {})).toMatchObject([
        { kind: "opencode" },
        { kind: "codex" },
        { kind: "claude" },
        { kind: "antigravity" },
      ]);

      await router.initialize();
      const [ready] = await statuses;
      expect(ready).toMatchObject({
        kind: "opencode",
        enabled: true,
        runtimeId: "opencode-1",
        trigger: "host_startup",
        failure: null,
      });
      const snapshot = hostRuntimeSnapshotSchema.parse(await router.invoke("runtime_status"));
      expect(snapshot.runtimes.find(({ kind }) => kind === "opencode")).toEqual(ready);
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
      config: globalConfig({ workspaces: { repo: repoConfig() }, workspaceOrder: ["repo"] }),
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
    const kinds = ["claude", "codex", "opencode"] as const;
    const { eventBus, statuses } = observeRuntimeStates(kinds, "error");
    const router = await createElectronHostCommandRouter({
      eventBus,
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      processEnvironmentInput: pathFailure(diagnostic),
      runtimeHealth: createRuntimeHealth(),
      config: globalConfig({
        agentRuntimes: agentRuntimes({ opencode: true, codex: true, claude: true }),
        workspaces: { repo: repoConfig() },
        workspaceOrder: ["repo"],
      }),
    });

    try {
      await router.initialize();
      const failed = await statuses;

      for (const runtimeKind of kinds) {
        expect(failed.find((status) => status.kind === runtimeKind)).toMatchObject({
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
    const { eventBus, statuses } = observeRuntimeStates(["opencode"], "error");
    const router = await createElectronHostCommandRouter({
      eventBus,
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      processEnvironmentInput: pathFailure(diagnostic),
      runtimeHealth: createRuntimeHealth(),
      runtimeStarter,
      config: globalConfig({
        workspaces: { repo: repoConfig() },
        workspaceOrder: ["repo"],
      }),
    });

    try {
      await router.initialize();
      const [status] = await statuses;

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
    });

    expect(await router.invoke("git_get_branches", { workspaceId: "repo", repoPath })).toEqual([
      { name: "main", isCurrent: true, isRemote: false },
    ]);
    expect(
      await router.invoke("git_get_current_branch", { workspaceId: "repo", repoPath }),
    ).toEqual({
      name: "main",
      detached: false,
      revision: "abc123",
    });
    expect(await router.invoke("git_get_status", { workspaceId: "repo", repoPath })).toEqual([
      { path: "src/main.ts", status: "modified", staged: false },
    ]);
    expect(await router.invoke("git_get_diff", { workspaceId: "repo", repoPath })).toEqual([
      {
        file: "src/main.ts",
        type: "modified",
        additions: 2,
        deletions: 1,
        diff: "@@ -1 +1 @@\n-old\n+new\n",
      },
    ]);
    expect(
      await router.invoke("git_get_worktree_status", {
        workspaceId: "repo",
        repoPath,
        targetBranch: "origin/main",
        diffScope: "uncommitted",
      }),
    ).toMatchObject({
      currentBranch: { name: "main" },
      fileDiffs: [{ file: "src/main.ts" }],
      snapshot: { targetBranch: "origin/main", diffScope: "uncommitted" },
    });
    expect(
      await router.invoke("git_commits_ahead_behind", {
        workspaceId: "repo",
        repoPath,
        targetBranch: "origin/main",
      }),
    ).toEqual({ ahead: 3, behind: 2 });
    expect(
      await router.invoke("git_switch_branch", {
        workspaceId: "repo",
        repoPath,
        branch: "feature/electron",
      }),
    ).toEqual({
      name: "feature/electron",
      detached: false,
      revision: "def456",
    });
    expect(
      await router.invoke("git_fetch_remote", {
        workspaceId: "repo",
        repoPath,
        targetBranch: "origin/main",
        force: true,
      }),
    ).toEqual({ outcome: "fetched", output: "Fetched origin" });
    expect(
      await router.invoke("git_pull_branch", {
        workspaceId: "repo",
        repoPath,
      }),
    ).toEqual({ outcome: "pulled", output: "Fast-forward" });
    expect(
      await router.invoke("git_commit_all", {
        workspaceId: "repo",
        repoPath,
        message: "Ship Electron host",
      }),
    ).toEqual({
      outcome: "committed",
      commitHash: "abc123",
      output: "[feature abc123] Ship Electron host",
    });
    expect(
      await router.invoke("git_push_branch", {
        workspaceId: "repo",
        repoPath,
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
        workspaceId: "repo",
        repoPath,
        targetBranch: "origin/main",
      }),
    ).toEqual({
      outcome: "rebased",
      output: "Successfully rebased",
    });
    expect(await router.invoke("git_rebase_abort", { workspaceId: "repo", repoPath })).toEqual({
      outcome: "aborted",
      output: "Successfully aborted rebase",
    });
    expect(
      await router.invoke("git_abort_conflict", {
        workspaceId: "repo",
        repoPath,
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
    });

    expect(await router.invoke("system_list_open_in_tools", {})).toEqual([
      { toolId: "finder", iconDataUrl: null },
    ]);
    expect(
      await router.invoke("system_open_directory_in_tool", {
        directoryPath: repoPath,
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
      config: globalConfig({
        workspaces: { repo: configuredRepo },
        workspaceOrder: ["repo"],
        recentWorkspaces: ["repo"],
      }),
      systemCommands: createSystemCommands(),
    });

    expect(
      await router.invoke("workspace_detect_github_repository", {
        workspaceId: "repo",
        repoPath,
      }),
    ).toEqual({
      host: "github.com",
      owner: "openai",
      name: "openducktor",
    });
    expect(
      await router.invoke("workspace_get_git_provider_context", {
        workspaceId: "repo",
        repoPath,
      }),
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
      const configRoot = await mkdtemp(path.join(tmpdir(), "odt-electron-diagnostics-"));
      configDirectories.push(configRoot);
      await writeFile(path.join(configRoot, "config.json"), JSON.stringify(globalConfig()));
      let runtimeProbes = 0;
      const router = await Effect.runPromise(
        createElectronEffectHostCommandRouter({
          isPackaged: false,
          lifecycleLogger: quietLifecycleLogger,
          onBackgroundFailure: () => Effect.void,
          terminalPty: unexpectedTerminalPty,
          processInspector: unexpectedProcessInspector,
          processNativeDirectory: "/missing-process-native",
          taskEventPublicationReporter: { report: () => Effect.void },
          browserEngine: () => Effect.succeed(createBrowserEngineTestDouble().engine),
          processEnv: {
            OPENDUCKTOR_CONFIG_DIR: configRoot,
            OPENDUCKTOR_DEV_INSTANCE: "electron-0123456789ab",
            PATH: "/usr/bin:/bin",
          },
          runtimeDistribution: testRuntimeDistribution,
          filesystem: createFilesystem(),
          git: createGit(),
          openInTools: createOpenInTools(),
          runtimeHealth: {
            ...createRuntimeHealth(),
            getRuntimeHealth: () => {
              runtimeProbes += 1;
              return failure === "runtime hang"
                ? Effect.never
                : Effect.succeed({
                    kind: "opencode",
                    enabled: true,
                    ok: false,
                    executablePath: null,
                    version: null,
                    error: "OpenCode is unavailable.",
                  } satisfies RuntimeHealth);
            },
          },
          systemCommands: createSystemCommands(),
        }),
      );
      try {
        if (failure === "settings failure") {
          await writeFile(path.join(configRoot, "config.json"), "{");
          const settings = await Effect.runPromise(
            router.invoke("workspace_get_settings_snapshot", {}).pipe(Effect.result),
          );
          expect(settings).toMatchObject({
            _tag: "Failure",
            failure: { message: expect.stringContaining("Invalid JSON") },
          });
        }
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
      config: globalConfig(),
      systemCommands: createSystemCommands(),
    });

    expect(await router.invoke("path_check", { force: true })).toMatchObject({
      ok: false,
      error: processEnvironmentError.message,
    });
    expect(
      await router.invoke("task_store_check", { workspaceId: "repo", repoPath }),
    ).toMatchObject({
      taskStoreOk: false,
      taskStoreError:
        "The workspace no longer matches this repository. Reload the workspace before retrying.",
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
        await expect(
          createElectronHostCommandRouter({
            filesystem: createFilesystem(),
            git: createGit(),
            openInTools: createOpenInTools(),
            processEnvironmentInput: pathFailure(processEnvironmentError, {
              OPENDUCKTOR_CONFIG_DIR: root,
            }),
            runtimeHealth: createRuntimeHealth(),
            systemCommands: createSystemCommands(),
          }),
        ).rejects.toThrow(processEnvironmentError.message);
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
      config: globalConfig({
        agentRuntimes: {
          ...agentRuntimes({ opencode: true }),
          opencode: {
            ...DEFAULT_AGENT_RUNTIMES.opencode,
            enabled: true,
            executablePath: opencode.executablePath,
          },
        },
      }),
      taskStore: createTaskStoreTestDouble({
        listAgentSessionsForTasks: ({ taskIds }) =>
          Effect.succeed(
            taskIds.map((taskId) => ({
              taskId,
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
            })),
          ),
      }),
    });
    try {
      await sessionStopRouter.initialize();
      await ready.promise;
      expect(
        await sessionStopRouter.invoke("agent_session_stop", {
          request: {
            workspaceId: "repo",
            repoPath,
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

  test("routes task reads and writes through the shared database", async () => {
    const router = await createElectronHostCommandRouter({
      filesystem: createFilesystem(),
      git: createGit(),
      openInTools: createOpenInTools(),
      config: globalConfig({ workspaces: { repo: repoConfig() }, workspaceOrder: ["repo"] }),
    });
    const workspace = { workspaceId: "repo", repoPath };
    const task = taskCardSchema.parse(
      await router.invoke("task_create", {
        ...workspace,
        input: { title: "Task 1", issueType: "task", priority: 2 },
      }),
    );
    const taskRef = { ...workspace, taskId: task.id };
    expect(await router.invoke("tasks_list", workspace)).toEqual([
      expect.objectContaining({ id: task.id, title: "Task 1" }),
    ]);
    expect(await router.invoke("task_metadata_get", taskRef)).toMatchObject({
      artifacts: {},
      agentSessions: [],
    });
    expect(await router.invoke("agent_sessions_list", taskRef)).toEqual([]);
    for (const code of ["spec", "plan"] as const) {
      expect(
        await router.invoke("workflow_artifact_save", {
          ...taskRef,
          code,
          markdown: `# ${code}`,
          submit: false,
        }),
      ).toMatchObject({
        markdown: `# ${code}`,
        revision: 1,
        cursor: { epoch: expect.any(String), sequence: expect.any(Number) },
      });
      expect(await router.invoke("workflow_artifact_get", { ...taskRef, code })).toMatchObject({
        markdown: `# ${code}`,
        revision: 1,
      });
    }
    // Creates a real database and commits task and artifact writes to disk.
  }, 5_000);
});
