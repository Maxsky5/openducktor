import { useQueryClient } from "@tanstack/react-query";
import { type PropsWithChildren, type ReactElement, useEffect, useMemo } from "react";
import { createWorkspaceActivityObserver } from "@/features/workspace-activity/workspace-activity-observer";
import { hostBridge } from "@/lib/host-client";
import { observeWorkspaceSessionRecords } from "@/state/queries/workspace-session-updates";
import { createAgentSessionListLiveSync } from "@/state/queries/agent-sessions";
import { createAgentTurnGitSync } from "@/state/queries/agent-turn-git-sync";
import { getSessionHistoryFreshnessTracker } from "@/state/queries/agent-session-history-freshness-tracker";
import { useWorkspaceStateContext } from "../app-state-contexts";
import { WorkspaceActivityContext } from "../workspace-activity/workspace-activity-context";
import { createWorkspaceArchivedSessionsPort } from "../workspace-activity/archived-sessions-port";

/**
 * Owns the live activity projection that feeds the workspace rail tiles.
 *
 * It is mounted inside the workspace state provider so it observes the same
 * workspace list the rail renders, and it does not depend on notifications.
 */
export function WorkspaceActivityProvider({ children }: PropsWithChildren): ReactElement {
  const queryClient = useQueryClient();
  const { workspaces } = useWorkspaceStateContext();

  const archivedSessions = useMemo(
    () => createWorkspaceArchivedSessionsPort(queryClient),
    [queryClient],
  );

  const observer = useMemo(
    () =>
      createWorkspaceActivityObserver({
        observe: async (input, listener) => {
          const syncLists = createAgentSessionListLiveSync(queryClient);
          const syncGit = createAgentTurnGitSync(queryClient);
          const historyObservation = getSessionHistoryFreshnessTracker(
            queryClient,
          ).observeWorkspace(input.repoPath);
          try {
            const stop = await hostBridge.observeAgentSessionLive(input, (envelope) => {
              historyObservation.recordEvent(envelope);
              syncLists(envelope);
              syncGit.observe(envelope);
              listener(envelope);
            });
            return () => {
              historyObservation.close();
              syncGit.dispose();
              stop();
            };
          } catch (cause) {
            historyObservation.close();
            syncGit.dispose();
            throw cause;
          }
        },
        archivedSessions,
      }),
    [archivedSessions, queryClient],
  );

  // The archived chat lists stay current from the ordered record stream, so no
  // tile has to poll or re-query on a timer.
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
      {children}
    </WorkspaceActivityContext.Provider>
  );
}
