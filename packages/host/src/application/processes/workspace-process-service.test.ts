import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceProcessStopRequest, WorkspaceRecord } from "@openducktor/contracts";
import { Effect } from "effect";
import { createGitCliAdapter } from "../../adapters/git/git-cli-adapter";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { HostDependencyError, HostPathAccessError } from "../../effect/host-errors";
import type { ManagedProcess } from "../../ports/process-inspector-port";
import type {
  LiveProcess,
  ProcessInspectorPort,
  ProcessStopOutcome,
  ProcessStopRequest,
} from "../../ports/process-inspector-port";
import type { WorktreeOwnershipChat } from "../../ports/workspace-session-store-port";
import {
  addGitWorktree,
  gitFixtureEnv,
  initGitRepository,
} from "../../test-support/git-repository-fixture";
import { repoConfigFixture } from "../../test-support/repo-config-fixture";
import {
  createSettingsConfigTestDouble,
  createWorkspaceSettingsServiceTestDouble,
} from "../../test-support/service-test-doubles";
import { removeTestDirectory } from "../../test-support/temp-directory";
import type { AssignmentDependencies } from "./workspace-process-assignment";
import {
  createWorkspaceProcessService,
  type WorkspaceProcessService,
} from "./workspace-process-service";

type StopOneRequest = Omit<WorkspaceProcessStopRequest, "processRefs"> & { processRef: string };

/** Stops one process and returns its result. */
const stopOne = (service: WorkspaceProcessService, { processRef, ...request }: StopOneRequest) =>
  Effect.runPromise(
    service
      .stop({ ...request, processRefs: [processRef] })
      .pipe(Effect.map(({ results }) => results[0]?.result)),
  );

const git = createGitCliAdapter({
  readEnv: () => gitFixtureEnv,
  resolveCommand: () => Effect.succeed("git"),
});

let root = "";
let repoPath = "";
let taskWorktree = "";
let chatWorktree = "";
let unattachedWorktree = "";
let vendorRepository = "";
let staleWorktree = "";
let trailingSpaceDirectory = "";

// One set of real Git checkouts serves every test, because each one costs many Git processes.
beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "odt-processes-")));
  repoPath = join(root, "repo");
  taskWorktree = join(root, "worktrees", "task-1");
  chatWorktree = join(root, "worktrees", "chat");
  unattachedWorktree = join(repoPath, "nested");
  vendorRepository = join(repoPath, "vendor", "lib");
  staleWorktree = join(root, "worktrees", "task-3");
  trailingSpaceDirectory = join(root, "worktrees", "task-1 ");
  await mkdir(repoPath, { recursive: true });
  await mkdir(join(root, "worktrees"));
  initGitRepository(repoPath);
  addGitWorktree(repoPath, taskWorktree, "odt/task-1-feature");
  addGitWorktree(repoPath, chatWorktree, "chat");
  addGitWorktree(repoPath, unattachedWorktree, "other");
  await mkdir(join(taskWorktree, "apps"), { recursive: true });
  await mkdir(vendorRepository, { recursive: true });
  initGitRepository(vendorRepository);
  // Git still lists a removed worktree until a prune. A plain directory now has its path.
  addGitWorktree(repoPath, staleWorktree, "odt/task-3-stale");
  await removeTestDirectory(staleWorktree);
  await mkdir(staleWorktree);
  await mkdir(trailingSpaceDirectory);
});

afterAll(async () => {
  await removeTestDirectory(root);
});

const process = (pid: number, cwd: string, overrides: Partial<LiveProcess> = {}): LiveProcess => ({
  pid,
  parentPid: 1,
  identity: `${pid}000`,
  name: "node",
  cwd,
  executable: "/usr/local/bin/node",
  arguments: ["node", "server.js"],
  ...overrides,
});

type Listener = { address: string; port: number };
type Input = number | "pipe" | "unreadable";

