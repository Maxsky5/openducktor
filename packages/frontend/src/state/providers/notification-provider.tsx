import type { NotificationNavigationTarget, WorkspaceRecord } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import {
  type PropsWithChildren,
  type ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  buildSessionStartedOccurrence,
  buildSessionStartErrorOccurrence,
  createNotificationRuntime,
  createNotificationTaskObserver,
  createNotificationWorkspaceObserver,
  installCuelumeGestureUnlock,
  type NotificationDispatchFailure,
  type NotificationProducerFailure,
} from "@/features/notifications";
import type {
  SessionStartNotificationInput,
  SessionStartNotificationPublisher,
} from "@/features/session-start";
import { hostBridge } from "@/lib/host-client";
import { getShellBridge } from "@/lib/shell-bridge";
import { unfilteredRepoTaskDataQueryOptions } from "@/state/queries/tasks";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { useWorkspaceStateContext } from "../app-state-contexts";
import {
  NotificationContext,
  type NotificationContextValue,
  type NotificationNavigator,
} from "../notifications/notification-context";

const toNotificationWorkspace = (workspace: WorkspaceRecord) => ({
  repoPath: workspace.repoPath,
  repositoryLabel: workspace.workspaceName,
});

const reportProducerFailure = (failure: NotificationProducerFailure): void => {
  console.error("Notification producer failed.", {
    repoPath: failure.repoPath,
    source: failure.source,
  });
};

export function NotificationProvider({ children }: PropsWithChildren): ReactElement {
  const queryClient = useQueryClient();
  const { workspaces } = useWorkspaceStateContext();
  const shellNotifications = getShellBridge().notifications;
  const [osFailure, setOsFailure] = useState<NotificationDispatchFailure | null>(null);
  const workspacesRef = useRef(workspaces);
  const navigatorRef = useRef<NotificationNavigator>(async () => {
    toast.error("Notification target unavailable", {
      description: "OpenDucktor could not open this notification target.",
    });
  });
  workspacesRef.current = workspaces;

  const runtime = useMemo(
    () =>
      createNotificationRuntime({
        bridge: shellNotifications,
        loadSettings: async () => {
          const options = settingsSnapshotQueryOptions();
          const snapshot = await queryClient.fetchQuery({ ...options, staleTime: 0 });
          return snapshot.notifications;
        },
        navigate: (target) => navigatorRef.current(target),
        onFailure: (failure) => {
          console.error("Notification delivery failed.", {
            channel: failure.channel,
            kind: failure.kind,
            occurrenceId: failure.occurrenceId,
            repoPath: failure.repoPath,
          });
          if (failure.channel === "os") {
            setOsFailure(failure);
          }
        },
        onOsShown: () => setOsFailure(null),
      }),
    [queryClient, shellNotifications],
  );

  const taskObserver = useMemo(
    () =>
      createNotificationTaskObserver({
        loadTasks: async (repoPath) => {
          const options = unfilteredRepoTaskDataQueryOptions(repoPath);
          return (await queryClient.fetchQuery({ ...options, staleTime: 0 })).tasks;
        },
        publish: runtime.publish,
        onFailure: reportProducerFailure,
      }),
    [queryClient, runtime.publish],
  );

  const workspaceObserver = useMemo(
    () =>
      createNotificationWorkspaceObserver({
        observe: hostBridge.observeAgentSessionLive,
        taskObserver,
        publish: runtime.publish,
        onFailure: reportProducerFailure,
      }),
    [runtime.publish, taskObserver],
  );

  useEffect(() => runtime.subscribe(), [runtime]);

  useEffect(() => installCuelumeGestureUnlock(), []);

  useEffect(() => {
    void workspaceObserver.syncWorkspaces(workspaces.map(toNotificationWorkspace));
  }, [workspaces, workspaceObserver]);

  useEffect(() => () => workspaceObserver.dispose(), [workspaceObserver]);

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
        runtime.publish(buildSessionStartedOccurrence(resolveWorkspace(input), input));
      },
      publishSessionError(input) {
        runtime.publish(buildSessionStartErrorOccurrence(resolveWorkspace(input), input));
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
      osFailure,
      getCapability: runtime.getCapability,
      previewCue: runtime.previewCue,
      testInApp: runtime.testInApp,
      testOs: runtime.testOs,
      registerNavigator(navigator: (target: NotificationNavigationTarget) => Promise<void>) {
        navigatorRef.current = navigator;
        return () => {
          if (navigatorRef.current === navigator) {
            navigatorRef.current = async () => {
              toast.error("Notification target unavailable", {
                description: "OpenDucktor could not open this notification target.",
              });
            };
          }
        };
      },
      sessionStartNotifications,
      taskStreamSink: taskObserver.sink,
    }),
    [osFailure, runtime, sessionStartNotifications, taskObserver.sink],
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}
