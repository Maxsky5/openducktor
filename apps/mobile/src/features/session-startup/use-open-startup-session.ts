import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { workspaceSessionIdentity } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import { canOpenStartupSession } from "@openducktor/frontend-core/sessions/startup/startup-navigation";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { routes, sessionParams } from "@/navigation/routes";
import { useStartupPresentation } from "./startup-presentation-context";

/** Opens the saved target from this connection. */
export const useOpenStartupSession = () => {
  const connection = useClientConnection();
  const router = useRouter();
  const { sheetClosers } = useStartupPresentation();
  return useCallback(
    (attemptId: string) => {
      const attempt = connection.startupAttempts.getAttempt(attemptId);
      if (!canOpenStartupSession(attempt)) return;
      const target = attempt.navigationTarget;
      const closeSheet =
        attempt.presentation === "dialog" ? sheetClosers.get(attemptId) : undefined;
      if (attempt.presentation === "dialog" && !closeSheet) return;
      if (target.kind === "task_session") {
        closeSheet?.();
        router.push(routes.session(sessionParams(target.workspaceId, target.identity)));
      } else if (
        target.kind === "workspace_session" &&
        attempt.ownership.target.kind === "workspace"
      ) {
        const record = attempt.ownership.target.record;
        if (record.id !== target.sessionId) return;
        const identity = workspaceSessionIdentity(record);
        if (!identity) return;
        closeSheet?.();
        router.push(routes.session(sessionParams(target.workspaceId, identity)));
      } else return;
      connection.startupAttempts.handoff(attemptId);
    },
    [connection, router, sheetClosers],
  );
};