const createInspector = (input: {
  processes: () => LiveProcess[];
  listeners?: Record<number, Listener[]>;
  stopMode?: "instance" | "pid";
  stop?: (request: ProcessStopRequest) => Promise<ProcessStopOutcome>;
  /**
   * The standard input of each process: `pipe` for the stdio channel of a tool, a number for the
   * PID that serves a Windows input pipe, or `unreadable`. Other processes read `/dev/null`.
   */
  inputs?: Record<number, Input>;
}) => {
  const stops: ProcessStopRequest[] = [];
  const inspector: ProcessInspectorPort = {
    listProcesses: () => Effect.sync(input.processes),
    inspectProcesses: (targets) =>
      Effect.sync(() =>
        targets.map((target) => ({
          ...target,
          live: input.processes().some((entry) => entry.pid === target.pid),
          listeners: input.listeners?.[target.pid] ?? [],
          canStop: target.pid !== 120,
        })),
      ),
    stopMode: () => Effect.succeed(input.stopMode ?? "instance"),
    stopProcess: (request) =>
      Effect.promise(() => {
        // Like the native module, a PID-only system signals only with the user's consent.
        if (input.stopMode === "pid" && !request.allowPidSignal)
          return Promise.resolve({ kind: "acknowledgment_required" as const });
        stops.push(request);
        return input.stop?.(request) ?? Promise.resolve({ kind: "stopped" as const });
      }),
    readStandardInputs: (targets) =>
      Effect.sync(() =>
        targets.map((target) => {
          const value = input.inputs?.[target.pid];
          const read = { ...target, live: true };
          if (value === "unreadable") return { ...read, issue: "Access is denied." };
          if (value === "pipe") return { ...read, kind: "pipe" as const };
          if (value === undefined) return { ...read, kind: "other" as const };
          return { ...read, kind: "pipe" as const, serverPid: value };
        }),
      ),
  };
  return { inspector, stops };
};

const workspace = (): WorkspaceRecord => ({
  workspaceId: "repo",
  workspaceName: "Repo",
  abbreviation: null,
  tileColor: null,
  repoPath,
  isActive: true,
  hasConfig: true,
  configuredWorktreeBasePath: null,
  defaultWorktreeBasePath: null,
  effectiveWorktreeBasePath: join(root, "worktrees"),
});

const chat = (): WorktreeOwnershipChat => ({
  workspaceId: "repo",
  id: "chat-1",
  runtimeKind: "codex",
  externalSessionId: null,
  workingDirectory: chatWorktree,
  generatedTitle: null,
  manualTitle: "Research chat",
  archivedAt: 1_793_000_000_000,
});

const createService = (
  inspector: ProcessInspectorPort,
  options: {
    managed?: ReadonlyMap<number, ManagedProcess>;
    open?: boolean;
    hostLaunchPaths?: AssignmentDependencies["hostLaunchPaths"];
    /** A path whose read fails as a permission error does. */
    unreadablePath?: string;
    git?: typeof git;
  } = {},
) =>
  createWorkspaceProcessService({
    git: options.git ?? git,
    settingsConfig: createSettingsConfigTestDouble({
      readConfig: () =>
        Effect.succeed({
          ...createDefaultGlobalConfig(),
          workspaces: {
            repo: repoConfigFixture({
              repoPath,
              branchPrefix: "odt",
              worktreeBasePath: join(root, "worktrees"),
            }),
          },
        }),
      resolveConfiguredPath: (path: string) => path,
      join: (...paths: string[]) => join(...paths),
      pathExists: (path: string) =>
        path === options.unreadablePath
          ? Effect.fail(
              new HostPathAccessError({
                path,
                operation: "test.pathExists",
                message: "Permission denied.",
              }),
            )
          : Effect.sync(() => existsSync(path)),
    }),
    taskOwnership: {
      listTaskDirectoriesForWorktreeOwnership: () =>
        Effect.succeed([
          { workspaceId: "repo", taskId: "task-1", title: "Add login", sessionDirectories: [] },
          { workspaceId: "repo", taskId: "task-3", title: "Stale task", sessionDirectories: [] },
          {
            workspaceId: "repo",
            taskId: "task-2",
            title: "Closed task",
            sessionDirectories: [join(root, "worktrees", "removed")],
          },
        ]),
    },
    workspaceSessions: { listForWorktreeOwnership: () => Effect.succeed([chat()]) },
    workspaceSettings: createWorkspaceSettingsServiceTestDouble({
      getWorkspaceCatalog: () =>
        Effect.succeed({
          catalogRevision: 1,
          openWorkspaces: options.open === false ? [] : [workspace()],
          closedWorkspaces: [],
          incompleteRemovals: [],
        }),
    }),
    inspector,
    pathPlatform: "posix",
    hostProcessIds: () => [104],
    managedProcesses: () => options.managed ?? new Map(),
    hostLaunchPaths:
      options.hostLaunchPaths ?? Effect.succeed(["/opt/openducktor/openducktor-mcp.js"]),
    stopForcesExit: false,
    stopTimeoutMs: 1_000,
  });

