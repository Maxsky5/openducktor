import { useQueryClient } from "@tanstack/react-query";
import { type PropsWithChildren, type ReactElement, useEffect, useMemo } from "react";
import { createWorkspaceActivityObserver } from "@/features/workspace-activity/workspace-activity-observer";
import { hostBridge, hostClient } from "@/lib/host-client";
import { observeWorkspaceSessionRecords } from "@/state/queries/workspace-session-updates";
import { createAgentSessionListLiveSync } from "@/state/queries/agent-sessions";
import { createAgentTurnGitSync } from "@/state/queries/agent-turn-git-sync";
import { getSessionHistoryFreshnessTracker } from "@/state/queries/agent-session-history-freshness-tracker";
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
            const stop = await hostBridge.observeAgentSessionLive(input, (envelope) => {
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
        (input) => hostClient.agentSessionLiveAttach(input),
      ),
    [queryClient],
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
