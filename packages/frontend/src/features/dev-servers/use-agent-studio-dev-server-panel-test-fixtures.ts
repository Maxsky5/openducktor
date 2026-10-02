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
  const hasRun =
    overrides.pid != null ||
    overrides.terminalId != null ||
    ["starting", "running", "stopping"].includes(overrides.status ?? "stopped");
  const startedCommand = hasRun ? (overrides.command ?? "bun run dev") : null;
  return {
    scriptId: "frontend",
    name: "Frontend",
    command: "bun run dev",
    startedCommand,
    status: "stopped",
    pid: null,
    startedAt: null,
    exitCode: null,
    lastError: null,
    terminalId: hasRun ? "terminal-output" : null,
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
