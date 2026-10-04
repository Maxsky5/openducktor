export type DiagnosticsAutoOpenInput = {
  hasHostBlockingFailure: boolean;
  workspaceId: string | null;
  hasWorkspaceBlockingFailure: boolean;
};

/**
 * Remembers in memory which causes already opened diagnostics in this app session. The host has
 * one acknowledgement. Each workspace has its own. Closing, recovery, restart, workspace switching,
 * and remounts do not reset them.
 */
export type DiagnosticsAutoOpenOwner = {
  /** Returns true when diagnostics must open now, and acknowledges each cause it represents. */
  claim: (input: DiagnosticsAutoOpenInput) => boolean;
};

export const createDiagnosticsAutoOpenOwner = (): DiagnosticsAutoOpenOwner => {
  let isHostAcknowledged = false;
  const acknowledgedWorkspaceIds = new Set<string>();

  return {
    claim: ({ hasHostBlockingFailure, workspaceId, hasWorkspaceBlockingFailure }) => {
      const opensForHost = hasHostBlockingFailure && !isHostAcknowledged;
      const opensForWorkspace =
        workspaceId !== null &&
        hasWorkspaceBlockingFailure &&
        !acknowledgedWorkspaceIds.has(workspaceId);
      if (opensForHost) {
        isHostAcknowledged = true;
      }
      if (opensForWorkspace) {
        acknowledgedWorkspaceIds.add(workspaceId);
      }
      return opensForHost || opensForWorkspace;
    },
  };
};
