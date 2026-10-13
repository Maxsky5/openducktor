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
import { BROWSER_LIVE_RECONNECTED_EVENT_KIND } from "@/lib/browser-live/constants";
import { errorMessage } from "@/lib/errors";
import { hostBridge } from "@/lib/host-client";
import { useNotificationContext } from "@/state/notifications/notification-context";
import { useAgentOperationsContext, useWorkspaceStateContext } from "../app-state-contexts";
import { host } from "../operations/shared/host";
import { autopilotQueryKeys, autopilotStateQueryOptions } from "../queries/autopilot";
import { taskWorktreeQueryKeys } from "../queries/build-runtime";
import { invalidateTerminalList } from "../queries/terminals";

/**
 * Shows the outcomes of host Autopilot from every workspace. The host detects task changes and
 * starts the actions, so this client only presents results and recovery controls.
 */
export function AutopilotProvider({ children }: PropsWithChildren): ReactElement {
  const queryClient = useQueryClient();
  const { activeWorkspace, workspaces, closedWorkspaces } = useWorkspaceStateContext();
  const { sendAgentMessage } = useAgentOperationsContext();
  const { sessionStartNotifications } = useNotificationContext();
  const sendAgentMessageRef = useRef(sendAgentMessage);
  const notificationsRef = useRef(sessionStartNotifications);
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  const activeWorkspaceIdRef = useRef(activeWorkspaceId);
  const [subscribed, setSubscribed] = useState(false);
  useEffect(() => {
    sendAgentMessageRef.current = sendAgentMessage;
    notificationsRef.current = sessionStartNotifications;
    activeWorkspaceIdRef.current = activeWorkspaceId;
  }, [activeWorkspaceId, sendAgentMessage, sessionStartNotifications]);

  const presenter = useMemo(
    () =>
      createAutopilotOutcomePresenter({
        claimRecovery: (input) => host.autopilotRecoveryClaim(input),
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
    [queryClient],
  );

  // The host keeps failed and skipped outcomes, so a client that attaches or selects a workspace
  // shows the ones it missed.
  const readHeldOutcomes = useCallback(
    (workspaceId: string, { workspaceSelected }: { workspaceSelected: boolean }) => {
      return queryClient.fetchQuery(autopilotStateQueryOptions(workspaceId)).then((state) => {
        if (activeWorkspaceIdRef.current !== workspaceId) return;
        for (const outcome of state.outcomes) presenter.present(outcome, { workspaceSelected });
        presenter.presentFailure(state.failure);
      });
    },
    [presenter, queryClient],
  );

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    // An open settings modal reads the saved rules again at once, and other readers on next use.
    // A failed read shows in the Autopilot settings section.
    const reloadSavedRules = () => {
      void queryClient.invalidateQueries({ queryKey: autopilotQueryKeys.settings() });
    };
    hostBridge
      .subscribeRunEvents((payload) => {
        if ("__openducktorBrowserLive" in payload) {
          const workspaceId = activeWorkspaceIdRef.current;
          if (payload.kind !== BROWSER_LIVE_RECONNECTED_EVENT_KIND || !payload.missedEvents) return;
          // A missed settings event can leave old Autopilot rules in the cache.
          reloadSavedRules();
          if (workspaceId) {
            return readHeldOutcomes(workspaceId, { workspaceSelected: false }).catch(
              (cause: unknown) => {
                reportHeldOutcomeFailure(cause);
                throw cause;
              },
            );
          }
          return;
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
      setSubscribed(false);
    };
  }, [presenter, queryClient, readHeldOutcomes]);

  useEffect(() => {
    if (subscribed && activeWorkspaceId)
      void readHeldOutcomes(activeWorkspaceId, { workspaceSelected: true }).catch(
        reportHeldOutcomeFailure,
      );
  }, [activeWorkspaceId, readHeldOutcomes, subscribed]);

  useEffect(() => {
    presenter.keepWorkspaces(
      new Set([...workspaces, ...closedWorkspaces].map((workspace) => workspace.workspaceId)),
    );
  }, [closedWorkspaces, presenter, workspaces]);

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
