import type { WorkspaceSession } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { type PropsWithChildren, type ReactElement, useEffect, useMemo } from "react";
import {
  createWorkspaceActivityObserver,
  type WorkspaceActivityArchivedSessionsPort,
} from "@/features/workspace-activity/workspace-activity-observer";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { errorMessage } from "@/lib/errors";
import { hostBridge } from "@/lib/host-client";
import { workspaceSessionIdentity } from "@/state/operations/agent-orchestrator/session-read-model/workspace-session-records";
import { observeWorkspaceSessionRecords } from "@/state/queries/workspace-session-updates";
import {
  workspaceSessionListQueryOptions,
  workspaceSessionQueryKeys,
} from "@/state/queries/workspace-sessions";
import { useWorkspaceStateContext } from "../app-state-contexts";
import { WorkspaceActivityContext } from "../workspace-activity/workspace-activity-context";

const archivedSessionKeysByRecords = new WeakMap<
  readonly WorkspaceSession[],
  ReadonlySet<string>
>();

const toArchivedSessionKeys = (records: readonly WorkspaceSession[]): ReadonlySet<string> => {
  const cached = archivedSessionKeysByRecords.get(records);
  if (cached) {
    return cached;
  }
  const keys = new Set<string>();
  for (const record of records) {
    const identity = workspaceSessionIdentity(record);
    if (identity) {
      keys.add(agentSessionIdentityKey(identity));
    }
  }
  archivedSessionKeysByRecords.set(records, keys);
  return keys;
};

/**
 * Owns the live activity projection that feeds the workspace rail tiles.
 *
 * It is mounted inside the workspace state provider so it observes the same
 * workspace list the rail renders, and it does not depend on notifications.
 */
export function WorkspaceActivityProvider({ children }: PropsWithChildren): ReactElement {
  const queryClient = useQueryClient();
  const { workspaces } = useWorkspaceStateContext();

  const archivedSessions = useMemo<WorkspaceActivityArchivedSessionsPort>(
    () => ({
      load: async (workspaceId) => {
        await queryClient.fetchQuery({
          ...workspaceSessionListQueryOptions(workspaceId, true),
          staleTime: Number.POSITIVE_INFINITY,
        });
      },
      read: (workspaceId) => {
        const state = queryClient.getQueryState<WorkspaceSession[]>(
          workspaceSessionQueryKeys.list(workspaceId, true),
        );
        if (state?.data) {
          return { status: "ready", keys: toArchivedSessionKeys(state.data) };
        }
        if (state?.status === "error") {
          return { status: "error", reason: errorMessage(state.error) };
        }
        return { status: "unknown" };
      },
      subscribe: (onChange) =>
        queryClient.getQueryCache().subscribe((event) => {
          if (event.type !== "updated") {
            return;
          }
          if (event.action.type !== "success" && event.action.type !== "error") {
            return;
          }
          if (event.query.queryKey[0] === workspaceSessionQueryKeys.all[0]) {
            onChange();
          }
        }),
    }),
    [queryClient],
  );

  const observer = useMemo(
    () =>
      createWorkspaceActivityObserver({
        observe: hostBridge.observeAgentSessionLive,
        archivedSessions,
      }),
    [archivedSessions],
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
