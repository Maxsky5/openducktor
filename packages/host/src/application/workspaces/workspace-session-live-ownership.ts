import type { WorkspaceSession } from "@openducktor/contracts";
import { Effect } from "effect";
import type { AgentSessionLiveStateService } from "../agent-sessions/agent-session-live-state-service";

export const setWorkspaceSessionOwnership = (
  live: Pick<AgentSessionLiveStateService, "setSessionOwnership">,
  repoPath: string,
  session: WorkspaceSession,
  active: boolean,
) =>
  session.externalSessionId === null
    ? Effect.void
    : live.setSessionOwnership(
        {
          repoPath,
          runtimeKind: session.runtimeKind,
          externalSessionId: session.externalSessionId,
          workingDirectory: session.executionTarget.workingDirectory,
        },
        active,
      );
