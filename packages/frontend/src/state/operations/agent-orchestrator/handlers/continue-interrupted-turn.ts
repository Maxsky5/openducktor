import type { AgentEnginePort } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { type ReadSessionSnapshot, requireWorkspaceRepoPath } from "../support/session-invariants";
import { toBoundRuntimeSessionRef } from "../support/session-runtime-ref";

export type ContinueInterruptedTurnDependencies = {
  workspaceRepoPath: string | null;
  adapter: Pick<AgentEnginePort, "continueInterruptedTurn">;
  readSessionSnapshot: ReadSessionSnapshot;
};

/**
 * Starts one native continuation of the latest unfinished turn. The runtime emits the
 * new output through the live session stream, so this call writes no local session state
 * and leaves the composer draft and transcript untouched.
 */
export const createContinueInterruptedTurn = ({
  workspaceRepoPath,
  adapter,
  readSessionSnapshot,
}: ContinueInterruptedTurnDependencies) => {
  return async (identity: AgentSessionIdentity): Promise<void> => {
    const session = readSessionSnapshot(identity);
    if (!session) {
      return;
    }
    const externalSessionId = session.externalSessionId;
    const sessionRef = toBoundRuntimeSessionRef(
      requireWorkspaceRepoPath(workspaceRepoPath),
      session,
      "resume",
    );
    const continuationInput: Parameters<typeof adapter.continueInterruptedTurn>[0] = {
      ...sessionRef,
    };
    if (session.selectedModel) {
      continuationInput.model = session.selectedModel;
    }
    try {
      await adapter.continueInterruptedTurn(continuationInput);
    } catch (error) {
      throw new Error(
        `Failed to continue the interrupted turn for session '${externalSessionId}': ${errorMessage(error)}`,
      );
    }
  };
};
