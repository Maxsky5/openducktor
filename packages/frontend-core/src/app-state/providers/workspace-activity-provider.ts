import { useQueryClient } from "@tanstack/react-query";
import {
  createElement,
  type PropsWithChildren,
  type ReactElement,
  useEffect,
  useMemo,
} from "react";
import { createWorkspaceActivityObserver } from "../../workspace-activity/workspace-activity-observer";
import { useHostConnection } from "../../connection/client-connection-react";
import { observeWorkspaceSessionRecords } from "../../queries/workspace-session-updates";
import { observeTaskMergeStatusUpdates } from "../../queries/task-merge-status";
import { createAgentSessionListLiveSync } from "../../queries/agent-sessions";
import { createAgentTurnGitSync } from "../../queries/agent-turn-git-sync";
import { getSessionHistoryFreshnessTracker } from "../../queries/agent-session-history-freshness-tracker";
import { useRequiredContext, WorkspaceScopeContext } from "../app-state-contexts";
import { WorkspaceActivityContext } from "../../workspace-activity/workspace-activity-context";
import { createWorkspaceArchivedSessionsPort } from "../../workspace-activity/archived-sessions-port";
import {
  createWorkspaceSessionLiveSource,
  WorkspaceSessionLiveSourceContext,
} from "../../workspace-activity/workspace-session-live-source";
import {
  registerStartupLiveSource,
  retainStartupPreparationWorkspaces,
} from "../../sessions/startup/startup-prepared-handoff";

/** Keeps one live stream per open workspace for activity and session readers. */
export function WorkspaceActivityProvider({ children }: PropsWithChildren): ReactElement {
  const queryClient = useQueryClient();
  const host = useHostConnection();
  const { workspaces } = useRequiredContext(WorkspaceScopeContext, "WorkspaceActivityProvider");
  const liveSource = useMemo(
    () =>
      createWorkspaceSessionLiveSource(
        async (input, listener) => {
          const updateLists = createAgentSessionListLiveSync(queryClient);
          const git = createAgentTurnGitSync(queryClient);
          const history = getSessionHistoryFreshnessTracker(queryClient).observeWorkspace(
            input.repoPath,
          );
          try {
            const stop = await host.observeAgentSessionLive(input, (envelope) => {
              history.recordEvent(envelope);
              updateLists(envelope);
              git.observe(envelope);
              listener(envelope);
            });
            return () => {
              history.close();
              git.dispose();
              stop();
            };
          } catch (cause) {
            history.close();
            git.dispose();
            throw cause;
          }
        },
        (input) => host.client.agentSessionLiveAttach(input),
      ),
    [host, queryClient],
  );

  const archivedSessions = useMemo(
    () => createWorkspaceArchivedSessionsPort(queryClient),
    [queryClient],
  );
  useEffect(() => registerStartupLiveSource(queryClient, liveSource), [queryClient, liveSource]);

  const observer = useMemo(
    () =>
      createWorkspaceActivityObserver({
        observe: liveSource.observeWorkspace,
        archivedSessions,
      }),
    [archivedSessions, liveSource],
  );

  // Merge detection events keep the merge status of each workspace current without polling.
  useEffect(() => observeTaskMergeStatusUpdates(queryClient), [queryClient]);

  // Saved chat events keep archived lists current without polling.
  useEffect(
    () =>
      observeWorkspaceSessionRecords(queryClient, (message) => {
        observer.setSessionRecordsError(message);
      }),
    [observer, queryClient],
  );

  useEffect(() => {
    retainStartupPreparationWorkspaces(
      queryClient,
      workspaces.map((workspace) => workspace.repoPath),
    );
    observer.syncWorkspaces(
      workspaces.map((workspace) => ({
        workspaceId: workspace.workspaceId,
        repoPath: workspace.repoPath,
      })),
    );
  }, [observer, workspaces, queryClient]);

  useEffect(() => () => observer.dispose(), [observer]);

  return createElement(
    WorkspaceActivityContext.Provider,
    { value: observer },
    createElement(WorkspaceSessionLiveSourceContext.Provider, { value: liveSource }, children),
  );
}
