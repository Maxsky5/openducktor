import { BUILTIN_ROLE_LABELS } from "@openducktor/workflows";
import type { NotificationNavigationTarget, WorkspaceRecord } from "@openducktor/contracts";
import {
  type PropsWithChildren,
  type ReactElement,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { toast } from "sonner";
import { buildSessionStartedOccurrence, buildSessionStartErrorOccurrence } from "@openducktor/core";
import {
  createCuelumeNotificationSoundAdapter,
  createSonnerNotificationAdapter,
  installCuelumeGestureUnlock,
} from "@/features/notifications/notification-delivery";
import { createNotificationRuntime } from "@openducktor/frontend-core/notifications/notification-runtime";
import type { NotificationDispatchFailure } from "@openducktor/frontend-core/notifications/notification-policy";
import {
  clearCoordinationNotificationFailure,
  clearOsNotificationFailure,
  clearSettingsNotificationFailure,
  clearSoundNotificationFailure,
  createNotificationFailureState,
  type NotificationFailureState,
  recordNotificationFailure,
  selectNotificationFailure,
} from "@openducktor/frontend-core/notifications/notification-failure-state";
import type {
  SessionStartNotificationInput,
  SessionStartNotificationPublisher,
} from "@openducktor/frontend-core/sessions/start/session-start-orchestration";
import { getShellBridge } from "@/lib/shell-bridge";
import { useWorkspaceStateContext } from "../app-state-contexts";
import {
  NotificationContext,
  type NotificationContextValue,
  type NotificationNavigator,
} from "../notifications/notification-context";
import { useHostConnection } from "@openducktor/frontend-core/connection/client-connection-react";

export function NotificationProvider({ children }: PropsWithChildren): ReactElement {
  const { workspaces } = useWorkspaceStateContext();
  const shellNotifications = getShellBridge().notifications;
  const host = useHostConnection();
  const [failureState, updateFailureState] = useReducer(
    reduceNotificationFailureState,
    undefined,
    createNotificationFailureState,
  );
  const workspacesRef = useRef(workspaces);
  const navigatorRef = useRef<NotificationNavigator>(unavailableNotificationNavigator);
  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  const runtime = useMemo(() => {
    const navigate: NotificationNavigator = (target) => navigatorRef.current(target);
    return createNotificationRuntime({
      bridge: shellNotifications,
      publishAction: host.client.notificationPublishAction,
      subscribeStream: host.subscribeNotificationStream,
      navigate,
      inApp: createSonnerNotificationAdapter({ navigate }),
      sound: createCuelumeNotificationSoundAdapter(),
      onObservationHealth: (health) => {
        const id = `notification-observation:${health.scope}:${health.source}`;
        if (health.message === null) {
          toast.dismiss(id);
          return;
        }
        toast.error("Notification observation failed", {
          id,
          description: `${health.scope}: ${health.message}`,
          action: { label: "Reload", onClick: () => window.location.reload() },
        });
      },
      onFailure: (failure) => {
        const osDenied = failure.channel === "os" && failure.osStatus === "denied";
        if (!osDenied) {
          console.error("Notification delivery failed.", {
            channel: failure.channel,
            kind: failure.kind,
            occurrenceId: failure.occurrenceId,
            repoPath: failure.repoPath,
          });
        }
        if (failure.channel === "in_app") {
          toast.error("In-app notification failed", {
            description: failure.message,
          });
        }
        if (
          failure.channel === "os" ||
          failure.channel === "coordination" ||
          failure.channel === "settings" ||
          failure.channel === "sound"
        ) {
          updateFailureState({ type: "reported", failure });
        }
      },
      onCoordinationRecovered: () => updateFailureState({ type: "coordination-recovered" }),
      onPermissionGranted: () => updateFailureState({ type: "os-permission-granted" }),
      onOsShown: () => updateFailureState({ type: "os-shown" }),
      onSettingsRecovered: () => updateFailureState({ type: "settings-recovered" }),
      onSoundPlayed: () => updateFailureState({ type: "sound-played" }),
    });
  }, [host, shellNotifications]);

  useEffect(() => runtime.subscribe(), [runtime]);

  useEffect(() => installCuelumeGestureUnlock(), []);

  const sessionStartNotifications = useMemo<SessionStartNotificationPublisher>(() => {
    const resolveWorkspace = (input: SessionStartNotificationInput) => {
      const workspace = workspacesRef.current.find(
        (candidate) => candidate.workspaceId === input.workspaceId,
      );
      if (!workspace) {
        throw new Error("The session start notification workspace is unavailable.");
      }
      return toNotificationWorkspace(workspace);
    };
    return {
      publishSessionStarted(input) {
        runtime.publish(
          buildSessionStartedOccurrence(resolveWorkspace(input), {
            ...input,
            roleLabel: BUILTIN_ROLE_LABELS[input.role],
          }),
        );
      },
      async publishSessionError(input, localErrorMessage) {
        return await runtime.publishAndWait(
          buildSessionStartErrorOccurrence(
            resolveWorkspace(input),
            { ...input, roleLabel: BUILTIN_ROLE_LABELS[input.role] },
            localErrorMessage,
          ),
          localErrorMessage,
          input.inAppFeedbackHandled,
        );
      },
      markInAppFeedbackHandled(errorId) {
        runtime.markInAppFeedbackHandled(errorId);
      },
      reportFailure(_cause, input) {
        console.error("Session start notification failed.", {
          launchAttemptId: input.launchAttemptId,
          taskId: input.taskId,
          workspaceId: input.workspaceId,
        });
      },
    };
  }, [runtime]);

  const value = useMemo<NotificationContextValue>(
    () => ({
      deliveryFailure: selectNotificationFailure(failureState),
      getCapability: runtime.getCapability,
      requestPermission: runtime.requestPermission,
      openSystemSettings: runtime.openSystemSettings,
      previewCue: runtime.previewCue,
      testInApp: runtime.testInApp,
      testOs: runtime.testOs,
      registerNavigator(navigator: (target: NotificationNavigationTarget) => Promise<void>) {
        navigatorRef.current = navigator;
        return () => {
          if (navigatorRef.current === navigator) {
            navigatorRef.current = unavailableNotificationNavigator;
          }
        };
      },
      sessionStartNotifications,
    }),
    [failureState, runtime, sessionStartNotifications],
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

const toNotificationWorkspace = (workspace: WorkspaceRecord) => ({
  repoPath: workspace.repoPath,
  repositoryLabel: workspace.workspaceName,
});

const unavailableNotificationNavigator: NotificationNavigator = async () => {
  toast.error("Notification target unavailable", {
    description: "OpenDucktor could not open this notification target.",
  });
};

type NotificationFailureAction =
  | { type: "reported"; failure: NotificationDispatchFailure }
  | { type: "os-shown" }
  | { type: "os-permission-granted" }
  | { type: "settings-recovered" }
  | { type: "sound-played" }
  | { type: "coordination-recovered" };

const reduceNotificationFailureState = (
  state: NotificationFailureState,
  action: NotificationFailureAction,
): NotificationFailureState => {
  if (action.type === "reported") {
    return recordNotificationFailure(state, action.failure);
  }
  if (action.type === "settings-recovered") return clearSettingsNotificationFailure(state);
  if (action.type === "sound-played") return clearSoundNotificationFailure(state);
  if (action.type === "os-permission-granted") {
    return state.os?.osStatus === "denied" ? clearOsNotificationFailure(state) : state;
  }
  if (action.type === "os-shown") {
    return clearOsNotificationFailure(state);
  }
  return clearCoordinationNotificationFailure(state);
};
