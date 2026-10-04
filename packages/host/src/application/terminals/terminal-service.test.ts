import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import {
  repoConfigSchema,
  type TerminalServerMessage,
  type WorkspaceSession,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { createTerminalLaunchEnvironment } from "../../infrastructure/terminals/terminal-launch-environment";
import type { FilesystemPort } from "../../ports/filesystem-port";
import {
  TerminalPtyError,
  type TerminalPtyHandlers,
  type TerminalPtyPort,
} from "../../ports/terminal-pty-port";
import { TERMINAL_LIMITS } from "./terminal-limits";
import { TerminalScreenState } from "./terminal-screen-state";
import {
  HostOperationError,
  HostResourceError,
  HostValidationError,
} from "../../effect/host-errors";
import { createGitPortTestDouble } from "../../test-support/service-test-doubles";
import { createTerminalService } from "./terminal-service";
import type { WithProcessStartAdmission } from "../workspaces/workspace-admission-service";
import type { TaskWorktreeService } from "../tasks/worktrees/task-worktree-service";
import type { TerminalTitleSettlementScheduler } from "./terminal-title-settler";

let directoryAvailable = true;
const filesystem: FilesystemPort = {
  homeDirectory: () => "/home/user",
  canonicalize: (path: string) => Effect.succeed(`/canonical${path}`),
  readDirectory: () => Effect.succeed([]),
  readFileBytes: () => Effect.succeed(new Uint8Array()),
  readFileSnapshot: () => Effect.die("not used"),
  replaceFileBytes: () => Effect.die("not used"),
  stat: () => Effect.succeed({ isDirectory: directoryAvailable }),
  exists: () => Effect.succeed(true),
  join: posix.join,
  relative: posix.relative,
  parent: (path) => (path === "/" ? null : posix.dirname(path)),
};

const makePty = (supportsOutputPause = true, hasChildProcesses = true) => {
  const operations: string[] = [];
  const startDirectories: string[] = [];
  let handlers: TerminalPtyHandlers | null = null;
  let terminateFails = false;
  let terminateFailuresRemaining = 0;
  const port: TerminalPtyPort = {
    start: (plan, nextHandlers) => {
      startDirectories.push(plan.cwd);
      handlers = nextHandlers;
      return Effect.succeed({
        supportsOutputPause,
        hasChildProcesses: () =>
          Effect.sync(() => {
            operations.push("inspect-children");
            return hasChildProcesses;
          }),
        write: (data) =>
          Effect.sync(() => operations.push(`write:${new TextDecoder().decode(data)}`)),
        resize: (grid) => Effect.sync(() => operations.push(`resize:${grid.columns}x${grid.rows}`)),
        pauseOutput: () => Effect.sync(() => operations.push("pause")),
        resumeOutput: () => Effect.sync(() => operations.push("resume")),
        terminate: () =>
          Effect.suspend(() => {
            if (terminateFails || terminateFailuresRemaining > 0) {
              if (terminateFailuresRemaining > 0) terminateFailuresRemaining -= 1;
              return Effect.fail(
                new TerminalPtyError({
                  code: "operation_failed",
                  operation: "terminate",
                  message: "busy",
                }),
              );
            }
            return Effect.sync(() => operations.push("terminate"));
          }),
      });
    },
  };
  return {
    port,
    operations,
    startDirectories,
    emit: (data: Uint8Array) => handlers?.onOutput(data),
    exit: (exitCode: number | null = 0) => handlers?.onExit({ exitCode, signal: null }),
    fail: (failure: TerminalPtyError) => handlers?.onFailure(failure),
    failTerminate: () => {
      terminateFails = true;
    },
    failNextTerminate: () => {
      terminateFailuresRemaining += 1;
    },
  };
};

const waitForPtyOperation = async (operations: string[], operation: string): Promise<void> => {
  for (let attempt = 0; attempt < 200 && !operations.includes(operation); attempt += 1) {
    await Bun.sleep(10);
  }
  expect(operations).toContain(operation);
};

const emitEvictedReplay = async (pty: ReturnType<typeof makePty>): Promise<void> => {
  const chunk = new Uint8Array(64 * 1024).fill(120);
  for (let index = 0; index < TERMINAL_LIMITS.replayBytes / chunk.byteLength + 1; index += 1) {
    pty.emit(chunk);
    await Bun.sleep(0);
  }
};

const makeTitleSettlementScheduler = () => {
  const scheduled = new Set<() => void>();
  const schedule: TerminalTitleSettlementScheduler = (_delay, settle) => {
    scheduled.add(settle);
    return () => scheduled.delete(settle);
  };
  return {
    schedule,
    flush: () => {
      const pending = [...scheduled];
      scheduled.clear();
      for (const settle of pending) settle();
    },
  };
};

let fakeShellRoot: string | null = null;
let fakeShellPath: string | null = null;
const resolveFakeShellPath = async (): Promise<string> => {
  if (fakeShellPath !== null) {
    return fakeShellPath;
  }

  const root = await mkdtemp(join(tmpdir(), "odt-terminal-service-"));
  const shellPath = join(root, "sh");
  await writeFile(shellPath, "#!/bin/sh\n");
  await chmod(shellPath, 0o755);
  fakeShellRoot = root;
  fakeShellPath = shellPath;
  return shellPath;
};

afterAll(async () => {
  if (fakeShellRoot !== null) {
    await rm(fakeShellRoot, { force: true, recursive: true });
  }
});

const makeService = async (
  pty = makePty(),
  idFactory: () => string = () => "terminal-1",
  filesystemPort: FilesystemPort = filesystem,
  withProcessStartAdmission?: WithProcessStartAdmission,
  workspaceSessions?: ReturnType<typeof workspaceTerminalDependencies>,
  taskWorktrees?: Pick<TaskWorktreeService, "getTaskWorktree">,
) => {
  const titleSettlement = makeTitleSettlementScheduler();
  const shellPath = await resolveFakeShellPath();
  const targets = workspaceSessions ?? workspaceTerminalDependencies(new Map());
  const serviceInput: Parameters<typeof createTerminalService>[0] = {
    filesystem: filesystemPort,
    git: targets.git,
    taskWorktrees: taskWorktrees ?? {
      getTaskWorktree: ({ repoPath }) =>
        Effect.succeed({ workingDirectory: repoPath.replace(/^\/canonical/, "") }),
    },
    workspaceSessions: { settings: targets.settings, store: targets.store },
    ptyPort: pty.port,
    resolveLaunchEnvironment: createTerminalLaunchEnvironment({
      processEnv: { PATH: "/usr/bin" },
      platform: "darwin",
      readUserShell: () => shellPath,
    }),
    idFactory,
    hostInstanceIdFactory: () => "host-1",
    now: () => new Date("2026-07-12T00:00:00.000Z"),
    scheduleTitleSettlement: titleSettlement.schedule,
  };
  if (withProcessStartAdmission) {
    serviceInput.withProcessStartAdmission = withProcessStartAdmission;
  }
  return {
    pty,
    settleTitles: titleSettlement.flush,
    service: await Effect.runPromise(createTerminalService(serviceInput)),
  };
};

const workspaceSessionRecord = (
  id: string,
  executionTarget: WorkspaceSession["executionTarget"],
): WorkspaceSession => ({
  id,
  runtimeKind: "opencode",
  externalSessionId: null,
  executionTarget,
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: null,
  manualTitle: null,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
});

const workspaceTerminalDependencies = (records: Map<string, WorkspaceSession>) => ({
  settings: {
    getRepoConfig: () =>
      Effect.succeed(
        repoConfigSchema.parse({
          workspaceId: "workspace-1",
          workspaceName: "Workspace",
          repoPath: "/repo",
        }),
      ),
  },
  store: {
    get: ({ sessionId }: { sessionId: string }) => {
      const record = records.get(sessionId);
      return record
        ? Effect.succeed(record)
        : Effect.fail(
            new HostResourceError({
              resource: sessionId,
              operation: "workspaceSessionStore.get",
              message: "Missing chat",
            }),
          );
    },
  },
  git: createGitPortTestDouble({
    canonicalizePath: (path) => Effect.succeed(path),
    isGitRepository: () => Effect.succeed(true),
    shareGitCommonDirectory: () => Effect.succeed(true),
    isRegisteredWorktree: () => Effect.succeed(true),
  }),
});

describe("TerminalService", () => {
  test("starts root and worktree chat terminals in their saved directories and keeps owners separate", async () => {
    const records = new Map<string, WorkspaceSession>([
      [
        "root",
        workspaceSessionRecord("root", { kind: "local_repo_root", workingDirectory: "/repo" }),
      ],
      [
        "worktree",
        workspaceSessionRecord("worktree", {
          kind: "local_worktree",
          workingDirectory: "/repo-worktree",
          branchName: "chat",
          worktreeState: "present",
        }),
      ],
    ]);
    const pty = makePty();
    let nextId = 0;
    const { service } = await makeService(
      pty,
      () => `terminal-${++nextId}`,
      { ...filesystem, canonicalize: (path) => Effect.succeed(path) },
      undefined,
      workspaceTerminalDependencies(records),
    );
    const owner = (sessionId: string) => ({
      kind: "workspace_session" as const,
      workspaceId: "workspace-1",
      sessionId,
      repoPath: "/repo",
    });
    const root = await Effect.runPromise(
      service.create({ workingDir: "/repo", context: owner("root") }),
    );
    const worktree = await Effect.runPromise(
      service.create({ workingDir: "/repo-worktree", context: owner("worktree") }),
    );
    await Effect.runPromise(
      service.create({ workingDir: "/repo", context: { repoPath: "/repo", taskId: "task" } }),
    );
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    expect(pty.startDirectories).toEqual(["/repo", "/repo-worktree", "/repo", "/repo"]);
    expect(root.summary.context).toEqual(owner("root"));
    expect(worktree.summary.initialWorkingDir).toBe("/repo-worktree");
    expect(
      (
        await Effect.runPromise(
          service.list({
            kind: "workspace_session",
            workspaceId: "workspace-1",
            sessionId: "root",
          }),
        )
      ).terminals.map((entry) => entry.terminalId),
    ).toEqual([root.ref.terminalId]);
    expect(
      (
        await Effect.runPromise(
          service.list({
            kind: "workspace_session",
            workspaceId: "workspace-1",
            sessionId: "worktree",
          }),
        )
      ).terminals.map((entry) => entry.terminalId),
    ).toEqual([worktree.ref.terminalId]);
    expect(
      (await Effect.runPromise(service.list({ kind: "unassociated" }))).terminals,
    ).toHaveLength(1);
    expect(
      (await Effect.runPromise(service.inspectWorkspaceActivity("/repo"))).activeTerminalIds,
    ).toEqual([root.ref.terminalId, worktree.ref.terminalId, "terminal-3"]);
  });

  test("rejects stale or unsafe chat targets before starting a PTY", async () => {
    const root = workspaceSessionRecord("root", {
      kind: "local_repo_root",
      workingDirectory: "/repo",
    });
    const worktree = workspaceSessionRecord("worktree", {
      kind: "local_worktree",
      workingDirectory: "/repo-worktree",
      branchName: "chat",
      worktreeState: "present",
    });
    const records = new Map([
      ["root", root],
      ["worktree", worktree],
    ]);
    const dependencies = workspaceTerminalDependencies(records);
    const pty = makePty();
    const { service } = await makeService(
      pty,
      undefined,
      { ...filesystem, canonicalize: (path) => Effect.succeed(path) },
      undefined,
      dependencies,
    );
    const create = (sessionId: string, workingDir: string, repoPath = "/repo") =>
      Effect.runPromise(
        service.create({
          workingDir,
          context: { kind: "workspace_session", workspaceId: "workspace-1", sessionId, repoPath },
        }),
      );
    await expect(create("missing", "/repo")).rejects.toThrow("no longer exists");
    records.set("root", { ...root, archivedAt: 2 });
    await expect(create("root", "/repo")).rejects.toThrow("archived");
    records.set("worktree", {
      ...worktree,
      executionTarget: {
        kind: "local_worktree",
        workingDirectory: "/repo-worktree",
        branchName: "chat",
        worktreeState: "removed",
      },
    });
    await expect(create("worktree", "/repo-worktree")).rejects.toThrow("removed");
    records.set("worktree", worktree);
    await expect(create("worktree", "/other")).rejects.toThrow("does not match");
    await expect(create("worktree", "/repo-worktree", "/other-repo")).rejects.toThrow(
      "repository changed",
    );
    dependencies.git.isRegisteredWorktree = () => Effect.succeed(false);
    await expect(create("worktree", "/repo-worktree")).rejects.toThrow("registered worktree");
    expect(pty.startDirectories).toEqual([]);
  });

  test("uses the current task worktree and rejects a stale directory", async () => {
    const pty = makePty();
    let worktree: string | null = "/task-worktree";
    const { service } = await makeService(
      pty,
      undefined,
      { ...filesystem, canonicalize: (path) => Effect.succeed(path) },
      undefined,
      undefined,
      {
        getTaskWorktree: () =>
          Effect.succeed(worktree === null ? null : { workingDirectory: worktree }),
      },
    );
    const context = { repoPath: "/repo", taskId: "task-1" };

    await expect(
      Effect.runPromise(service.create({ workingDir: "/other", context })),
    ).rejects.toThrow("does not match task task-1's worktree");
    expect(pty.startDirectories).toEqual([]);

    const created = await Effect.runPromise(
      service.create({ workingDir: "/task-worktree", context }),
    );
    expect(created.summary.initialWorkingDir).toBe("/task-worktree");
    expect(pty.startDirectories).toEqual(["/task-worktree"]);

    worktree = null;
    await expect(
      Effect.runPromise(service.create({ workingDir: "/task-worktree", context })),
    ).rejects.toThrow("Create or restore its worktree");
    expect(pty.startDirectories).toEqual(["/task-worktree"]);
  });

  test("rejects a task worktree that Git no longer owns", async () => {
    const pty = makePty();
    let realPath = "/task-worktree";
    let registered = false;
    const dependencies = workspaceTerminalDependencies(new Map());
    dependencies.git.isRegisteredWorktree = (_repoPath, worktreePath) =>
      Effect.succeed(registered && worktreePath === "/task-worktree");
    const { service } = await makeService(
      pty,
      undefined,
      {
        ...filesystem,
        canonicalize: (path) => Effect.succeed(path === "/task-worktree" ? realPath : path),
      },
      undefined,
      dependencies,
      { getTaskWorktree: () => Effect.succeed({ workingDirectory: "/task-worktree" }) },
    );
    const create = () =>
      Effect.runPromise(
        service.create({
          workingDir: "/task-worktree",
          context: { repoPath: "/repo", taskId: "task-1" },
        }),
      );

    await expect(create()).rejects.toThrow("registered worktree");
    registered = true;
    realPath = "/other-directory";
    await expect(create()).rejects.toThrow("registered worktree");
    expect(pty.startDirectories).toEqual([]);
  });

  test("limits each chat owner and keeps a failed cleanup terminal for retry", async () => {
    const records = new Map<string, WorkspaceSession>([
      [
        "first",
        workspaceSessionRecord("first", { kind: "local_repo_root", workingDirectory: "/repo" }),
      ],
      [
        "second",
        workspaceSessionRecord("second", { kind: "local_repo_root", workingDirectory: "/repo" }),
      ],
    ]);
    const pty = makePty();
    let nextId = 0;
    const { service } = await makeService(
      pty,
      () => `terminal-${++nextId}`,
      { ...filesystem, canonicalize: (path) => Effect.succeed(path) },
      undefined,
      workspaceTerminalDependencies(records),
    );
    const create = (sessionId: string) =>
      Effect.runPromise(
        service.create({
          workingDir: "/repo",
          context: {
            kind: "workspace_session",
            workspaceId: "workspace-1",
            sessionId,
            repoPath: "/repo",
          },
        }),
      );
    for (let index = 0; index < TERMINAL_LIMITS.livePerWorkspaceSession; index += 1) {
      await create("first");
    }
    await expect(create("first")).rejects.toThrow("limit");
    const second = await create("second");
    pty.failNextTerminate();
    await expect(
      Effect.runPromise(
        Effect.scoped(
          service.acquireWorkspaceSessionCleanup({
            workspaceId: "workspace-1",
            sessionId: "first",
          }),
        ),
      ),
    ).rejects.toThrow("terminal-1");
    expect(
      (
        await Effect.runPromise(
          service.list({
            kind: "workspace_session",
            workspaceId: "workspace-1",
            sessionId: "first",
          }),
        )
      ).terminals.map((entry) => entry.terminalId),
    ).toEqual(["terminal-1"]);
    expect(
      (
        await Effect.runPromise(
          service.list({
            kind: "workspace_session",
            workspaceId: "workspace-1",
            sessionId: "second",
          }),
        )
      ).terminals.map((entry) => entry.terminalId),
    ).toEqual([second.ref.terminalId]);
    await Effect.runPromise(
      Effect.scoped(
        service.acquireWorkspaceSessionCleanup({ workspaceId: "workspace-1", sessionId: "first" }),
      ),
    );
    expect(
      (
        await Effect.runPromise(
          service.list({
            kind: "workspace_session",
            workspaceId: "workspace-1",
            sessionId: "first",
          }),
        )
      ).terminals,
    ).toEqual([]);
  });

  test("waits for an admitted chat start and blocks new starts for only that chat during cleanup", async () => {
    const records = new Map<string, WorkspaceSession>([
      [
        "first",
        workspaceSessionRecord("first", { kind: "local_repo_root", workingDirectory: "/repo" }),
      ],
      [
        "second",
        workspaceSessionRecord("second", { kind: "local_repo_root", workingDirectory: "/repo" }),
      ],
    ]);
    const dependencies = workspaceTerminalDependencies(records);
    let reportResolving = (): void => undefined;
    const resolving = new Promise<void>((resolve) => {
      reportResolving = resolve;
    });
    let releaseResolve = (): void => undefined;
    const resolveReleased = new Promise<void>((resolve) => {
      releaseResolve = resolve;
    });
    let delayFirst = true;
    dependencies.git.canonicalizePath = (path) =>
      Effect.promise(async () => {
        if (delayFirst) {
          delayFirst = false;
          reportResolving();
          await resolveReleased;
        }
        return path;
      });
    let nextId = 0;
    const { service } = await makeService(
      makePty(),
      () => `terminal-${++nextId}`,
      { ...filesystem, canonicalize: (path) => Effect.succeed(path) },
      undefined,
      dependencies,
    );
    const create = (sessionId: string) =>
      service.create({
        workingDir: "/repo",
        context: {
          kind: "workspace_session",
          workspaceId: "workspace-1",
          sessionId,
          repoPath: "/repo",
        },
      });
    const first = Effect.runPromise(create("first"));
    await resolving;
    let releaseCleanup = (): void => undefined;
    const cleanupReleased = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    let reportCleanupDone = (): void => undefined;
    const cleanupDone = new Promise<void>((resolve) => {
      reportCleanupDone = resolve;
    });
    const cleanup = Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* service.acquireWorkspaceSessionCleanup({
            workspaceId: "workspace-1",
            sessionId: "first",
          });
          reportCleanupDone();
          yield* Effect.promise(() => cleanupReleased);
        }),
      ),
    );
    await Bun.sleep(0);
    const blocked = await Effect.runPromise(Effect.either(create("first")));
    expect(blocked._tag).toBe("Left");
    const other = await Effect.runPromise(create("second"));
    expect(other.summary.context).toMatchObject({ sessionId: "second" });
    releaseResolve();
    await first;
    await cleanupDone;
    expect(
      (
        await Effect.runPromise(
          service.list({
            kind: "workspace_session",
            workspaceId: "workspace-1",
            sessionId: "first",
          }),
        )
      ).terminals,
    ).toEqual([]);
    releaseCleanup();
    await cleanup;
  });

  test("applies workspace process admission to chat terminal creation and input", async () => {
    const records = new Map<string, WorkspaceSession>([
      [
        "chat",
        workspaceSessionRecord("chat", { kind: "local_repo_root", workingDirectory: "/repo" }),
      ],
    ]);
    const admittedRepos: string[] = [];
    let blocked = true;
    const withProcessStartAdmission: WithProcessStartAdmission = (repoPath, effect) => {
      admittedRepos.push(repoPath);
      return blocked
        ? Effect.fail(
            new HostValidationError({
              message: "Workspace is closed. Reopen it.",
              field: "workspaceId",
            }),
          )
        : effect;
    };
    const pty = makePty();
    const { service } = await makeService(
      pty,
      undefined,
      { ...filesystem, canonicalize: (path) => Effect.succeed(path) },
      withProcessStartAdmission,
      workspaceTerminalDependencies(records),
    );
    const request = {
      workingDir: "/repo",
      context: {
        kind: "workspace_session" as const,
        workspaceId: "workspace-1",
        sessionId: "chat",
        repoPath: "/repo",
      },
    };
    await expect(Effect.runPromise(service.create(request))).rejects.toThrow("Workspace is closed");
    expect(pty.startDirectories).toEqual([]);
    blocked = false;
    const created = await Effect.runPromise(service.create(request));
    blocked = true;
    await expect(
      Effect.runPromise(service.write(created.ref.terminalId, new TextEncoder().encode("pwd"))),
    ).rejects.toThrow("Workspace is closed");
    expect(pty.operations).not.toContain("write:pwd");
    expect(admittedRepos).toEqual(["/repo", "/repo", "/repo"]);
  });

  test("rejects task terminal creation and input for a blocked workspace", async () => {
    let blocked = true;
    const withProcessStartAdmission: WithProcessStartAdmission = (_repoPath, effect) =>
      blocked
        ? Effect.fail(
            new HostValidationError({
              message: "Workspace is closed: ws. Reopen it before using it.",
              field: "workspaceId",
            }),
          )
        : effect;
    const { service, pty } = await makeService(
      makePty(),
      undefined,
      undefined,
      withProcessStartAdmission,
    );

    await expect(
      Effect.runPromise(
        service.create({
          workingDir: "/repo",
          context: { repoPath: "/repo", taskId: "task-1" },
        }),
      ),
    ).rejects.toThrow("Workspace is closed");
    expect(pty.operations).not.toContain("write:/repo");

    blocked = false;
    const created = await Effect.runPromise(
      service.create({
        workingDir: "/repo",
        context: { repoPath: "/repo", taskId: "task-1" },
      }),
    );
    blocked = true;
    await expect(
      Effect.runPromise(service.write(created.ref.terminalId, new TextEncoder().encode("ls"))),
    ).rejects.toThrow("Workspace is closed");
    expect(pty.operations).not.toContain("write:ls");
  });

  test.each([false, true])(
    "inspects terminal activity after its repository becomes inaccessible, child processes: %s",
    async (hasChildProcesses) => {
      let accessible = true;
      const { service } = await makeService(makePty(true, hasChildProcesses), undefined, {
        ...filesystem,
        canonicalize: (path) =>
          accessible
            ? filesystem.canonicalize(path)
            : Effect.fail(
                new HostOperationError({
                  operation: "filesystem.canonicalize",
                  message: "Repository directory was deleted",
                }),
              ),
      });
      try {
        await Effect.runPromise(
          service.create({ workingDir: "/repo", context: { repoPath: "/repo", taskId: "task-1" } }),
        );
        accessible = false;

        expect(
          await Effect.runPromise(service.inspectWorkspaceActivity("/canonical/repo")),
        ).toEqual({
          activeTerminalIds: hasChildProcesses ? ["terminal-1"] : [],
          unknownTerminalIds: hasChildProcesses ? [] : ["terminal-1"],
        });
      } finally {
        await Effect.runPromise(service.dispose());
      }
    },
  );

  test("retains PTY failure details for live attachments and attachments after exit", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    const live: TerminalServerMessage[] = [];
    const attach = (attachmentId: string, events: TerminalServerMessage[]) =>
      Effect.runPromise(
        service.attach({
          terminalId: "terminal-1",
          attachmentId,
          lastConsumedSequence: 0,
          sink: (event) => events.push(event),
        }),
      );
    await attach("live", live);
    pty.fail(
      new TerminalPtyError({
        code: "spawn_failed",
        operation: "start",
        message: "Shell access denied.",
      }),
    );
    pty.exit(1);
    const late: TerminalServerMessage[] = [];
    await attach("late", late);
    const failures = (events: TerminalServerMessage[]) =>
      events.filter((event) => event.type === "protocol_error");
    expect(failures(live)).toEqual([
      expect.objectContaining({
        failure: expect.objectContaining({
          code: "spawn_failed",
          terminalId: "terminal-1",
          workingDir: "/canonical/repo",
          message: expect.stringContaining("Shell access denied."),
        }),
      }),
    ]);
    expect(failures(late)).toEqual(failures(live));
    expect(late[0]).toMatchObject({ type: "snapshot", lifecycle: "exited" });
  });
  beforeEach(() => {
    directoryAvailable = true;
  });
  test("creates a taskless terminal and keeps its canonical initial directory immutable", async () => {
    const { service, pty } = await makeService();
    const created = await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    expect(created.summary.label).toBe("/canonical/repo");
    await Effect.runPromise(
      service.write(created.ref.terminalId, new TextEncoder().encode("cd /tmp\n")),
    );
    const listed = await Effect.runPromise(service.list({ kind: "unassociated" }));
    expect(listed.terminals[0]?.initialWorkingDir).toBe("/canonical/repo");
    expect(pty.operations).toContain("write:cd /tmp\n");
  });

  test("lists the latest terminal title without changing the initial directory", async () => {
    const { service, pty, settleTitles } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));

    pty.emit(new TextEncoder().encode("\u001b]0;user@host:~/projects/openducktor\u0007"));
    settleTitles();

    const listed = await Effect.runPromise(service.list({ kind: "unassociated" }));
    expect(listed.terminals[0]).toMatchObject({
      label: "~/projects/openducktor",
      initialWorkingDir: "/canonical/repo",
    });

    pty.emit(new TextEncoder().encode("\u001b]2;pnpm "));
    pty.emit(new TextEncoder().encode("run dev\u001b\\"));
    settleTitles();

    const updated = await Effect.runPromise(service.list({ kind: "unassociated" }));
    expect(updated.terminals[0]?.label).toBe("pnpm run dev");
  });

  test("publishes the current title on attach and later title changes as metadata", async () => {
    const { service, pty, settleTitles } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    pty.emit(new TextEncoder().encode("\u001b]0;user@host:~/repo\u0007"));
    settleTitles();
    const events: unknown[] = [];

    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "attachment-1",
        lastConsumedSequence: 0,
        sink: (event) => events.push(event),
      }),
    );

    expect(events[0]).toMatchObject({ type: "snapshot", title: "~/repo" });

    pty.emit(new TextEncoder().encode("\u001b]2;pnpm run dev\u0007"));
    settleTitles();
    expect(events).toContainEqual(
      expect.objectContaining({ type: "title", title: "pnpm run dev" }),
    );
  });

  test("publishes only the settled title for a fast shell command", async () => {
    const { service, pty, settleTitles } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    const events: Array<{ type: string; title?: string }> = [];

    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "attachment-1",
        lastConsumedSequence: 0,
        sink: (event) => events.push(event),
      }),
    );

    pty.emit(new TextEncoder().encode("\u001b]2;cd /tmp\u0007"));
    pty.emit(new TextEncoder().encode("\u001b]0;user@host:/tmp\u0007"));

    settleTitles();

    expect(events.filter((event) => event.type === "title")).toEqual([
      expect.objectContaining({ type: "title", title: "/tmp" }),
    ]);
  });

  test("cancels an unsettled title when the terminal closes", async () => {
    const { service, pty, settleTitles } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    const events: Array<{ type: string }> = [];
    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "attachment-1",
        lastConsumedSequence: 0,
        sink: (event) => events.push(event),
      }),
    );

    pty.emit(new TextEncoder().encode("\u001b]2;pnpm run dev\u0007"));
    await Effect.runPromise(service.close({ terminalId: "terminal-1", confirmTerminate: true }));
    settleTitles();

    expect(events.some((event) => event.type === "title")).toBe(false);
  });

  test("publishes output before exit with monotonic byte ranges", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(
      service.create({
        workingDir: "/repo",
        context: { repoPath: "/repo", taskId: "task-1" },
      }),
    );
    const events: Array<{ type: string; start?: number; end?: number }> = [];
    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "attachment-1",
        lastConsumedSequence: 0,
        sink: (event) => {
          if (event.type === "output") {
            events.push({
              type: event.type,
              start: event.sequenceStart,
              end: event.sequenceEnd,
            });
            return;
          }
          events.push({ type: event.type });
        },
      }),
    );
    pty.emit(new Uint8Array([1, 2]));
    pty.emit(new Uint8Array([3]));
    pty.exit(7);
    expect(events.filter((event) => event.type === "output")).toEqual([
      { type: "output", start: 0, end: 2 },
      { type: "output", start: 2, end: 3 },
    ]);
    expect(events.at(-1)?.type).toBe("lifecycle");
  });

  test("preserves input and resize barriers", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    await Effect.runPromise(
      Effect.all(
        [
          service.write("terminal-1", new TextEncoder().encode("first")),
          service.resize("terminal-1", { columns: 120, rows: 40 }),
          service.write("terminal-1", new TextEncoder().encode("second")),
        ],
        { concurrency: "unbounded" },
      ),
    );
    expect(pty.operations).toEqual(["write:first", "resize:120x40", "write:second"]);
  });

  test("restores the current screen after old replay bytes are evicted", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    await emitEvictedReplay(pty);
    const tui = new TextEncoder().encode("\u001b[?1049h\u001b[HREADY");
    pty.emit(tui);
    await Bun.sleep(0);
    const eventTypes: string[] = [];
    let restoredScreen = "";
    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "attachment-1",
        lastConsumedSequence: 0,
        sink: (event, payload) => {
          eventTypes.push(event.type);
          if (event.type === "screen_restore") restoredScreen = new TextDecoder().decode(payload);
        },
      }),
    );
    expect(eventTypes[0]).toBe("snapshot");
    expect(eventTypes[1]).toBe("screen_restore");
    expect(eventTypes).not.toContain("output");
    expect(restoredScreen).toContain("\u001b[?1049h");
    expect(restoredScreen).toContain("READY");
  });

  test.each(["success", "sink failure"])(
    "pauses PTY output before a replay-gap restore and releases it after %s",
    async (result) => {
      const { service, pty } = await makeService();
      await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
      await emitEvictedReplay(pty);
      const drainGate = Promise.withResolvers<void>();
      const originalDrained = TerminalScreenState.prototype.drained;
      const drained = spyOn(TerminalScreenState.prototype, "drained").mockImplementation(function (
        this: TerminalScreenState,
      ) {
        return drainGate.promise.then(() => originalDrained.call(this));
      });
      const events: string[] = [];
      const attaching = Effect.runPromise(
        service.attach({
          terminalId: "terminal-1",
          attachmentId: "attachment-1",
          lastConsumedSequence: 0,
          sink: (event) => {
            if (result === "sink failure") throw new Error("socket closed");
            events.push(event.type);
          },
        }),
      );
      try {
        await waitForPtyOperation(pty.operations, "pause");
        expect(events).toEqual([]);
        drainGate.resolve();
        if (result === "sink failure") await expect(attaching).rejects.toThrow("socket closed");
        else {
          await attaching;
          expect(events).toEqual(["snapshot", "screen_restore"]);
        }
        await waitForPtyOperation(pty.operations, "resume");
        expect(pty.operations).toEqual(["pause", "resume"]);
      } finally {
        drainGate.resolve();
        drained.mockRestore();
        await attaching.catch(() => undefined);
      }
    },
  );

  test("releases a replay-gap hold when PTY pause fails", async () => {
    const pty = makePty();
    const start = pty.port.start;
    let pauseFails = true;
    pty.port.start = (plan, handlers) =>
      start(plan, handlers).pipe(
        Effect.map((handle) => ({
          ...handle,
          pauseOutput: () =>
            pauseFails
              ? Effect.fail(
                  new TerminalPtyError({
                    code: "operation_failed",
                    operation: "pause",
                    message: "PTY pause failed",
                  }),
                )
              : handle.pauseOutput(),
        })),
      );
    const { service } = await makeService(pty);
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    await emitEvictedReplay(pty);
    const attach = () =>
      Effect.runPromise(
        service.attach({
          terminalId: "terminal-1",
          attachmentId: "attachment-1",
          lastConsumedSequence: 0,
          sink: () => undefined,
        }),
      );
    await expect(attach()).rejects.toThrow("could not pause for a correct screen restore");
    pauseFails = false;
    await attach();
    await waitForPtyOperation(pty.operations, "resume");
    expect(pty.operations).toEqual(["pause", "resume"]);
  });

  test("keeps output paused until concurrent replay-gap restores finish", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    await emitEvictedReplay(pty);
    const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()] as const;
    const originalDrained = TerminalScreenState.prototype.drained;
    let drainCalls = 0;
    const drained = spyOn(TerminalScreenState.prototype, "drained").mockImplementation(function (
      this: TerminalScreenState,
    ) {
      const gate = gates[drainCalls++];
      if (!gate) throw new Error("Unexpected screen drain.");
      return gate.promise.then(() => originalDrained.call(this));
    });
    const firstEvents: string[] = [];
    const secondEvents: string[] = [];
    const attach = (index: number, events: string[]) =>
      Effect.runPromise(
        service.attach({
          terminalId: "terminal-1",
          attachmentId: `attachment-${index}`,
          lastConsumedSequence: 0,
          sink: (event) => events.push(event.type),
        }),
      );
    const first = attach(0, firstEvents);
    const second = attach(1, secondEvents);
    try {
      await waitForPtyOperation(pty.operations, "pause");
      for (let attempt = 0; attempt < 200 && drainCalls < 2; attempt += 1) await Bun.sleep(10);
      expect(drainCalls).toBe(2);
      gates[0].resolve();
      await first;
      await Bun.sleep(0);
      expect(pty.operations).toEqual(["pause"]);
      gates[1].resolve();
      await second;
      await waitForPtyOperation(pty.operations, "resume");
      expect(pty.operations).toEqual(["pause", "resume"]);
      expect([firstEvents, secondEvents]).toEqual([
        ["snapshot", "screen_restore"],
        ["snapshot", "screen_restore"],
      ]);
    } finally {
      for (const gate of gates) gate.resolve();
      drained.mockRestore();
      await Promise.all([first.catch(() => undefined), second.catch(() => undefined)]);
    }
  });

  test("replays retained output without waiting for the screen parser", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    pty.emit(new TextEncoder().encode("A"));
    let releaseDrain!: () => void;
    const drain = new Promise<void>((resolve) => {
      releaseDrain = resolve;
    });
    const drained = spyOn(TerminalScreenState.prototype, "drained").mockImplementation(() => drain);
    const eventTypes: string[] = [];
    const attaching = Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "replay",
        lastConsumedSequence: 0,
        sink: (event) => eventTypes.push(event.type),
      }),
    );
    try {
      const result = await Promise.race([
        attaching.then(() => "attached"),
        Bun.sleep(1000).then(() => "blocked"),
      ]);
      expect(result).toBe("attached");
      expect(eventTypes).toEqual(["snapshot", "output"]);
    } finally {
      releaseDrain();
      drained.mockRestore();
      await attaching;
    }
  });

  test("rejects an attachment position beyond published output", async () => {
    const { service } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    await expect(
      Effect.runPromise(
        service.attach({
          terminalId: "terminal-1",
          attachmentId: "future",
          lastConsumedSequence: 1,
          sink: () => undefined,
        }),
      ),
    ).rejects.toThrow("beyond the published sequence");
  });

  test("rolls back an attachment when its initial sink throws", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    let sinkCalls = 0;

    await expect(
      Effect.runPromise(
        service.attach({
          terminalId: "terminal-1",
          attachmentId: "broken-renderer",
          lastConsumedSequence: 0,
          sink: () => {
            sinkCalls += 1;
            throw new Error("socket closed");
          },
        }),
      ),
    ).rejects.toThrow("socket closed");

    pty.emit(new Uint8Array([1]));
    expect(sinkCalls).toBe(1);
  });

  test("isolates a stale attachment while continuing output delivery", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    let staleSinkShouldThrow = false;
    const healthyEvents: string[] = [];

    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "stale-renderer",
        lastConsumedSequence: 0,
        sink: () => {
          if (staleSinkShouldThrow) throw new Error("renderer destroyed");
        },
      }),
    );
    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "healthy-renderer",
        lastConsumedSequence: 0,
        sink: (event) => healthyEvents.push(event.type),
      }),
    );

    staleSinkShouldThrow = true;
    expect(() => pty.emit(new Uint8Array([1]))).not.toThrow();
    expect(healthyEvents).toEqual(["snapshot", "output"]);

    pty.emit(new Uint8Array([2]));
    expect(healthyEvents).toEqual(["snapshot", "output", "output"]);
  });

  test("lists terminals without repeating filesystem validation", async () => {
    let statCalls = 0;
    const countingFilesystem: FilesystemPort = {
      ...filesystem,
      stat: (path) => {
        statCalls += 1;
        return filesystem.stat(path);
      },
    };
    const { service } = await makeService(makePty(), () => "terminal-1", countingFilesystem);
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    const callsAfterCreate = statCalls;
    await Effect.runPromise(service.list({ kind: "all" }));
    expect(statCalls).toBe(callsAfterCreate);
  });

  test("does not advance pending output until ACK and pauses at the hard bound", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "a",
        lastConsumedSequence: 0,
        sink: () => undefined,
      }),
    );
    pty.emit(new Uint8Array(TERMINAL_LIMITS.pendingOutputBytes));
    await Bun.sleep(0);
    expect(pty.operations).toContain("pause");
    await Effect.runPromise(
      service.acknowledge("terminal-1", "a", TERMINAL_LIMITS.pendingOutputBytes),
    );
    await waitForPtyOperation(pty.operations, "resume");
  });

  test("resumes output when the pressure-causing attachment detaches", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "slow-renderer",
        lastConsumedSequence: 0,
        sink: () => undefined,
      }),
    );
    pty.emit(new Uint8Array(TERMINAL_LIMITS.pendingOutputBytes));
    await Bun.sleep(0);
    await Effect.runPromise(service.detach("terminal-1", "slow-renderer"));

    await waitForPtyOperation(pty.operations, "resume");
    expect(pty.operations).toEqual(["pause", "resume"]);
    const replayed: string[] = [];
    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "replacement-renderer",
        lastConsumedSequence: TERMINAL_LIMITS.pendingOutputBytes,
        sink: (event) => replayed.push(event.type),
      }),
    );
    expect(replayed).toEqual(["snapshot"]);
  });

  test.each(["ack", "detach"] as const)(
    "resumes output after a pending pause when %s releases pressure",
    async (unblock) => {
      const pty = makePty();
      const start = pty.port.start;
      const pauseStarted = Promise.withResolvers<void>();
      const pauseGate = Promise.withResolvers<void>();
      pty.port.start = (plan, handlers) =>
        start(plan, handlers).pipe(
          Effect.map((handle) => ({
            ...handle,
            pauseOutput: () =>
              Effect.promise(async () => {
                pauseStarted.resolve();
                await pauseGate.promise;
                pty.operations.push("pause");
              }),
          })),
        );
      const { service } = await makeService(pty);
      await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
      await Effect.runPromise(
        service.attach({
          terminalId: "terminal-1",
          attachmentId: "slow-renderer",
          lastConsumedSequence: 0,
          sink: () => undefined,
        }),
      );

      pty.emit(new Uint8Array(TERMINAL_LIMITS.pendingOutputBytes));
      await pauseStarted.promise;
      const released =
        unblock === "ack"
          ? Effect.runPromise(
              service.acknowledge(
                "terminal-1",
                "slow-renderer",
                TERMINAL_LIMITS.pendingOutputBytes,
              ),
            )
          : Effect.runPromise(service.detach("terminal-1", "slow-renderer"));
      await Bun.sleep(0);
      expect(pty.operations).toEqual([]);

      pauseGate.resolve();
      await released;
      await waitForPtyOperation(pty.operations, "resume");
      expect(pty.operations).toEqual(["pause", "resume"]);
    },
  );

  test("resumes output when a failed sink removes the last attachment", async () => {
    const { service, pty, settleTitles } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "closing-renderer",
        lastConsumedSequence: 0,
        sink: (event) => {
          if (event.type === "title") throw new Error("renderer destroyed");
        },
      }),
    );
    const titleSequence = new TextEncoder().encode("\u001b]2;pnpm run dev\u0007");
    pty.emit(titleSequence);
    pty.emit(new Uint8Array(TERMINAL_LIMITS.pendingOutputBytes - titleSequence.byteLength));
    await Bun.sleep(0);
    expect(pty.operations).toEqual(["pause"]);

    settleTitles();
    await waitForPtyOperation(pty.operations, "resume");

    expect(pty.operations).toEqual(["pause", "resume"]);
  });

  test("terminates with overflow when output pause is unsupported", async () => {
    let id = 0;
    const { service, pty } = await makeService(makePty(false), () => `terminal-${++id}`);
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    const events: string[] = [];
    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "a",
        lastConsumedSequence: 0,
        sink: (event) => events.push(event.type),
      }),
    );
    pty.emit(new Uint8Array(TERMINAL_LIMITS.pendingOutputBytes + 1));
    await Bun.sleep(0);
    expect(events).toContain("output_overflow");
    expect(pty.operations).toContain("terminate");
    const listed = await Effect.runPromise(service.list({ kind: "all" }));
    expect(listed.terminals[0]?.lifecycle).toBe("exited");
    for (let index = 0; index < TERMINAL_LIMITS.livePerHost; index += 1) {
      await Effect.runPromise(
        service.create({
          workingDir: "/repo",
          context: { repoPath: "/repo", taskId: `replacement-${index}` },
        }),
      );
    }
  });

  test("requires confirmation and keeps close failures retryable", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    await expect(
      Effect.runPromise(service.close({ terminalId: "terminal-1", confirmTerminate: false })),
    ).rejects.toThrow();
    pty.failTerminate();
    await expect(
      Effect.runPromise(service.close({ terminalId: "terminal-1", confirmTerminate: true })),
    ).rejects.toThrow();
    const listed = await Effect.runPromise(service.list({ kind: "all" }));
    expect(listed.terminals[0]?.lifecycle).toBe("close_failed");
  });

  test.each(["context", "host"] as const)(
    "reports shared %s capacity and how to free a slot when shells and output sources reach the limit",
    async (limitKind) => {
      let id = 0;
      const { service } = await makeService(makePty(), () => `terminal-${++id}`);
      const limit =
        limitKind === "context" ? TERMINAL_LIMITS.livePerTask : TERMINAL_LIMITS.livePerHost;
      const outputHandle = {
        supportsOutputPause: true,
        pauseOutput: () => Effect.void,
        resumeOutput: () => Effect.void,
        terminate: () => Effect.void,
      };
      const taskIdFor = (index: number) => (limitKind === "context" ? "shared" : `task-${index}`);
      try {
        for (let index = 0; index < limit; index += 1) {
          const taskId = taskIdFor(index);
          if (index % 2 === 0) {
            await Effect.runPromise(
              service.create({ workingDir: "/repo", context: { repoPath: "/repo", taskId } }),
            );
          } else {
            const source = await Effect.runPromise(
              service.openOutputSource({
                context: { repoPath: "/canonical/repo", taskId },
                workingDir: "/canonical/repo",
                label: "Dev server",
                onForgotten: () => {},
              }),
            );
            await Effect.runPromise(source.activate(outputHandle));
          }
        }
        expect((await Effect.runPromise(service.list({ kind: "all" }))).terminals).toHaveLength(
          limit / 2,
        );
        const create = () =>
          service.create({
            workingDir: "/repo",
            context: { repoPath: "/repo", taskId: taskIdFor(limit) },
          });
        const rejected = await Effect.runPromise(Effect.either(create()));
        expect(rejected._tag).toBe("Left");
        if (rejected._tag !== "Left") throw new Error("Expected the shared terminal limit.");
        expect(rejected.left.code).toBe(`${limitKind}_terminal_limit`);
        expect(rejected.left.message).toContain(`${limit}/${limit}`);
        expect(rejected.left.message).toContain("Shell terminals and dev server output");
        expect(rejected.left.message).toContain("Close a terminal or stop a dev server");
        await Effect.runPromise(
          service.close({ terminalId: "terminal-1", confirmTerminate: true }),
        );
        expect((await Effect.runPromise(create())).ref.terminalId).toBeTruthy();
      } finally {
        await Effect.runPromise(service.dispose());
      }
    },
  );

  test("closes an idle shell without confirmation", async () => {
    const { service, pty } = await makeService(makePty(true, false));
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));

    await Effect.runPromise(service.close({ terminalId: "terminal-1", confirmTerminate: false }));

    expect((await Effect.runPromise(service.list({ kind: "all" }))).terminals).toEqual([]);
    expect(pty.operations).toEqual(["inspect-children", "terminate"]);
  });

  test("scopes task cleanup by repository and forgets attached terminals", async () => {
    let terminalId = 0;
    const { service } = await makeService(makePty(true, false), () => `terminal-${++terminalId}`);
    await Effect.runPromise(
      service.create({
        workingDir: "/repo-a",
        context: { repoPath: "/repo-a", taskId: "shared-task" },
      }),
    );
    await Effect.runPromise(
      service.create({
        workingDir: "/repo-b",
        context: { repoPath: "/repo-b", taskId: "shared-task" },
      }),
    );
    const events: string[] = [];
    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "renderer",
        lastConsumedSequence: 0,
        sink: (event) => events.push(event.type),
      }),
    );

    await Effect.runPromise(
      Effect.scoped(
        service.acquireTaskCleanup({
          repoPath: "/repo-a",
          taskIds: ["shared-task"],
        }),
      ),
    );

    expect(events.at(-1)).toBe("terminal_forgotten");
    expect(
      (
        await Effect.runPromise(
          service.list({
            kind: "task",
            repoPath: "/repo-a",
            taskId: "shared-task",
          }),
        )
      ).terminals,
    ).toEqual([]);
    expect(
      (
        await Effect.runPromise(
          service.list({
            kind: "task",
            repoPath: "/repo-b",
            taskId: "shared-task",
          }),
        )
      ).terminals.map((terminal) => terminal.terminalId),
    ).toEqual(["terminal-2"]);
  });

  test("uses canonical repository identity for task listing and cleanup", async () => {
    const canonicalFilesystem: FilesystemPort = {
      ...filesystem,
      canonicalize: (path) =>
        Effect.succeed(path === "/repo-link" || path === "/repo" ? "/repo" : path),
    };
    const { service } = await makeService(
      makePty(true, false),
      () => "terminal-1",
      canonicalFilesystem,
    );
    const created = await Effect.runPromise(
      service.create({
        workingDir: "/repo-link",
        context: { repoPath: "/repo-link", taskId: "task-1" },
      }),
    );

    expect(created.summary.context).toEqual({
      repoPath: "/repo",
      taskId: "task-1",
    });
    expect(
      (
        await Effect.runPromise(service.list({ kind: "task", repoPath: "/repo", taskId: "task-1" }))
      ).terminals.map((terminal) => terminal.terminalId),
    ).toEqual(["terminal-1"]);

    await Effect.runPromise(
      Effect.scoped(
        service.acquireTaskCleanup({
          repoPath: "/repo-link",
          taskIds: ["task-1"],
        }),
      ),
    );

    expect(
      (await Effect.runPromise(service.list({ kind: "task", repoPath: "/repo", taskId: "task-1" })))
        .terminals,
    ).toEqual([]);
  });

  test("removes a close-failed session after its PTY cleanup retry succeeds", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    pty.failNextTerminate();

    await expect(
      Effect.runPromise(service.close({ terminalId: "terminal-1", confirmTerminate: true })),
    ).rejects.toThrow();
    expect((await Effect.runPromise(service.list({ kind: "all" }))).terminals[0]?.lifecycle).toBe(
      "close_failed",
    );

    await Effect.runPromise(service.close({ terminalId: "terminal-1", confirmTerminate: true }));

    expect((await Effect.runPromise(service.list({ kind: "all" }))).terminals).toEqual([]);
    expect(pty.operations).toContain("terminate");
  });

  test("keeps tracking titles while a failed close remains retryable", async () => {
    const { service, pty, settleTitles } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    pty.failNextTerminate();

    await expect(
      Effect.runPromise(service.close({ terminalId: "terminal-1", confirmTerminate: true })),
    ).rejects.toThrow();

    pty.emit(new TextEncoder().encode("\u001b]0;user@host:~/still-running\u0007"));
    settleTitles();

    const listed = await Effect.runPromise(service.list({ kind: "all" }));
    expect(listed.terminals[0]).toMatchObject({
      label: "~/still-running",
      lifecycle: "close_failed",
    });

    await Effect.runPromise(service.close({ terminalId: "terminal-1", confirmTerminate: true }));
    expect((await Effect.runPromise(service.list({ kind: "all" }))).terminals).toEqual([]);
  });

  test("terminates independent sessions concurrently during host shutdown", async () => {
    let terminalId = 0;
    let startedTerminations = 0;
    let releaseTerminations = (): void => undefined;
    const terminationsReleased = new Promise<void>((resolve) => {
      releaseTerminations = resolve;
    });
    const pty = makePty();
    pty.port.start = () =>
      Effect.succeed({
        supportsOutputPause: true,
        hasChildProcesses: () => Effect.succeed(false),
        write: () => Effect.void,
        resize: () => Effect.void,
        pauseOutput: () => Effect.void,
        resumeOutput: () => Effect.void,
        terminate: () =>
          Effect.promise(async () => {
            startedTerminations += 1;
            await terminationsReleased;
          }),
      });
    const { service } = await makeService(pty, () => `terminal-${++terminalId}`);
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));

    const disposing = Effect.runPromise(service.dispose());
    try {
      await Bun.sleep(0);
      expect(startedTerminations).toBe(2);
    } finally {
      releaseTerminations();
      await disposing;
    }
  });

  test("waits for an admitted creation before completing host shutdown", async () => {
    let releaseCanonicalize = (): void => undefined;
    let reportCanonicalizeStarted = (): void => undefined;
    const canonicalizeStarted = new Promise<void>((resolve) => {
      reportCanonicalizeStarted = resolve;
    });
    const canonicalizeReleased = new Promise<void>((resolve) => {
      releaseCanonicalize = resolve;
    });
    const delayedFilesystem: FilesystemPort = {
      ...filesystem,
      canonicalize: (path) =>
        Effect.promise(async () => {
          reportCanonicalizeStarted();
          await canonicalizeReleased;
          return `/canonical${path}`;
        }),
    };
    const { service, pty } = await makeService(makePty(), () => "terminal-1", delayedFilesystem);

    const creating = Effect.runPromise(
      service.create({
        workingDir: "/repo",
        context: { repoPath: "/repo", taskId: "task-1" },
      }),
    );
    await canonicalizeStarted;
    let disposed = false;
    const disposing = Effect.runPromise(service.dispose()).then(() => {
      disposed = true;
    });

    await Bun.sleep(0);
    expect(disposed).toBe(false);
    releaseCanonicalize();
    await creating;
    await disposing;

    expect(pty.operations).toContain("terminate");
    expect((await Effect.runPromise(service.list({ kind: "all" }))).terminals).toEqual([]);
  });

  test("reserves task capacity across concurrent terminal creation", async () => {
    let canonicalizeCount = 0;
    let releaseCanonicalize = (): void => undefined;
    let reportAllCanonicalizing = (): void => undefined;
    const allCanonicalizing = new Promise<void>((resolve) => {
      reportAllCanonicalizing = resolve;
    });
    const canonicalizeReleased = new Promise<void>((resolve) => {
      releaseCanonicalize = resolve;
    });
    const delayedFilesystem: FilesystemPort = {
      ...filesystem,
      canonicalize: (path) =>
        Effect.promise(async () => {
          canonicalizeCount += 1;
          if (canonicalizeCount === TERMINAL_LIMITS.livePerTask) reportAllCanonicalizing();
          await canonicalizeReleased;
          return `/canonical${path}`;
        }),
    };
    let terminalId = 0;
    const { service } = await makeService(
      makePty(),
      () => `terminal-${++terminalId}`,
      delayedFilesystem,
    );

    const creations = Array.from({ length: TERMINAL_LIMITS.livePerTask + 1 }, () =>
      Effect.runPromise(
        Effect.either(
          service.create({
            workingDir: "/repo",
            context: { repoPath: "/repo", taskId: "task-1" },
          }),
        ),
      ),
    );
    await allCanonicalizing;
    releaseCanonicalize();
    const results = await Promise.all(creations);

    expect(results.filter((result) => result._tag === "Right")).toHaveLength(
      TERMINAL_LIMITS.livePerTask,
    );
    expect(results.filter((result) => result._tag === "Left")).toHaveLength(1);
    expect(results.find((result) => result._tag === "Left")?.left.code).toBe(
      "context_terminal_limit",
    );
  });

  test("holds task admission closed while scoped cleanup is active", async () => {
    let releaseCanonicalize = (): void => undefined;
    let reportCanonicalizeStarted = (): void => undefined;
    const canonicalizeStarted = new Promise<void>((resolve) => {
      reportCanonicalizeStarted = resolve;
    });
    const canonicalizeReleased = new Promise<void>((resolve) => {
      releaseCanonicalize = resolve;
    });
    let shouldDelayCanonicalize = true;
    const delayedFilesystem: FilesystemPort = {
      ...filesystem,
      canonicalize: (path) =>
        Effect.promise(async () => {
          if (shouldDelayCanonicalize) {
            reportCanonicalizeStarted();
            await canonicalizeReleased;
          }
          return `/canonical${path}`;
        }),
    };
    let terminalId = 0;
    const { service } = await makeService(
      makePty(),
      () => `terminal-${++terminalId}`,
      delayedFilesystem,
    );
    const creating = Effect.runPromise(
      service.create({
        workingDir: "/repo",
        context: { repoPath: "/repo", taskId: "task-1" },
      }),
    );
    await canonicalizeStarted;
    let releaseCleanup = (): void => undefined;
    const cleanupReleased = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    let reportCleanupAcquired = (): void => undefined;
    const cleanupAcquired = new Promise<void>((resolve) => {
      reportCleanupAcquired = resolve;
    });
    const cleanup = Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* service.acquireTaskCleanup({
            repoPath: "/repo",
            taskIds: ["task-1"],
          });
          reportCleanupAcquired();
          yield* Effect.promise(() => cleanupReleased);
        }),
      ),
    );

    await Bun.sleep(0);
    const blocked = await Effect.runPromise(
      Effect.either(
        service.create({
          workingDir: "/repo",
          context: { repoPath: "/repo", taskId: "task-1" },
        }),
      ),
    );
    expect(blocked._tag).toBe("Left");
    if (blocked._tag === "Left") expect(blocked.left.code).toBe("close_failed");

    releaseCanonicalize();
    await creating;
    await cleanupAcquired;
    expect(
      (await Effect.runPromise(service.list({ kind: "task", repoPath: "/repo", taskId: "task-1" })))
        .terminals,
    ).toEqual([]);

    shouldDelayCanonicalize = false;
    releaseCleanup();
    await cleanup;
    const createdAfterCleanup = await Effect.runPromise(
      service.create({
        workingDir: "/repo",
        context: { repoPath: "/repo", taskId: "task-1" },
      }),
    );
    expect(createdAfterCleanup.summary.context).toEqual({
      repoPath: "/canonical/repo",
      taskId: "task-1",
    });
  });

  test("task cleanup preparation lets other owners start terminals", async () => {
    let releaseRepo = (): void => undefined;
    let reportRepoRead = (): void => undefined;
    const repoRead = new Promise<void>((resolve) => {
      reportRepoRead = resolve;
    });
    const repoReleased = new Promise<void>((resolve) => {
      releaseRepo = resolve;
    });
    const delayedFilesystem: FilesystemPort = {
      ...filesystem,
      canonicalize: (path) =>
        Effect.promise(async () => {
          if (path === "/repo") {
            reportRepoRead();
            await repoReleased;
          }
          return path;
        }),
    };
    const records = new Map<string, WorkspaceSession>([
      [
        "chat",
        workspaceSessionRecord("chat", {
          kind: "local_worktree",
          workingDirectory: "/chat-worktree",
          branchName: "chat",
          worktreeState: "present",
        }),
      ],
    ]);
    const { service } = await makeService(
      makePty(),
      undefined,
      delayedFilesystem,
      undefined,
      workspaceTerminalDependencies(records),
    );
    const taskStart = Effect.runPromise(
      service.create({ workingDir: "/repo", context: { repoPath: "/repo", taskId: "task" } }),
    );
    await repoRead;
    const cleanup = Effect.runPromise(
      Effect.scoped(service.acquireTaskCleanup({ repoPath: "/repo", taskIds: ["task"] })),
    );
    await Bun.sleep(0);

    try {
      const chat = await Effect.runPromise(
        service.create({
          workingDir: "/chat-worktree",
          context: {
            kind: "workspace_session",
            workspaceId: "workspace-1",
            sessionId: "chat",
            repoPath: "/repo",
          },
        }),
      );
      const global = await Effect.runPromise(service.create({ workingDir: "/other", context: {} }));
      expect(chat.summary.initialWorkingDir).toBe("/chat-worktree");
      expect(global.summary.initialWorkingDir).toBe("/other");
    } finally {
      releaseRepo();
    }
    await taskStart;
    await cleanup;
  });
});