const fixtureProcesses = (): LiveProcess[] => [
  process(101, join(taskWorktree, "apps"), { name: "vite" }),
  process(102, repoPath, { name: "zsh", executable: "/bin/zsh", arguments: ["-zsh", "-l"] }),
  process(103, repoPath, {
    name: "zsh",
    executable: "/bin/zsh",
    arguments: ["/bin/zsh", "-c", "bun dev"],
  }),
  process(104, repoPath, { name: "openducktor" }),
  process(105, repoPath, { name: "codex" }),
  // The agent runs a dev server through a shell. Its MCP server is a tool of the runtime.
  process(106, repoPath, {
    name: "zsh",
    parentPid: 105,
    executable: "/bin/zsh",
    arguments: ["/bin/zsh", "-c", "bun run dev"],
  }),
  process(122, repoPath, {
    name: "uv",
    parentPid: 105,
    executable: "/Users/me/.local/bin/uv",
    arguments: ["uv", "tool", "uvx", "--from", "semble[mcp]", "semble"],
  }),
  process(123, repoPath, { name: "python", parentPid: 122, arguments: ["python", "semble"] }),
  process(107, repoPath, { name: "chrome" }),
  process(108, repoPath, { name: "chrome-helper", parentPid: 107 }),
  process(109, unattachedWorktree, { name: "unattached" }),
  process(110, vendorRepository, { name: "vendored" }),
  process(111, root, { name: "tool", executable: join(repoPath, "tool") }),
  process(112, repoPath, { name: "postgres", executable: "/usr/lib/postgresql/bin/postgres" }),
  process(113, chatWorktree, {
    name: "python3",
    executable: "/usr/bin/python3",
    arguments: ["python3", "-m", "http.server", "8000"],
  }),
  process(114, tmpdir(), { name: "elsewhere" }),
  process(115, taskWorktree, { arguments: ["node", "/opt/openducktor/openducktor-mcp.js"] }),
  process(116, taskWorktree, { name: "mcp-helper", parentPid: 115 }),
  process(117, staleWorktree, { name: "stale" }),
  process(118, trailingSpaceDirectory, { name: "lookalike" }),
  {
    pid: 119,
    parentPid: 1,
    identity: "119000",
    name: "unreadable",
    executable: join(repoPath, "tool"),
    issue: "The system denied access to the process details.",
  },
];

const listeners = {
  101: [
    { address: "::", port: 5173 },
    { address: "0.0.0.0", port: 5173 },
  ],
  112: [{ address: "127.0.0.1", port: 5432 }],
  113: [{ address: "0.0.0.0", port: 8000 }],
} satisfies Record<number, Listener[]>;

/** The MCP server of the runtime reads its input from a pipe. */
const fixtureInputs = { 122: "pipe" } satisfies Record<number, Input>;

const managed = new Map<number, ManagedProcess>([
  [105, { kind: "runtime" }],
  [107, { kind: "infrastructure" }],
]);

