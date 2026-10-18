import type { HostClient } from "@openducktor/host-client";
import type { WorkspaceSelectionOperationsInput } from "@/types/state-slices";
import type {
  WorkspaceProviderSetupSession,
  WorkspaceProviderSetupCommit,
} from "@openducktor/contracts";

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
  | "workspaceProviderSetupDiscard"
>;

/**
 * Host commands for a provider setup that detects no provider. Give them to a test connection,
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
    workspaceProviderSetupDetect: async () => ({ outcome: "none", candidates: [] }),
    workspaceProviderSetupStatus: async () => ({ health: null, connection: null }),
    workspaceProviderSetupDiscard: async ({ setupId }) => {
      sessions.delete(setupId);
    },
  };
}

export function localOnlyWorkspaceDetails(input: WorkspaceProviderSetupCommit) {
  const details: WorkspaceSelectionOperationsInput = {
    workspaceId: input.workspaceId,
    workspaceName: input.workspaceName,
    repoPath: localOnlySetupPath(input.setupId),
  };
  if (input.abbreviation) details.abbreviation = input.abbreviation;
  if (input.tileColor) details.tileColor = input.tileColor;
  return details;
}
