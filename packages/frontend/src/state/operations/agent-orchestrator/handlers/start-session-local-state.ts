import type { AgentSessionState } from "@/types/agent-orchestrator";
import { runOrchestratorTask } from "../support/async-side-effects";
import { toPersistedSessionRecord } from "../support/persistence";
import type { SessionDependencies, SessionStartTags } from "./start-session.types";

export const persistInitialSession = async ({
  initialSession,
  session,
  tags,
}: {
  initialSession: AgentSessionState;
  session: SessionDependencies;
  tags: SessionStartTags;
}): Promise<void> => {
  await runOrchestratorTask(
    "start-session-persist-initial-session",
    async () => {
      if (initialSession.sessionAssociation.kind !== "workflow") {
        throw new Error(
          `Cannot persist initial session '${initialSession.externalSessionId}' because its association is ${initialSession.sessionAssociation.kind}.`,
        );
      }
      await session.persistSessionRecord(
        initialSession.sessionAssociation.taskId,
        toPersistedSessionRecord(initialSession),
      );
    },
    { tags },
  );
};
