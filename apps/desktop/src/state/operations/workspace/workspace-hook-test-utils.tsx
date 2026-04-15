import type { WorkspaceRecord } from "@openducktor/contracts";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { PropsWithChildren } from "react";
import { QueryProvider } from "@/lib/query-provider";
import type { WorkspaceOperationsHostClient } from "./workspace-operations-types";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

export const IsolatedQueryWrapper = ({ children }: PropsWithChildren) => (
  <QueryProvider useIsolatedClient>{children}</QueryProvider>
);

export const workspace = (repoPath: string, isActive = false): WorkspaceRecord => ({
  workspaceId: repoPath.replace(/^\//, "").replaceAll("/", "-") || "repo",
  workspaceName: repoPath.split("/").filter(Boolean).at(-1) ?? "repo",
  repoPath,
  isActive,
  hasConfig: true,
  configuredWorktreeBasePath: null,
  defaultWorktreeBasePath: "/tmp/default-worktrees",
  effectiveWorktreeBasePath: "/tmp/default-worktrees",
});

export const createWorkspaceHostClient = (): WorkspaceOperationsHostClient => ({
  workspaceList: async () => [],
  workspaceAdd: async (repoPath: string) => workspace(repoPath),
  workspaceSelect: async (workspaceId: string) => workspace(`/${workspaceId}`, true),
  workspaceGetRepoConfig: async () => {
    throw new Error("workspaceGetRepoConfig not configured");
  },
  runtimeEnsure: async () => {
    throw new Error("runtimeEnsure not configured");
  },
  gitGetCurrentBranch: async () => {
    throw new Error("gitGetCurrentBranch not configured");
  },
  gitGetBranches: async () => {
    throw new Error("gitGetBranches not configured");
  },
  gitSwitchBranch: async () => {
    throw new Error("gitSwitchBranch not configured");
  },
});

export const createWorkspaceRuntimeSummary = (repoPath: string) => ({
  kind: "opencode" as const,
  runtimeId: `runtime:${repoPath}`,
  repoPath,
  taskId: null,
  role: "workspace" as const,
  workingDirectory: repoPath,
  runtimeRoute: {
    type: "local_http" as const,
    endpoint: "http://127.0.0.1:3030",
  },
  startedAt: "2026-02-22T08:00:00.000Z",
  descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
});

export const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

export const createDeferred = <T,>() => {
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