describe("workspace process service", () => {
  test("groups project commands by checkout and omits idle shells and managed processes", async () => {
    const { inspector } = createInspector({
      processes: fixtureProcesses,
      listeners,
      inputs: fixtureInputs,
    });
    const result = await Effect.runPromise(createService(inspector, { managed }).list());
    expect(result.issues.map((issue) => issue.message)).toEqual([
      `Git does not confirm ${staleWorktree} as a worktree of workspace Repo, so its processes are hidden.`,
      "OpenDucktor cannot verify the checkout of 1 process, so the list hides it.",
    ]);
    const summary = result.groups.map((group) => ({
      checkoutPath: group.checkoutPath,
      kind: group.kind,
      owners: group.owners.map((owner) => owner.title),
      processes: group.processes.map((row) => row.pid),
    }));
    expect(summary).toEqual([
      { checkoutPath: repoPath, kind: "repository", owners: [], processes: [112, 111, 103, 106] },
      { checkoutPath: chatWorktree, kind: "worktree", owners: ["Research chat"], processes: [113] },
      { checkoutPath: taskWorktree, kind: "worktree", owners: ["Add login"], processes: [101] },
    ]);
    const vite = result.groups[2]?.processes[0];
    expect(vite?.listeners).toEqual([
      {
        address: "0.0.0.0",
        port: 5173,
        browser: { kind: "link", url: "http://127.0.0.1:5173/", suggested: true },
      },
      {
        address: "::",
        port: 5173,
        browser: { kind: "link", url: "http://[::1]:5173/", suggested: true },
      },
    ]);
    expect(result.groups[1]?.processes[0]?.listeners[0]?.browser).toEqual({
      kind: "link",
      url: "http://127.0.0.1:8000/",
      suggested: false,
    });
    expect(result.groups[0]?.processes[0]?.listeners[0]?.browser).toEqual({ kind: "non_web" });
  });

  // The host process is PID 104. A launcher level and the runtime inherit its input pipe.
  const npm = "C:/Users/me/AppData/Roaming/npm";
  const codexExecutable = `${npm}/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe`;
  const stockNode = process(131, repoPath, {
    parentPid: 130,
    executable: "C:/Program Files/nodejs/node.exe",
    arguments: [
      "node",
      String.raw`C:\Users\me\AppData\Roaming\npm\node_modules\@openai\codex\bin\codex.js`,
      "app-server",
    ],
  });
  const launcherChain = (runtimeParent: LiveProcess) => [
    process(130, repoPath, {
      name: "cmd",
      executable: "C:/Windows/System32/cmd.exe",
      arguments: ["cmd.exe", "/d", "/s", "/c", '"%OPENDUCKTOR_WINDOWS_COMMAND%"'],
    }),
    runtimeParent,
    process(132, repoPath, {
      name: "codex",
      parentPid: 131,
      executable: codexExecutable,
      arguments: ["codex.exe", "app-server"],
    }),
    process(133, repoPath, {
      name: "cmd",
      parentPid: 132,
      executable: "C:/Windows/System32/cmd.exe",
      arguments: ["cmd.exe", "/c", "npm run app-server"],
    }),
    process(134, repoPath, { name: "node", parentPid: 133, arguments: ["node", "server.js"] }),
    process(135, repoPath, { name: "vite", parentPid: 132, arguments: ["node", "vite"] }),
  ];
  const launcherRows = async (processes: LiveProcess[], inputs: Record<number, Input>) => {
    const { inspector, stops } = createInspector({ processes: () => processes, inputs });
    const service = createService(inspector, {
      managed: new Map<number, ManagedProcess>([[130, { kind: "runtime_launcher" }]]),
    });
    const result = await Effect.runPromise(service.list());
    const rows = result.groups.flatMap((group) => group.processes);
    return { rows, service, stops };
  };

  test("hides the launcher levels and never stops the other processes below a launcher", async () => {
    const { rows, service, stops } = await launcherRows(launcherChain(stockNode), {
      131: 104,
      132: 104,
    });
    // The launcher levels and codex.exe read their input from the host, so they are hidden. The
    // runtime runs vite directly, so it is a command of the agent.
    expect(rows.map((row) => row.pid).sort()).toEqual([133, 134, 135]);
    expect(rows.every((row) => !row.stop.allowed)).toBe(true);
    expect(
      await stopOne(service, {
        workspaceId: "repo",
        checkoutPath: repoPath,
        processRef: "134:134000",
      }),
    ).toMatchObject({ kind: "out_of_date" });
    expect(stops).toEqual([]);
  });

  test("never stops a launcher descendant that a relay or a branch can hide", async () => {
    const launcher = process(130, repoPath, {
      name: "cmd",
      executable: "C:/Windows/System32/cmd.exe",
      arguments: ["cmd.exe", "/c", "custom-codex.cmd"],
    });
    const node = (pid: number, parentPid: number) =>
      process(pid, repoPath, { parentPid, arguments: ["node", `step-${pid}.js`] });
    const runtime = (parentPid: number) =>
      process(136, repoPath, {
        name: "codex",
        parentPid,
        executable: "C:/tools/codex/codex.exe",
        arguments: ["codex.exe", "app-server"],
      });
    // A pipe relay, an IPC relay with closed input, an unreadable relay, and a branch with its
    // own input all leave the runtime without proof of its role.
    for (const [records, inputs] of [
      [[launcher, node(131, 130), runtime(131)], { 131: 104, 136: 131 }],
      [[launcher, node(131, 130), node(132, 131), runtime(132)], { 131: 104, 136: 132 }],
      [[launcher, node(131, 130), runtime(131)], { 131: 104, 136: "unreadable" }],
      [[launcher, node(131, 130), node(132, 130), runtime(132)], { 131: 104, 136: 131 }],
    ] satisfies [LiveProcess[], Record<number, Input>][]) {
      const { rows, service, stops } = await launcherRows(records, inputs);
      // The runtime stays hidden as a runtime, so no row can stop it.
      expect(rows.find((row) => row.pid === 136)).toBeUndefined();
      expect(
        await stopOne(service, {
          workspaceId: "repo",
          checkoutPath: repoPath,
          processRef: "136:136000",
        }),
      ).toMatchObject({ kind: "out_of_date" });
      expect(stops).toEqual([]);
    }
  });

  test("ignores a parent PID that a later process took", async () => {
    const chain = launcherChain(
      process(131, repoPath, { parentPid: 130, arguments: ["node", "codex.js", "app-server"] }),
    );
    // The launcher has PID 130 now. An older process still names an exited PID 130 as parent,
    // and the launcher names that older process as its parent.
    const older = process(129, repoPath, { identity: "1", parentPid: 130 });
    const [launcher, ...rest] = chain;
    if (!launcher) throw new Error("The launcher chain is empty.");
    const { rows } = await launcherRows([older, { ...launcher, parentPid: 129 }, ...rest], {
      131: 104,
      132: 104,
    });
    expect(rows.map((row) => row.pid).sort()).toEqual([129, 133, 134, 135]);
  });

  test("hides the processes that started the host", async () => {
    // `npx` runs the web host from a checkout: `npm exec` starts `sh -c`, which starts the host.
    const launcher = [
      process(97, repoPath, { name: "npm exec", identity: "97" }),
      process(98, repoPath, {
        name: "sh",
        identity: "98",
        parentPid: 97,
        executable: "/bin/sh",
        arguments: ["sh", "-c", "openducktor-web"],
      }),
    ];
    const host = process(104, repoPath, { name: "openducktor", parentPid: 98 });
    const rows = async (processes: LiveProcess[]) => {
      const { inspector } = createInspector({ processes: () => processes });
      const result = await Effect.runPromise(createService(inspector).list());
      return result.groups.flatMap((group) => group.processes.map((row) => row.pid));
    };
    expect(await rows([...launcher, host])).toEqual([]);
    // A newer process took the PID of the exited parent, so it did not start the host.
    const newer = process(98, repoPath, { identity: "999999999" });
    expect(await rows([newer, host])).toEqual([98]);
  });

  test("turns Stop off when the MCP servers of the agents are unknown", async () => {
    const { inspector, stops } = createInspector({
      processes: fixtureProcesses,
      listeners,
      inputs: fixtureInputs,
    });
    const service = createService(inspector, {
      managed,
      hostLaunchPaths: Effect.fail(
        new HostDependencyError({
          dependency: "bun",
          operation: "test.hostLaunchPaths",
          message: "Bun is missing.",
        }),
      ),
    });
    const result = await Effect.runPromise(service.list());
    expect(result.issues).toContainEqual({
      message:
        "OpenDucktor cannot identify the MCP servers of its agents, so Stop is off in this list. Bun is missing.",
      nextAction: "Check the runtime settings, then refresh.",
    });
    const rows = result.groups.flatMap((group) => group.processes);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => !row.stop.allowed)).toBe(true);
    const [row] = rows;
    if (!row) throw new Error("The list has no rows.");
    expect(
      await stopOne(service, {
        workspaceId: "repo",
        checkoutPath: repoPath,
        processRef: row.processRef,
      }),
    ).toMatchObject({ kind: "out_of_date" });
    expect(stops).toEqual([]);
  });

  test("hides the tools of the host and keeps the commands of its terminals", async () => {
    const processes = [
      process(104, repoPath, { name: "openducktor" }),
      process(140, repoPath, {
        name: "gh",
        parentPid: 104,
        executable: "/opt/homebrew/bin/gh",
        arguments: ["gh", "pr", "checks"],
      }),
      process(141, repoPath, {
        name: "zsh",
        parentPid: 104,
        executable: "/bin/zsh",
        arguments: ["/bin/zsh", "-c", "npm run dev"],
      }),
      process(142, repoPath, { name: "node", parentPid: 141, arguments: ["node", "vite"] }),
    ];
    const { inspector } = createInspector({ processes: () => processes, inputs: { 140: "pipe" } });
    const result = await Effect.runPromise(createService(inspector).list());
    expect(result.groups.flatMap((group) => group.processes.map((row) => row.pid))).toEqual([
      142, 141,
    ]);
  });

  test("hides the tools of a runtime server that another app runs", async () => {
    const home = tmpdir();
    const processes = [
      process(160, home, {
        name: "opencode",
        executable: "/Users/me/.opencode/bin/opencode",
        arguments: ["/Users/me/.opencode/bin/opencode", "serve", "--stdio", "--port", "0"],
      }),
      process(161, repoPath, { name: "uv", parentPid: 160, arguments: ["uv", "tool", "uvx"] }),
      process(162, repoPath, { name: "python", parentPid: 161, arguments: ["python", "semble"] }),
      process(163, repoPath, {
        name: "zsh",
        parentPid: 160,
        executable: "/bin/zsh",
        arguments: ["/bin/zsh", "-c", "bun run dev"],
      }),
      process(170, home, {
        name: "codex",
        executable: "/usr/local/bin/codex",
        arguments: ["codex", "app-server"],
      }),
      process(171, repoPath, { name: "node_repl", parentPid: 170, arguments: ["node_repl"] }),
    ];
    const { inspector } = createInspector({
      processes: () => processes,
      inputs: { 161: "pipe", 171: "pipe" },
    });
    const result = await Effect.runPromise(createService(inspector).list());
    expect(result.groups.flatMap((group) => group.processes.map((row) => row.pid))).toEqual([163]);
  });

  // The trees of a real run: the host (104) starts Codex and Claude Code. Codex runs `pnpm dev`
  // directly, Claude Code runs each command through `zsh -c`, and both talk to their MCP servers
  // over the standard input.
  const agentRuns = () => {
    const home = tmpdir();
    const claude = (pid: number, parentPid: number) =>
      process(pid, repoPath, {
        name: "2.1.0",
        parentPid,
        executable: "/Users/me/.local/share/claude/versions/2.1.0",
        arguments: [
          "/Users/me/.local/bin/claude",
          "--output-format",
          "stream-json",
          "--input-format",
          "stream-json",
        ],
      });
    const zsh = (pid: number, parentPid: number, command: string) =>
      process(pid, repoPath, {
        name: "zsh",
        parentPid,
        executable: "/bin/zsh",
        arguments: ["/bin/zsh", "-c", `source snapshot.sh && eval '${command}' < /dev/null`],
      });
    const semble = (pid: number, parentPid: number) =>
      process(pid, repoPath, { name: "uv", parentPid, arguments: ["uv", "tool", "uvx", "semble"] });
    return [
      process(104, home, { name: "node", arguments: ["node", "dist/cli.js"] }),
      process(200, home, {
        name: "codex",
        parentPid: 104,
        executable: "/usr/local/bin/codex",
        arguments: ["codex", "app-server"],
      }),
      process(201, repoPath, { name: "pnpm", parentPid: 200, arguments: ["pnpm", "dev"] }),
      process(202, repoPath, { parentPid: 201, arguments: ["node", "turbo", "run", "dev"] }),
      semble(203, 200),
      process(204, repoPath, { name: "python", parentPid: 203, arguments: ["python", "semble"] }),
      claude(210, 104),
      zsh(211, 210, "rtk sleep 120"),
      process(212, repoPath, { name: "rtk", parentPid: 211, arguments: ["rtk", "sleep", "120"] }),
      process(213, repoPath, { name: "sleep", parentPid: 212, arguments: ["sleep", "120"] }),
      semble(214, 210),
      // Claude Code of another OpenDucktor app, with a command and a language server.
      claude(220, 300),
      zsh(221, 220, "bun test --watch"),
      process(222, repoPath, {
        parentPid: 220,
        arguments: ["node", "typescript-language-server", "--stdio"],
      }),
    ];
  };
  const agentManaged = new Map<number, ManagedProcess>([
    [200, { kind: "runtime" }],
    [210, { kind: "runtime" }],
  ]);

  test("lists the commands that agents run and hides their tools", async () => {
    const { inspector } = createInspector({
      processes: agentRuns,
      inputs: { 203: "pipe", 214: "pipe", 222: "pipe" },
    });
    const result = await Effect.runPromise(
      createService(inspector, { managed: agentManaged }).list(),
    );
    const rows = result.groups.flatMap((group) => group.processes);
    expect(rows.map((row) => row.pid).sort()).toEqual([201, 202, 211, 212, 213, 221]);
    // A command that a runtime starts directly is no app helper.
    expect(rows.find((row) => row.pid === 201)?.launcher).toBeUndefined();
    expect(rows.find((row) => row.pid === 213)).toMatchObject({ parentRef: "212:212000" });
    expect(rows.every((row) => row.stop.allowed)).toBe(true);
  });

  test("keeps a runtime child whose input is unreadable, without Stop", async () => {
    const { inspector } = createInspector({
      processes: agentRuns,
      inputs: { 201: "unreadable", 203: "pipe", 214: "pipe", 222: "pipe" },
    });
    const result = await Effect.runPromise(
      createService(inspector, { managed: agentManaged }).list(),
    );
    const pnpm = result.groups.flatMap((group) => group.processes).find((row) => row.pid === 201);
    expect(pnpm?.stop).toMatchObject({ allowed: false });
  });

  test("lists nothing while no workspace is open", async () => {
    const { inspector } = createInspector({
      processes: fixtureProcesses,
      listeners,
      inputs: fixtureInputs,
    });
    const result = await Effect.runPromise(createService(inspector, { open: false }).list());
    expect(result).toEqual({ groups: [], issues: [] });
  });

  test("reports an unreadable task worktree and keeps the other checkouts", async () => {
    const { inspector } = createInspector({
      processes: fixtureProcesses,
      listeners,
      inputs: fixtureInputs,
    });
    const result = await Effect.runPromise(
      createService(inspector, { unreadablePath: taskWorktree }).list(),
    );
    expect(result.groups.map((group) => group.checkoutPath)).not.toContain(taskWorktree);
    expect(
      result.issues.some((issue) =>
        issue.message.startsWith(`OpenDucktor cannot read ${taskWorktree}`),
      ),
    ).toBe(true);
  });

  test("links each process to the command that started it in the same checkout", async () => {
    const apps = join(taskWorktree, "apps");
    const processes = () => [
      process(150, apps, { name: "pnpm", arguments: ["pnpm", "dev"] }),
      process(151, apps, { parentPid: 150, arguments: ["node", "vite.js"] }),
      process(152, apps, { parentPid: 151, name: "esbuild", arguments: ["esbuild"] }),
      process(153, repoPath, { parentPid: 150 }),
      process(154, taskWorktree, { arguments: ["node", "worker.js"] }),
    ];
    const { inspector } = createInspector({ processes });
    const list = await Effect.runPromise(createService(inspector).list());
    const rows = list.groups.flatMap((group) => group.processes);
    const linkOf = (pid: number) => {
      const row = rows.find((candidate) => candidate.pid === pid);
      return { parentRef: row?.parentRef, directory: row?.directory };
    };
    expect(linkOf(150)).toEqual({ parentRef: undefined, directory: "apps" });
    expect(linkOf(151)).toEqual({ parentRef: "150:150000", directory: "apps" });
    expect(linkOf(152)).toEqual({ parentRef: "151:151000", directory: "apps" });
    // A process in another checkout starts its own tree.
    expect(linkOf(153)).toEqual({ parentRef: undefined, directory: "" });
    expect(linkOf(154)).toEqual({ parentRef: undefined, directory: "" });
  });

  test("names the app that started a process without a shell", async () => {
    const processes = () => [
      process(180, tmpdir(), {
        name: "zed",
        executable: "/Applications/Zed.app/Contents/MacOS/zed",
        arguments: ["/Applications/Zed.app/Contents/MacOS/zed"],
      }),
      process(181, repoPath, { parentPid: 180, arguments: ["node", "json-language-server"] }),
      process(182, repoPath, { name: "zsh", executable: "/bin/zsh", arguments: ["-zsh"] }),
      process(183, repoPath, { parentPid: 182, name: "pnpm", arguments: ["pnpm", "dev"] }),
      process(184, repoPath, {
        parentPid: 180,
        name: "zsh",
        executable: "/bin/zsh",
        arguments: ["/bin/zsh", "-c", "bun test"],
      }),
      process(185, repoPath, { name: "vite", arguments: ["node", "vite"] }),
    ];
    const { inspector } = createInspector({ processes });
    const list = await Effect.runPromise(createService(inspector).list());
    const rows = list.groups.flatMap((group) => group.processes);
    const launcher = (pid: number) => rows.find((row) => row.pid === pid)?.launcher;
    expect(launcher(181)).toBe("Zed");
    // A terminal shell, a shell command of the app, and an orphan of a closed terminal.
    expect(launcher(183)).toBeUndefined();
    expect(launcher(184)).toBeUndefined();
    expect(launcher(185)).toBeUndefined();
  });

  test("reuses the Git roots between list reads and reads them again for a stop", async () => {
    let worktreeLists = 0;
    const countingGit: typeof git = {
      ...git,
      listWorktrees: (...args) => {
        worktreeLists += 1;
        return git.listWorktrees(...args);
      },
    };
    const { inspector } = createInspector({
      processes: fixtureProcesses,
      listeners,
      inputs: fixtureInputs,
    });
    const service = createService(inspector, { managed, git: countingGit });
    await Effect.runPromise(service.list());
    await Effect.runPromise(service.list());
    expect(worktreeLists).toBe(1);
    await stopOne(service, {
      workspaceId: "repo",
      checkoutPath: repoPath,
      processRef: "112:112000",
    });
    expect(worktreeLists).toBe(2);
  });

  test("stops the processes of one request after one read", async () => {
    const apps = join(taskWorktree, "apps");
    let reads = 0;
    const { inspector, stops } = createInspector({
      processes: () => {
        reads += 1;
        return [
          process(150, apps, { name: "pnpm", arguments: ["pnpm", "dev"] }),
          process(151, apps, { parentPid: 150, arguments: ["node", "vite.js"] }),
        ];
      },
    });
    const response = await Effect.runPromise(
      createService(inspector).stop({
        workspaceId: "repo",
        checkoutPath: taskWorktree,
        processRefs: ["150:150000", "151:151000", "151:999"],
      }),
    );
    expect(response.results).toEqual([
      { processRef: "150:150000", result: { kind: "stopped" } },
      { processRef: "151:151000", result: { kind: "stopped" } },
      { processRef: "151:999", result: { kind: "already_exited" } },
    ]);
    expect(stops.map((entry) => entry.pid).sort()).toEqual([150, 151]);
    expect(reads).toBe(1);
  });

  test("stops a verified process with its directory evidence", async () => {
    const { inspector, stops } = createInspector({
      processes: fixtureProcesses,
      listeners,
      inputs: fixtureInputs,
    });
    const result = await stopOne(createService(inspector, { managed }), {
      workspaceId: "repo",
      checkoutPath: taskWorktree,
      processRef: "101:101000",
    });
    expect(result).toEqual({ kind: "stopped" });
    expect(stops).toEqual([
      {
        pid: 101,
        identity: "101000",
        evidenceKind: "cwd",
        evidencePath: join(taskWorktree, "apps"),
        timeoutMs: 1_000,
        allowPidSignal: false,
      },
    ]);
  });

  test("refuses stale and ineligible stop requests before the signal", async () => {
    const { inspector, stops } = createInspector({
      processes: fixtureProcesses,
      listeners,
      inputs: fixtureInputs,
    });
    const service = createService(inspector, { managed });
    const stop = (checkoutPath: string, processRef: string) =>
      stopOne(service, { workspaceId: "repo", checkoutPath, processRef });
    expect(await stop(taskWorktree, "101:999")).toEqual({ kind: "already_exited" });
    expect(await stop(repoPath, "101:101000")).toMatchObject({ kind: "out_of_date" });
    expect(await stop(repoPath, "105:105000")).toMatchObject({ kind: "out_of_date" });
    expect(await stop(repoPath, "102:102000")).toMatchObject({ kind: "out_of_date" });
    expect(await stop(staleWorktree, "117:117000")).toMatchObject({
      kind: "out_of_date",
    });
    expect(await stop(`${taskWorktree} `, "118:118000")).toMatchObject({ kind: "out_of_date" });
    expect(await stop(repoPath, "119:119000")).toMatchObject({
      kind: "out_of_date",
      issue: { message: "OpenDucktor cannot verify the checkout of this process." },
    });
    expect(stops).toEqual([]);
  });

  test("requires the PID reuse acknowledgment on a PID-only system", async () => {
    const { inspector, stops } = createInspector({
      processes: fixtureProcesses,
      inputs: fixtureInputs,
      listeners,
      stopMode: "pid",
    });
    const service = createService(inspector);
    const list = await Effect.runPromise(service.list());
    expect(list.groups[0]?.processes[0]?.stop).toEqual({
      allowed: true,
      requiresPidReuseAcknowledgment: true,
      forced: false,
    });
    const request = { workspaceId: "repo", checkoutPath: repoPath, processRef: "112:112000" };
    expect(await stopOne(service, request)).toMatchObject({ kind: "out_of_date" });
    expect(await stopOne(service, { ...request, acknowledgedPidReuseRisk: true })).toEqual({
      kind: "stopped",
    });
    expect(stops.map((entry) => entry.allowPidSignal)).toEqual([true]);
  });

  test("holds one pending stop per process instance", async () => {
    const release = Promise.withResolvers<ProcessStopOutcome>();
    const { inspector } = createInspector({
      processes: fixtureProcesses,
      inputs: fixtureInputs,
      listeners,
      stop: () => release.promise,
    });
    const service = createService(inspector);
    const request = { workspaceId: "repo", checkoutPath: repoPath, processRef: "112:112000" };
    const first = stopOne(service, request);
    expect(await stopOne(service, request)).toMatchObject({ kind: "pending" });
    release.resolve({ kind: "still_running", message: "The process ignored the stop signal." });
    expect(await first).toEqual({
      kind: "still_running",
      issue: { message: "The process ignored the stop signal.", nextAction: "Refresh the list." },
    });
  });
});
