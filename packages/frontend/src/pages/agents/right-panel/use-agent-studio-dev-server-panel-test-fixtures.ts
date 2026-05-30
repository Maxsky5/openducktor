import type { DevServerGroupState, DevServerScriptState } from "@openducktor/contracts";
import type { RepoSettingsInput } from "@/types/state-slices";

export const createDeferred = <T>() => {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  let reject: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve: (value: T) => resolve?.(value),
    reject: (reason?: unknown) => reject?.(reason),
  };
};

export const buildScript = (
  overrides: Partial<DevServerScriptState> = {},
): DevServerScriptState => ({
  scriptId: "frontend",
  name: "Frontend",
  command: "bun run dev",
  status: "stopped",
  pid: null,
  startedAt: null,
  exitCode: null,
  lastError: null,
  bufferedTerminalChunks: [],
  ...overrides,
});

export const buildState = (overrides: Partial<DevServerGroupState> = {}): DevServerGroupState => ({
  repoPath: "/repo",
  taskId: "task-7",
  worktreePath: "/tmp/worktree/task-7",
  scripts: [buildScript()],
  updatedAt: "2026-03-19T15:30:00.000Z",
  ...overrides,
});

export const repoSettings: RepoSettingsInput = {
  defaultRuntimeKind: "opencode",
  worktreeBasePath: "",
  branchPrefix: "",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  preStartHooks: [],
  postCompleteHooks: [],
  devServers: [{ id: "frontend", name: "Frontend", command: "bun run dev" }],
  worktreeCopyPaths: [],
  agentDefaults: {
    spec: null,
    planner: null,
    build: null,
    qa: null,
  },
};
