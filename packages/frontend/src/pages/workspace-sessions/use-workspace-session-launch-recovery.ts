import {
  workspaceSessionLaunchSnapshotSchema,
  type WorkspaceSessionLaunchSnapshot,
} from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent } from "react";
import { toast } from "sonner";
import { observeSessionLaunches } from "@/features/session-start/session-launch-observation";
import { hostBridge } from "@/lib/host-client";
import { errorMessage } from "@/lib/errors";
import { workspaceSessionLaunchQueryOptions } from "@/state/queries/workspace-session-launches";
import type { ActiveWorkspace } from "@/types/state-slices";
import { updateSessionLaunchDraft } from "@/features/session-start/session-launch-draft-recovery";

/** Read retained failures on reopen and reconnect without replaying the first send. */
export function useWorkspaceSessionLaunchRecovery(
  workspace: ActiveWorkspace,
  sessionId: string,
  title: string,
) {
  const queryClient = useQueryClient();
  const present = useEffectEvent((snapshot: WorkspaceSessionLaunchSnapshot) =>
    presentWorkspaceSessionLaunch(snapshot, title),
  );
  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    const onError = (cause: unknown) => {
      if (!disposed)
        toast.error("Cannot observe chat starts.", { description: errorMessage(cause) });
    };
    void observeSessionLaunches({
      workspaceId: workspace.workspaceId,
      repoPath: workspace.repoPath,
      ownerIds: [sessionId],
      bridge: hostBridge,
      owner: (snapshot: WorkspaceSessionLaunchSnapshot) => snapshot.sessionId,
      eventType: "workspace_session_launch_updated",
      schema: workspaceSessionLaunchSnapshotSchema,
      readOwner: async (sessionId, refresh) => {
        const query = workspaceSessionLaunchQueryOptions({
          workspaceId: workspace.workspaceId,
          repoPath: workspace.repoPath,
          sessionId,
        });
        if (refresh) await queryClient.cancelQueries({ queryKey: query.queryKey, exact: true });
        return queryClient.fetchQuery(query);
      },
      onSnapshot: (snapshot) => {
        if (!disposed) present(snapshot);
      },
      onError,
    })
      .then((stop) => {
        if (disposed) stop();
        else unsubscribe = stop;
      })
      .catch(onError);
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [workspace.workspaceId, workspace.repoPath, sessionId, queryClient]);
}

export const presentWorkspaceSessionLaunch = (
  snapshot: WorkspaceSessionLaunchSnapshot,
  title: string,
): void => {
  updateSessionLaunchDraft(snapshot);
  const id = JSON.stringify([
    "workspace-session-launch",
    snapshot.workspaceId,
    snapshot.repoPath,
    snapshot.sessionId,
    snapshot.launchAttemptId,
  ]);
  if (snapshot.phase !== "failed") {
    toast.dismiss(id);
    return;
  }
  toast.error(`Could not send to "${title}"`, {
    id,
    duration: Infinity,
    description: [
      snapshot.failure?.message ?? "Chat start failed.",
      ...(snapshot.failure?.cleanupErrors ?? []),
      ...(snapshot.acceptance === "unknown"
        ? ["Inspect the saved session before sending another instruction."]
        : []),
    ].join(" "),
    action: snapshot.recoveryAllowed
      ? {
          label: "Retry message",
          onClick: () => {
            const { launchAttemptId, workspaceId, repoPath, sessionId } = snapshot;
            void hostBridge.client
              .workspaceSessionLaunchRecover({ launchAttemptId, workspaceId, repoPath, sessionId })
              .then((outcome) => presentWorkspaceSessionLaunch(outcome, title))
              .catch((cause) =>
                toast.error("First message recovery failed.", {
                  id,
                  description: errorMessage(cause),
                  action: undefined,
                }),
              );
          },
        }
      : undefined,
  });
};
