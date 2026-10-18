import { useQueryClient } from "@tanstack/react-query";
import { type PropsWithChildren, type ReactElement, useEffect, useMemo } from "react";
import { createWorkspaceActivityObserver } from "@openducktor/frontend-core/workspace-activity/workspace-activity-observer";
import { useHostConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { observeWorkspaceSessionRecords } from "@openducktor/frontend-core/queries/workspace-session-updates";
import { createAgentSessionListLiveSync } from "@openducktor/frontend-core/queries/agent-sessions";
import { createAgentTurnGitSync } from "@openducktor/frontend-core/queries/agent-turn-git-sync";
import { getSessionHistoryFreshnessTracker } from "@openducktor/frontend-core/queries/agent-session-history-freshness-tracker";
import { useWorkspaceStateContext } from "../app-state-contexts";
import { WorkspaceActivityContext } from "../workspace-activity/workspace-activity-context";
import { createWorkspaceArchivedSessionsPort } from "../workspace-activity/archived-sessions-port";
import {
  createWorkspaceSessionLiveSource,
  WorkspaceSessionLiveSourceContext,
} from "../workspace-activity/workspace-session-live-source";

/** Keeps one live stream per open workspace for activity and session readers. */
export function WorkspaceActivityProvider({ children }: PropsWithChildren): ReactElement {
  const queryClient = useQueryClient();
  const host = useHostConnection();
  const { workspaces } = useWorkspaceStateContext();
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

  const observer = useMemo(
    () =>
      createWorkspaceActivityObserver({
        observe: liveSource.observeWorkspace,
        archivedSessions,
      }),
    [archivedSessions, liveSource],
  );

  // Saved chat events keep archived lists current without polling.
  useEffect(
    () =>
      observeWorkspaceSessionRecords(queryClient, (message) => {
        observer.setSessionRecordsError(message);
      }),
    [observer, queryClient],
  );

  useEffect(() => {
    observer.syncWorkspaces(
      workspaces.map((workspace) => ({
        workspaceId: workspace.workspaceId,
        repoPath: workspace.repoPath,
      })),
    );
  }, [observer, workspaces]);

  useEffect(() => () => observer.dispose(), [observer]);

  return (
    <WorkspaceActivityContext.Provider value={observer}>
      <WorkspaceSessionLiveSourceContext.Provider value={liveSource}>
        {children}
      </WorkspaceSessionLiveSourceContext.Provider>
    </WorkspaceActivityContext.Provider>
  );
}
