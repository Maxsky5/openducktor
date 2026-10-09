import { expect } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { repoConfigSchema, type WorkspaceSession } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostResourceError } from "../../../effect/host-errors";
import { createTerminalLaunchEnvironment } from "../../../infrastructure/terminals/terminal-launch-environment";
import type { FilesystemPort } from "../../../ports/filesystem-port";
import {
  TerminalPtyError,
  type TerminalPtyHandlers,
  type TerminalPtyLaunchPlan,
  type TerminalPtyPort,
} from "../../../ports/terminal-pty-port";
import { createGitPortTestDouble } from "../../../test-support/service-test-doubles";
import type { TaskWorktreeService } from "../../tasks/worktrees/task-worktree-service";
import type { WithProcessStartAdmission } from "../../workspaces/workspace-admission-service";
import { TERMINAL_LIMITS } from "../terminal-limits";
import { createTerminalService } from "../terminal-service";
import type { TerminalTitleSettlementScheduler } from "../terminal-title-settler";

export const filesystem: FilesystemPort = {
  homeDirectory: () => "/home/user",
  canonicalize: (path: string) => Effect.succeed(`/canonical${path}`),
  readDirectory: () => Effect.succeed([]),
  readFileBytes: () => Effect.succeed(new Uint8Array()),
  readFileSnapshot: () => Effect.die("not used"),
  replaceFileBytes: () => Effect.die("not used"),
  stat: () => Effect.succeed({ isDirectory: true }),
  exists: () => Effect.succeed(true),
  join: posix.join,
  relative: posix.relative,
  extension: posix.extname,
  parent: (path) => (path === "/" ? null : posix.dirname(path)),
};

export const makePty = (supportsOutputPause = true, hasChildProcesses = true) => {
  const operations: string[] = [];
  const startDirectories: string[] = [];
  const launches: TerminalPtyLaunchPlan[] = [];
  let handlers: TerminalPtyHandlers | null = null;
  let terminateFails = false;
  let terminateFailuresRemaining = 0;
  const port: TerminalPtyPort = {
    start: (plan, nextHandlers) => {
      startDirectories.push(plan.cwd);
      launches.push(plan);
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
    launches,
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

export const waitForPtyOperation = async (
  operations: string[],
  operation: string,
): Promise<void> => {
  for (let attempt = 0; attempt < 200 && !operations.includes(operation); attempt += 1) {
    await Bun.sleep(10);
  }
  expect(operations).toContain(operation);
};

export const emitEvictedReplay = async (pty: ReturnType<typeof makePty>): Promise<void> => {
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

/** Removes the fake login shell. Call it in `afterAll` of each test file that uses the harness. */
export const removeFakeShell = async (): Promise<void> => {
  if (fakeShellRoot !== null) {
    await rm(fakeShellRoot, { force: true, recursive: true });
    fakeShellRoot = null;
    fakeShellPath = null;
  }
};

export const makeService = async (
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
    launchEnvironment: createTerminalLaunchEnvironment({
      readEnv: () => ({ PATH: "/usr/bin" }),
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

export const workspaceSessionRecord = (
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
  speed: "standard",
  archivedAt: null,
});

export const workspaceTerminalDependencies = (records: Map<string, WorkspaceSession>) => ({
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
