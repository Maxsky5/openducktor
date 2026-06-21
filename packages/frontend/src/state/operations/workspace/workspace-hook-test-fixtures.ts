import type { WorkspaceRecord } from "@openducktor/contracts";
import type { WorkspaceOperationsHostClient } from "./workspace-operations-types";

export const workspace = (repoPath: string, isActive = false): WorkspaceRecord => ({
  workspaceId: repoPath.replace(/^\//, "").replaceAll("/", "-") || "repo",
  workspaceName: repoPath.split("/").filter(Boolean).at(-1) ?? "repo",
  repoPath,
  iconDataUrl: null,
  isActive,
  hasConfig: true,
  configuredWorktreeBasePath: null,
  defaultWorktreeBasePath: "/tmp/default-worktrees",
  effectiveWorktreeBasePath: "/tmp/default-worktrees",
});

export const createWorkspaceHostClient = (): WorkspaceOperationsHostClient => ({
  workspaceList: async () => [],
  workspaceAdd: async (input) => workspace(input.repoPath),
  workspaceSelect: async (workspaceId: string) => workspace(`/${workspaceId}`, true),
  workspaceReorder: async (workspaceOrder: string[]) =>
    workspaceOrder.map((workspaceId) => workspace(`/${workspaceId}`)),
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

export const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

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
