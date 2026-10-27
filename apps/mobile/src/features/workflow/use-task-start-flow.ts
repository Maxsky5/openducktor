import type { WorkspaceRecord } from "@openducktor/contracts";
import {
  TasksStateContext,
  useRequiredContext,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import { useAgentSessionSummaries } from "@openducktor/frontend-core/sessions/session-store-hooks";
import { useSessionStartWorkflowRunner } from "@openducktor/frontend-core/sessions/start/use-session-start-workflow-runner";
import {
  type OpenTaskView,
  useTaskSessionStartFlow,
} from "@openducktor/frontend-core/tasks/workflow/use-task-session-start-flow";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigation } from "expo-router";
import { showNoSession } from "./task-action-routing";
import { useModelFavorites } from "@/features/model-picker/use-model-favorites";
import { useSheetNavigation } from "./use-sheet-navigation";
import { useWorkspaceRepoSettings } from "./use-workspace-repo-settings";
import { useVisibleHandoff } from "@/features/session-startup/use-visible-handoff";
import { useStartupAttempt } from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import { useStartupSheetClose } from "@/features/session-startup/startup-presentation-context";
import { useRepairedStartupHandoff } from "@/features/session-startup/use-repaired-startup-handoff";

export function useTaskStartFlow(workspace: WorkspaceRecord) {
  const connection = useClientConnection();
  const [backgroundAttemptId, setBackgroundAttemptId] = useState<string | null>(null);
  const { tasks } = useRequiredContext(TasksStateContext, "useTaskStartFlow");
  const sessions = useAgentSessionSummaries();
  const {
    repoSettings,
    repoSettingsReady,
    repoSettingsError,
    retryRepoSettings,
    branches,
    branchesFailure,
    gitProvider,
  } = useWorkspaceRepoSettings(workspace);
  const favoriteState = useModelFavorites();
  const navigation = useSheetNavigation(workspace.workspaceId);
  const routeNavigation = useNavigation();
  const visibleHandoff = useVisibleHandoff();
  const { workspaceId, repoPath } = workspace;
  const runSessionStartWorkflow = useSessionStartWorkflowRunner({ workspaceId, repoPath });
  const openTaskView = useCallback<OpenTaskView>(
    (target) => {
      if (target.kind === "task_session") {
        const startup = connection.startupAttempts.getSnapshot().find((attempt) => {
          const destination = attempt.navigationTarget;
          return (
            attempt.presentation === "dialog" &&
            destination?.kind === "task_session" &&
            destination.workspaceId === target.workspaceId &&
            agentSessionIdentityKey(destination.identity) ===
              agentSessionIdentityKey(target.identity)
          );
        });
        return visibleHandoff(() => {
          if (
            !routeNavigation.isFocused() ||
            (startup &&
              (!connection.startupAttempts.isReadyForHandoff(startup.id) ||
                connection.startupAttempts.getAttempt(startup.id)?.presentation !== "dialog"))
          )
            return;
          navigation.openSession(target.identity);
        });
      }
      // The flow opens the task when the role has no session to continue.
      if (target.role) showNoSession(connection.feedback, target.taskId, target.role);
      navigation.openTask(target.taskId);
    },
    [connection, navigation, routeNavigation, visibleHandoff],
  );
  const flow = useTaskSessionStartFlow({
    activeWorkspaceId: workspaceId,
    branches,
    favoriteState,
    repoSettings,
    tasks,
    sessions,
    openTaskView,
    workspaceRepoPath: repoPath,
    runSessionStartWorkflow,
    onBackgroundTransfer: setBackgroundAttemptId,
  });
  const start = flow.sessionStartModal;
  const attemptId = start?.phase.kind === "progress" ? start.phase.startupAttemptId : null;
  const attempt = useStartupAttempt(attemptId);
  useStartupSheetClose(attemptId, navigation.close);
  useRepairedStartupHandoff(attempt);
  useEffect(() => {
    if (attemptId && !attempt) navigation.close();
  }, [attempt, attemptId, navigation]);
  // Let the sheet's removal guard update before closing it.
  useEffect(() => {
    if (backgroundAttemptId) navigation.close();
  }, [backgroundAttemptId, navigation]);
  // A start reads the role defaults and the target branch when its choices open, so it waits for
  // the current repository settings.
  const settings = useMemo(
    () => ({
      ready: repoSettingsReady,
      error: repoSettingsError ? errorMessage(repoSettingsError) : null,
      retry: retryRepoSettings,
    }),
    [repoSettingsError, repoSettingsReady, retryRepoSettings],
  );
  return {
    flow,
    navigation,
    tasks,
    sessions,
    settings,
    branchesFailure,
    gitProvider,
    backgroundAttemptId,
  };
}
