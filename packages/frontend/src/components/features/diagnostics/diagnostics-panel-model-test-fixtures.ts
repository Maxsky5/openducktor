import type {
  BeadsCheck,
  RuntimeDescriptor,
  RuntimeInstanceSummary,
  WorkspaceRecord,
} from "@openducktor/contracts";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import {
  type BeadsCheckFixtureOverrides,
  createBeadsCheckFixture,
} from "@/test-utils/shared-test-fixtures";
import type { RepoRuntimeHealthCheck } from "@/types/diagnostics";

export const makeRuntimeDefinitions = (): RuntimeDescriptor[] => [
  structuredClone(OPENCODE_RUNTIME_DESCRIPTOR),
];

export const makeRuntimeSummary = (): RuntimeInstanceSummary => ({
  kind: "opencode",
  runtimeId: "runtime-1",
  repoPath: "/repo",
  taskId: null,
  role: "workspace",
  workingDirectory: "/repo",
  runtimeRoute: {
    type: "local_http",
    endpoint: "http://127.0.0.1:49700",
  },
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

export const makeBeadsCheck = (overrides: BeadsCheckFixtureOverrides = {}): BeadsCheck =>
  createBeadsCheckFixture(
    {
      beadsPath: "/Users/dev/.openducktor/beads/repo/.beads",
      repoStoreHealth: {
        attachment: {
          path: "/Users/dev/.openducktor/beads/repo/.beads",
          databaseName: "repo_db",
        },
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
