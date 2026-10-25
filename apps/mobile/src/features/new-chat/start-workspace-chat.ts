import type { WorkspaceSession } from "@openducktor/contracts";
import { toAgentSessionIdentity } from "@openducktor/frontend-core/lib/agent-session-identity";
import { isOutcomeUnknown } from "@openducktor/frontend-core/lib/command-outcome";
import { workspaceSessionQueryKeys } from "@openducktor/frontend-core/queries/workspace-sessions";
import type { AgentSessionsStore } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import { workspaceSessionIdentity } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import { startWorkspaceSessionRuntime } from "@openducktor/frontend-core/workspace-sessions/create/launch-workspace-session";
import type { HostClient } from "@openducktor/host-client";
import type { QueryClient } from "@tanstack/react-query";

export const CHAT_START_WITHOUT_SESSION =
  "The host started the chat without a runtime session. Open the chat again from Sessions.";

/**
 * Starts the runtime session of a saved chat with the shared start rules, and returns the session
 * identity to open. After a lost result, the active chat list reads again, because the host may
 * have started the chat.
 */
export const startWorkspaceChat = async ({
  host,
  store,
  queryClient,
  workspace,
  record,
}: {
  host: Pick<HostClient, "workspaceSessionStart">;
  store: AgentSessionsStore;
  queryClient: QueryClient;
  workspace: { workspaceId: string; repoPath: string };
  record: WorkspaceSession;
}): Promise<AgentSessionIdentity> => {
  let result: Awaited<ReturnType<typeof startWorkspaceSessionRuntime>>;
  try {
    result = await startWorkspaceSessionRuntime({
      host,
      store,
      queryClient,
      workspace,
      sessionId: record.id,
    });
  } catch (cause) {
    if (isOutcomeUnknown(cause)) {
      void queryClient.invalidateQueries({
        queryKey: workspaceSessionQueryKeys.list(workspace.workspaceId, false),
      });
    }
    throw cause;
  }
  const identity =
    workspaceSessionIdentity(result.session) ??
    (result.runtimeSession ? toAgentSessionIdentity(result.runtimeSession) : null);
  if (!identity) throw new Error(CHAT_START_WITHOUT_SESSION);
  return identity;
};
