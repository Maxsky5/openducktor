import { hostClient } from "@/lib/host-client";
import type { WorkspaceSelectionOperationsInput } from "@/types/state-slices";
import type {
  WorkspaceProviderSetupSession,
  WorkspaceProviderSetupCommit,
} from "@openducktor/contracts";

// Parallel test files share the host client. Keep the fake until the last file releases it.
let users = 0;
let restore: (() => void) | null = null;
const sessions = new Map<string, WorkspaceProviderSetupSession>();
export const localOnlySetupPath = (setupId: string): string => {
  const value = sessions.get(setupId);
  if (!value) throw new Error("Setup not found");
  return value.repoPath;
};
export function installLocalOnlyProviderSetup(): () => void {
  if (users++ === 0) {
    const begin = hostClient.workspaceProviderSetupBegin;
    const set = hostClient.workspaceProviderSetupSet;
    const detect = hostClient.workspaceProviderSetupDetect;
    const status = hostClient.workspaceProviderSetupStatus;
    const discard = hostClient.workspaceProviderSetupDiscard;
    hostClient.workspaceProviderSetupBegin = async ({ repoPath }) => {
      const value = { setupId: crypto.randomUUID(), repoPath, revision: 0 };
      sessions.set(value.setupId, value);
      return value;
    };
    hostClient.workspaceProviderSetupSet = async ({ setupId, revision }) => {
      const current = sessions.get(setupId);
      if (!current || current.revision !== revision) throw new Error("Stale setup");
      const next = { ...current, revision: revision + 1 };
      sessions.set(setupId, next);
      return next;
    };
    hostClient.workspaceProviderSetupDetect = async () => ({ outcome: "none", candidates: [] });
    hostClient.workspaceProviderSetupStatus = async () => ({ health: null, connection: null });
    hostClient.workspaceProviderSetupDiscard = async ({ setupId }) => {
      sessions.delete(setupId);
    };
    restore = () => {
      hostClient.workspaceProviderSetupBegin = begin;
      hostClient.workspaceProviderSetupSet = set;
      hostClient.workspaceProviderSetupDetect = detect;
      hostClient.workspaceProviderSetupStatus = status;
      hostClient.workspaceProviderSetupDiscard = discard;
    };
  }
  return () => {
    if (--users === 0) {
      restore?.();
      restore = null;
    }
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
