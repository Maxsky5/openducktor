import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import {
  type PropsWithChildren,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { createAutopilotOutcomePresenter } from "@/features/autopilot/autopilot-outcome-presenter";
import { toAgentUserMessageParts } from "@/features/session-start/session-start-workflow";
import { CONNECTION_RECONNECTED_EVENT_KIND } from "@openducktor/frontend-core/recovery/connection-control-events";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useNotificationContext } from "@/state/notifications/notification-context";
import { useWorkspaceStateContext } from "../app-state-contexts";
import { useAgentOperationsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import {
  autopilotQueryKeys,
  autopilotStateQueryOptions,
} from "@openducktor/frontend-core/queries/autopilot";
import { taskWorktreeQueryKeys } from "@openducktor/frontend-core/queries/build-runtime";
import { invalidateTerminalList } from "@openducktor/frontend-core/queries/terminals";
import { useHostConnection } from "@openducktor/frontend-core/connection/client-connection-react";

/**
 * Shows the outcomes of host Autopilot from every workspace. The host detects task changes and
 * starts the actions, so this client only presents results and recovery controls.
 */
export function AutopilotProvider({ children }: PropsWithChildren): ReactElement {
  const queryClient = useQueryClient();
  const host = useHostConnection();
  const { activeWorkspace, workspaces, closedWorkspaces } = useWorkspaceStateContext();
  const { sendAgentMessage } = useAgentOperationsContext();
  const { sessionStartNotifications } = useNotificationContext();
  const sendAgentMessageRef = useRef(sendAgentMessage);
  const notificationsRef = useRef(sessionStartNotifications);
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  const activeWorkspaceIdRef = useRef(activeWorkspaceId);
  const openWorkspaceIds = useMemo(
    () => workspaces.map((workspace) => workspace.workspaceId),
    [workspaces],
  );
  const openWorkspaceIdsRef = useRef(openWorkspaceIds);
  // The workspaces that the host lists, open or closed.
  const listedWorkspaceIds = useMemo(
    () => new Set([...workspaces, ...closedWorkspaces].map((workspace) => workspace.workspaceId)),
    [closedWorkspaces, workspaces],
  );
  const listedWorkspaceIdsRef = useRef(listedWorkspaceIds);
  // The workspaces whose held outcomes this subscription read.
  const readWorkspaceIdsRef = useRef(new Set<string>());
  const [subscribed, setSubscribed] = useState(false);
  useEffect(() => {
    sendAgentMessageRef.current = sendAgentMessage;
    notificationsRef.current = sessionStartNotifications;
    activeWorkspaceIdRef.current = activeWorkspaceId;
    openWorkspaceIdsRef.current = openWorkspaceIds;
    listedWorkspaceIdsRef.current = listedWorkspaceIds;
  }, [
    activeWorkspaceId,
    listedWorkspaceIds,
    openWorkspaceIds,
    sendAgentMessage,
    sessionStartNotifications,
  ]);

  const presenter = useMemo(
    () =>
      createAutopilotOutcomePresenter({
        claimRecovery: (input) => host.client.autopilotRecoveryClaim(input),
        sendMessage: async (session, instruction) => {
          await sendAgentMessageRef.current(session, toAgentUserMessageParts(instruction), {
            preserveTextWhitespace: true,
          });
        },
        markInAppFeedbackHandled: (errorId) =>
          notificationsRef.current.markInAppFeedbackHandled(errorId),
        isWorkspaceSelected: (workspaceId) => activeWorkspaceIdRef.current === workspaceId,
        refreshTaskViews: (repoPath, taskId) =>
          refreshLaunchedTaskViews(queryClient, repoPath, taskId),
      }),
    [host, queryClient],
  );

  // The host keeps failed and skipped outcomes of each workspace, so a client that attaches,
  // reconnects after missed events, or selects a workspace shows the ones it missed. Each read
  // shows its outcomes when it completes, also when the selection changed meanwhile. The outcomes
  // of a workspace that left the workspace list during the read do not show.
  const readHeldOutcomes = useCallback(
    async (
      workspaceIds: readonly string[],
      { workspaceSelected }: { workspaceSelected: boolean },
    ): Promise<void> => {
      const reads = await Promise.allSettled(
        workspaceIds.map((workspaceId) =>
          queryClient.fetchQuery(autopilotStateQueryOptions(workspaceId)).then((state) => {
            if (listedWorkspaceIdsRef.current.has(workspaceId)) {
              for (const outcome of state.outcomes)
                presenter.present(outcome, { workspaceSelected });
            }
            presenter.presentFailure(state.failure);
          }),
        ),
      );
      const failed = reads.find((read) => read.status === "rejected");
      if (failed) throw failed.reason;
    },
    [presenter, queryClient],
  );

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    const readWorkspaceIds = readWorkspaceIdsRef.current;
    // An open settings modal reads the saved rules again at once, and other readers on next use.
    // A failed read shows in the Autopilot settings section.
    const reloadSavedRules = () => {
      void queryClient.invalidateQueries({ queryKey: autopilotQueryKeys.settings() });
    };
    host
      .subscribeRunEvents((payload) => {
        if ("__openducktorConnectionControl" in payload) {
          if (payload.kind !== CONNECTION_RECONNECTED_EVENT_KIND || !payload.missedEvents) return;
          // A missed settings event can leave old Autopilot rules in the cache.
          reloadSavedRules();
          return readHeldOutcomes(openWorkspaceIdsRef.current, { workspaceSelected: false }).catch(
            (cause: unknown) => {
              reportHeldOutcomeFailure(cause);
              throw cause;
            },
          );
        }
        // Another client can save the rules, so this client reads them again.
        if (payload.type === "autopilot_settings_saved") {
          reloadSavedRules();
          return;
        }
        // The shell parsed the payload with the run event contract.
        if (payload.type === "autopilot_outcome") presenter.present(payload.outcome);
        else presenter.presentFailure(payload.failure);
      })
      .then(
        (stop) => {
          if (disposed) {
            stop();
            return;
          }
          unsubscribe = stop;
          setSubscribed(true);
        },
        (cause: unknown) => {
          if (disposed) return;
          toast.error("Autopilot updates are unavailable.", {
            id: "autopilot-subscription",
            description: `${errorMessage(cause)} Reload the app to reconnect.`,
            duration: Infinity,
          });
        },
      );
    return () => {
      disposed = true;
      unsubscribe?.();
      readWorkspaceIds.clear();
      setSubscribed(false);
    };
  }, [host, presenter, queryClient, readHeldOutcomes]);

  useEffect(() => {
    if (!subscribed || !activeWorkspaceId) return;
    readWorkspaceIdsRef.current.add(activeWorkspaceId);
    void readHeldOutcomes([activeWorkspaceId], { workspaceSelected: true }).catch(
      reportHeldOutcomeFailure,
    );
  }, [activeWorkspaceId, readHeldOutcomes, subscribed]);

  // The selection effect reads the selected workspace.
  useEffect(() => {
    if (!subscribed) return;
    const readWorkspaceIds = readWorkspaceIdsRef.current;
    const unread = openWorkspaceIds.filter(
      (workspaceId) => workspaceId !== activeWorkspaceId && !readWorkspaceIds.has(workspaceId),
    );
    if (unread.length === 0) return;
    for (const workspaceId of unread) readWorkspaceIds.add(workspaceId);
    void readHeldOutcomes(unread, { workspaceSelected: false }).catch(reportHeldOutcomeFailure);
  }, [activeWorkspaceId, openWorkspaceIds, readHeldOutcomes, subscribed]);

  useEffect(() => {
    presenter.keepWorkspaces(listedWorkspaceIds);
  }, [listedWorkspaceIds, presenter]);

  return <>{children}</>;
}

// A failed launch can still create the task worktree and its terminals.
const refreshLaunchedTaskViews = async (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
): Promise<void> => {
  await Promise.all([
    invalidateTerminalList(queryClient, { kind: "task", repoPath, taskId }),
    queryClient.invalidateQueries({
      queryKey: taskWorktreeQueryKeys.taskWorktree({ repoPath, taskId }),
    }),
  ]);
};

const reportHeldOutcomeFailure = (cause: unknown): void => {
  toast.error("Autopilot outcomes could not load.", {
    id: "autopilot-read",
    description: `${errorMessage(cause)} Select the workspace again to retry.`,
  });
};
