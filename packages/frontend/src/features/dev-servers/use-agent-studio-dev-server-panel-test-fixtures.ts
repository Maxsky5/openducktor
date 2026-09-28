import type { DevServerGroupState, DevServerScriptState } from "@openducktor/contracts";

export const createDeferred = <T>() => {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  let reject: ((cause?: unknown) => void) | null = null;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve: (value: T) => resolve?.(value),
    reject: (cause?: unknown): void => {
      reject?.(cause);
    },
  };
};

export const buildScript = (
  overrides: Partial<DevServerScriptState> = {},
): DevServerScriptState => {
  const bufferedRunIdentity = overrides.bufferedTerminalChunks?.[0]?.runIdentity;
  const defaultRunIdentity =
    overrides.pid === null || overrides.pid === undefined
      ? null
      : {
          runId: "frontend:1",
          runOrder: { hostInstanceId: "host-1", generation: 1 },
        };
  const runIdentity =
    overrides.runIdentity === undefined
      ? (bufferedRunIdentity ?? defaultRunIdentity)
      : overrides.runIdentity;
  const startedCommand = runIdentity === null ? null : (overrides.command ?? "bun run dev");
  return {
    scriptId: "frontend",
    name: "Frontend",
    command: "bun run dev",
    startedCommand,
    status: "stopped",
    runIdentity,
    pid: null,
    startedAt: null,
    exitCode: null,
    lastError: null,
    bufferedTerminalChunks: [],
    ...overrides,
  };
};

export const buildState = (overrides: Partial<DevServerGroupState> = {}): DevServerGroupState => ({
  repoPath: "/repo",
  owner: { kind: "task", taskId: "task-7" },
  workingDirectory: "/tmp/worktree/task-7",
  scripts: [buildScript()],
  revision: 0,
  updatedAt: "2026-03-19T15:30:00.000Z",
  ...overrides,
});
