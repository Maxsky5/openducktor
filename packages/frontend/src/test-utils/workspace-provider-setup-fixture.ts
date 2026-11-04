import type { HostClient } from "@openducktor/host-client";
import type {
  GitTargetBranch,
  WorkspaceProviderSetupSession,
  WorkspaceProviderSetupCommit,
} from "@openducktor/contracts";

/** The details of a workspace that a local-only provider setup creates. */
export type LocalWorkspaceDetails = {
  workspaceId: string;
  workspaceName: string;
  repoPath: string;
  defaultTargetBranch: GitTargetBranch;
  abbreviation?: string;
  tileColor?: string;
};

// Setup IDs are random, so parallel test files can share this map.
const sessions = new Map<string, WorkspaceProviderSetupSession>();
export const localOnlySetupPath = (setupId: string): string => {
  const value = sessions.get(setupId);
  if (!value) throw new Error("Setup not found");
  return value.repoPath;
};

type LocalOnlyProviderSetupClient = Pick<
  HostClient,
  | "workspaceProviderSetupBegin"
  | "workspaceProviderSetupSet"
  | "workspaceProviderSetupDetect"
  | "workspaceProviderSetupStatus"
  | "workspaceProviderSetupTargetBranches"
  | "workspaceProviderSetupDiscard"
>;

/**
 * Host commands for a provider setup that detects no provider and the default branch `main`. Give them to a test connection,
 * for example `createTestClientConnection({ client: localOnlyProviderSetupClient() })`.
 */
export function localOnlyProviderSetupClient(): LocalOnlyProviderSetupClient {
  return {
    workspaceProviderSetupBegin: async ({ repoPath }) => {
      const value = { setupId: crypto.randomUUID(), repoPath, revision: 0 };
      sessions.set(value.setupId, value);
      return value;
    },
    workspaceProviderSetupSet: async ({ setupId, revision }) => {
      const current = sessions.get(setupId);
      if (!current || current.revision !== revision) throw new Error("Stale setup");
      const next = { ...current, revision: revision + 1 };
      sessions.set(setupId, next);
      return next;
    },
    workspaceProviderSetupDetect: async () => ({
      outcome: "none",
      candidates: [],
      gitlabOrigin: null,
    }),
    workspaceProviderSetupStatus: async () => ({ health: null, connection: null }),
    workspaceProviderSetupTargetBranches: async () => ({
      repositoryDefault: { kind: "detected", targetBranch: { branch: "main" } },
      branches: [{ name: "main", isCurrent: true, isRemote: false }],
    }),
    workspaceProviderSetupDiscard: async ({ setupId }) => {
      sessions.delete(setupId);
    },
  };
}

export function localOnlyWorkspaceDetails(input: WorkspaceProviderSetupCommit) {
  const details: LocalWorkspaceDetails = {
    workspaceId: input.workspaceId,
    workspaceName: input.workspaceName,
    repoPath: localOnlySetupPath(input.setupId),
    defaultTargetBranch: input.defaultTargetBranch,
  };
  if (input.abbreviation) details.abbreviation = input.abbreviation;
  if (input.tileColor) details.tileColor = input.tileColor;
  return details;
}
