import type { AgentEnginePort } from "@openducktor/core";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { PrepareSessionSend } from "./prepare-session-send";
import { type ReadSessionSnapshot, requireWorkspaceRepoPath } from "../support/session-invariants";
import { toBoundRuntimeSessionRef } from "../support/session-runtime-ref";

export type ContinueInterruptedTurnDependencies = {
  workspaceRepoPath: string | null;
  adapter: Pick<AgentEnginePort, "continueInterruptedTurn">;
  readSessionSnapshot: ReadSessionSnapshot;
  prepareSessionSend: (
    session: AgentSessionState,
    options: { prepareWorkflowContext: boolean },
  ) => ReturnType<PrepareSessionSend>;
};

/**
 * Starts one native continuation of the latest unfinished turn. The runtime emits the
 * new output through the live session stream, so this call writes no local session state
 * and leaves the composer draft and transcript untouched. A host failure propagates
 * unchanged so the chat can show its typed reason and next action.
 */
export const createContinueInterruptedTurn = ({
  workspaceRepoPath,
  adapter,
  readSessionSnapshot,
  prepareSessionSend,
}: ContinueInterruptedTurnDependencies) => {
  return async (identity: AgentSessionIdentity): Promise<void> => {
    const session = readSessionSnapshot(identity);
    if (!session) {
      throw new Error(
        `Session '${identity.externalSessionId}' is no longer loaded. Reload the session, then retry Resume.`,
      );
    }
    const sessionRef = toBoundRuntimeSessionRef(
      requireWorkspaceRepoPath(workspaceRepoPath),
      session,
      "resume",
    );
    // Restore the workflow prompt, so a session resumed after a restart continues with
    // the task and role instructions that the original launch sent.
    const prepared = await prepareSessionSend(session, { prepareWorkflowContext: true });
    const continuationInput: Parameters<typeof adapter.continueInterruptedTurn>[0] = {
      ...sessionRef,
    };
    if (session.selectedModel) {
      continuationInput.model = session.selectedModel;
    }
    if (prepared.systemPrompt !== undefined) {
      continuationInput.systemPrompt = prepared.systemPrompt;
    }
    // Keep the host failure intact: the chat reads its typed reason and next action.
    await adapter.continueInterruptedTurn(continuationInput);
  };
};
