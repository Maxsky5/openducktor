import type { WorkspaceRecord } from "@openducktor/contracts";
import {
  TasksStateContext,
  useRequiredContext,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useAgentSessionSummaries } from "@openducktor/frontend-core/sessions/session-store-hooks";
import { sessionStartMessageRetry } from "@openducktor/frontend-core/sessions/start/session-start-message-retry";
import type { SessionStartWorkflowResult } from "@openducktor/frontend-core/sessions/start/session-start-workflow";
import { useSessionStartWorkflowRunner } from "@openducktor/frontend-core/sessions/start/use-session-start-workflow-runner";
import {
  type OpenTaskView,
  useTaskSessionStartFlow,
} from "@openducktor/frontend-core/tasks/workflow/use-task-session-start-flow";
import { useCallback, useMemo } from "react";
import { reportMessageRetry } from "./start-session/message-retry-store";
import { showNoSession } from "./task-action-routing";
import { useModelFavorites } from "@/features/model-picker/use-model-favorites";
import { useSheetNavigation } from "./use-sheet-navigation";
import { useWorkspaceRepoSettings } from "./use-workspace-repo-settings";

/**
 * The shared task session start flow of frontend-core, for a workflow sheet. A start that opens
 * its session leaves the sheet and opens the session. A first message that did not reach the
 * session goes to the retry store of the connection, so the task details offer Retry message, and
 * a message tells the user where to retry it.
 */
export function useTaskStartFlow(workspace: WorkspaceRecord, taskId: string) {
  const connection = useClientConnection();
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
  const { workspaceId, repoPath } = workspace;
  const runSessionStartWorkflow = useSessionStartWorkflowRunner({ workspaceId, repoPath });
  const openTaskView = useCallback<OpenTaskView>(
    (target) => {
      if (target.kind === "task_session") {
        navigation.openSession(target.identity);
        return;
      }
      // The flow opens the task when the role has no session to continue.
      if (target.role) showNoSession(connection.feedback, target.taskId, target.role);
      navigation.openTask(target.taskId);
    },
    [connection.feedback, navigation],
  );
  const onPostStartMessageFailure = useCallback(
    (result: SessionStartWorkflowResult) => {
      const retry = sessionStartMessageRetry(result);
      if (retry) reportMessageRetry(connection, taskId, retry);
    },
    [connection, taskId],
  );
  const flow = useTaskSessionStartFlow({
    activeWorkspaceId: workspaceId,
    branches,
    favoriteState,
    repoSettings,
    tasks,
    sessions,
    openTaskView,
    onPostStartMessageFailure,
    workspaceRepoPath: repoPath,
    runSessionStartWorkflow,
  });
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
  return { flow, navigation, tasks, sessions, settings, branchesFailure, gitProvider };
}
