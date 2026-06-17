import type { RuntimeDescriptor, TaskStoreCheck, WorkspaceRecord } from "@openducktor/contracts";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import {
  createTaskStoreCheckFixture,
  type TaskStoreCheckFixtureOverrides,
} from "@/test-utils/shared-test-fixtures";
import type { RepoRuntimeDiagnosticInstance, RepoRuntimeHealthCheck } from "@/types/diagnostics";

export const makeRuntimeDefinitions = (): RuntimeDescriptor[] => [
  structuredClone(OPENCODE_RUNTIME_DESCRIPTOR),
];

export const makeRuntimeDiagnosticInstance = (): RepoRuntimeDiagnosticInstance => ({
  kind: "opencode",
  repoPath: "/repo",
  taskId: null,
  role: "workspace",
  workingDirectory: "/repo",
  startedAt: "2026-02-20T12:00:00.000Z",
  descriptor: structuredClone(OPENCODE_RUNTIME_DESCRIPTOR),
});

type RepoHealthOverrides = Omit<Partial<RepoRuntimeHealthCheck>, "runtime" | "mcp"> & {
  runtime?: Partial<RepoRuntimeHealthCheck["runtime"]>;
  mcp?: Partial<NonNullable<RepoRuntimeHealthCheck["mcp"]>>;
};

const repoHealthStatusFor = ({
  mcp,
  overrides,
  runtime,
}: {
  mcp: NonNullable<RepoRuntimeHealthCheck["mcp"]>;
  overrides: RepoHealthOverrides;
  runtime: RepoRuntimeHealthCheck["runtime"];
}): RepoRuntimeHealthCheck["status"] => {
  if (overrides.status) {
    return overrides.status;
  }
  if (runtime.status === "error" || mcp.status === "error") {
    return "error";
  }
  if (
    mcp.status === "checking" ||
    mcp.status === "reconnecting" ||
    mcp.status === "waiting_for_runtime"
  ) {
    return "checking";
  }
  return runtime.status;
};

export const makeRepoHealth = (overrides: RepoHealthOverrides = {}): RepoRuntimeHealthCheck => {
  const checkedAt = overrides.checkedAt ?? "2026-02-20T12:01:00.000Z";
  const runtime: RepoRuntimeHealthCheck["runtime"] = {
    status: "ready",
    stage: "runtime_ready",
    observation: null,
    instance: null,
    startedAt: null,
    updatedAt: checkedAt,
    elapsedMs: null,
    attempts: null,
    detail: null,
    failureKind: null,
    failureReason: null,
    ...overrides.runtime,
  };
  const mcp: NonNullable<RepoRuntimeHealthCheck["mcp"]> = {
    supported: true,
    status: "connected",
    serverName: "openducktor",
    serverStatus: "connected",
    toolIds: [],
    detail: null,
    failureKind: null,
    ...overrides.mcp,
  };

  return {
    status: repoHealthStatusFor({ mcp, overrides, runtime }),
    checkedAt,
    runtime,
    mcp,
  };
};

export const makeTaskStoreCheck = (
  overrides: TaskStoreCheckFixtureOverrides = {},
): TaskStoreCheck =>
  createTaskStoreCheckFixture(
    {
      taskStorePath: "/Users/dev/.openducktor/task-stores/repo/database.sqlite",
      repoStoreHealth: {
        databasePath: "/Users/dev/.openducktor/task-stores/repo/database.sqlite",
      },
    },
    overrides,
  );

export const makeWorkspace = (
  repoPath: string,
  overrides: Partial<WorkspaceRecord> = {},
): WorkspaceRecord => ({
  workspaceId: repoPath.split("/").filter(Boolean).at(-1) ?? "repo",
  workspaceName: repoPath.split("/").filter(Boolean).at(-1) ?? "repo",
  repoPath,
  isActive: true,
  hasConfig: true,
  configuredWorktreeBasePath: "/worktrees",
  defaultWorktreeBasePath: "/Users/dev/.openducktor/worktrees/repo",
  effectiveWorktreeBasePath: "/worktrees",
  ...overrides,
});
