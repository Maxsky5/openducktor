import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { canOpenStartupAttempt } from "@openducktor/frontend-core/sessions/startup/startup-navigation";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { routes, sessionParams, workspaceSessionRoute } from "@/navigation/routes";
import { useStartupPresentationActions } from "./startup-presentation-context";

/** Opens the saved target or draft startup recovery view from this connection. */
export const useOpenStartupSession = () => {
  const connection = useClientConnection();
  const router = useRouter();
  const { sheetClosers } = useStartupPresentationActions();
  return useCallback(
    (attemptId: string) => {
      const attempt = connection.startupAttempts.getAttempt(attemptId);
      if (!canOpenStartupAttempt(attempt)) return;
      const target = attempt.navigationTarget;
      const closeSheet =
        attempt.presentation === "dialog" ? sheetClosers.get(attemptId) : undefined;
      if (attempt.presentation === "dialog" && !closeSheet) return;
      const fromNotification = attempt.presentation === "notification";
      const transitionToInline = () => {
        if (fromNotification) connection.startupAttempts.returnToInline(attemptId);
        else connection.startupAttempts.handoff(attemptId);
      };
      if (target.kind === "workspace_session_draft") {
        closeSheet?.();
        connection.startupAttempts.returnToInline(attemptId);
        router.push(routes.newChat(target.workspaceId, target.draftId));
        return;
      }
      if (target.kind === "task_session") {
        closeSheet?.();
        transitionToInline();
        router.push(
          routes.session({
            ...sessionParams(target.workspaceId, target.identity),
            startupAttemptId: attemptId,
          }),
        );
      } else if (
        target.kind === "workspace_session" &&
        attempt.ownership.state === "saved" &&
        attempt.ownership.target.kind === "workspace"
      ) {
        const record = attempt.ownership.target.record;
        if (record.id !== target.sessionId) return;
        const boundRoute = workspaceSessionRoute(target.workspaceId, record, attemptId);
        closeSheet?.();
        if (!boundRoute) {
          if (fromNotification) connection.startupAttempts.returnToInline(attemptId);
          router.push(routes.newChat(target.workspaceId, undefined, attemptId));
          return;
        }
        transitionToInline();
        router.push(boundRoute);
      } else return;
    },
    [connection, router, sheetClosers],
  );
};
