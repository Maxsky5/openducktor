import type { WorkspaceRecord } from "@openducktor/contracts";
import { createTestHostConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import type { HostClient } from "@openducktor/host-client";

export const workspace = (repoPath: string, isActive = false): WorkspaceRecord => ({
  workspaceId: repoPath.replace(/^\//, "").replaceAll("/", "-") || "repo",
  workspaceName: repoPath.split("/").filter(Boolean).at(-1) ?? "repo",
  abbreviation: null,
  tileColor: null,
  repoPath,
  iconDataUrl: null,
  isActive,
  hasConfig: true,
  configuredWorktreeBasePath: null,
  defaultWorktreeBasePath: "/tmp/default-worktrees",
  effectiveWorktreeBasePath: "/tmp/default-worktrees",
});

/** A host client that a test changes command by command. Other commands fail. */
export const createWorkspaceHostClient = (): HostClient =>
  Object.assign(createTestHostConnection().client, {
    workspaceList: async () => [],
    workspaceProviderSetupCommit: async () => {
      throw new Error("Not used");
    },
    workspaceAdd: async (input) => workspace(input.repoPath),
    workspaceSelect: async (workspaceId: string) => workspace(`/${workspaceId}`, true),
    workspaceCatalogGet: async () => ({
      openWorkspaces: [],
      closedWorkspaces: [],
      incompleteRemovals: [],
    }),
    workspaceClose: async (_workspaceId: string, repoPath: string) => ({
      openWorkspaces: [],
      closedWorkspaces: [workspace(repoPath)],
      incompleteRemovals: [],
    }),
    workspaceReopen: async (_workspaceId: string, repoPath: string) => ({
      openWorkspaces: [workspace(repoPath, true)],
      closedWorkspaces: [],
      incompleteRemovals: [],
    }),
    workspaceRemove: async () => ({
      catalog: {
        openWorkspaces: [],
        closedWorkspaces: [],
        incompleteRemovals: [],
      },
      removedWorktrees: [],
    }),
    workspaceResolvePath: async () => ({ kind: "new" }),
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
  } satisfies Partial<HostClient>);

export const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

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
