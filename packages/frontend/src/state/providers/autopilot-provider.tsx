import type { TaskCard } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type PropsWithChildren, type ReactElement, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { executeAutopilotAction } from "@/features/autopilot/autopilot-actions";
import { getAutopilotRule } from "@/features/autopilot/autopilot-catalog";
import {
  detectAutopilotEvents,
  shouldAdvanceAutopilotBaseline,
  toTaskMap,
} from "@/features/autopilot/autopilot-events";
import { isSessionStartFailureFeedbackHandled } from "@/features/session-start/session-start-orchestration";
import { useNotificationContext } from "@/state/notifications/notification-context";
import { errorMessage } from "@/lib/errors";
import { useTaskSnapshotContext, useWorkspaceStateContext } from "../app-state-contexts";
import { settingsSnapshotQueryOptions } from "../queries/workspace";
import { host } from "../operations/shared/host";
import { withWorktreeRefresh } from "@/features/session-start/with-worktree-refresh";

export function AutopilotProvider({ children }: PropsWithChildren): ReactElement {
  const queryClient = useQueryClient();
  const client = useMemo(
    () => ({
      agentSessionWorkflowLaunch: withWorktreeRefresh(queryClient, host.agentSessionWorkflowLaunch),
    }),
    [queryClient],
  );
  const { sessionStartNotifications } = useNotificationContext();
  const { activeWorkspace } = useWorkspaceStateContext();
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const { tasks } = useTaskSnapshotContext();
  const settingsSnapshotQuery = useQuery(settingsSnapshotQueryOptions());
  const previousRepoRef = useRef<string | null>(null);
  const previousTasksByIdRef = useRef(new Map<string, TaskCard>());

  useEffect(() => {
    if (!workspaceRepoPath || !activeWorkspace) {
      previousRepoRef.current = null;
      previousTasksByIdRef.current = new Map();
      return;
    }

    const nextTasksById = toTaskMap(tasks);
    if (previousRepoRef.current !== workspaceRepoPath) {
      previousRepoRef.current = workspaceRepoPath;
      previousTasksByIdRef.current = nextTasksById;
      return;
    }

    const observedEvents = detectAutopilotEvents(previousTasksByIdRef.current, tasks);
    const autopilotSettings = settingsSnapshotQuery.data?.autopilot;
    if (
      shouldAdvanceAutopilotBaseline({
        observedEvents,
        hasAutopilotSettings: Boolean(autopilotSettings),
      })
    ) {
      previousTasksByIdRef.current = nextTasksById;
    }
    if (!autopilotSettings) {
      return;
    }

    void Promise.all(
      observedEvents.map(async (observedEvent) => {
        const rule = getAutopilotRule(autopilotSettings, observedEvent.eventId);
        await Promise.all(
          rule.actionIds.map(async (actionId) => {
            try {
              const outcome = await executeAutopilotAction({
                activeWorkspace,
                task: observedEvent.task,
                actionId,
                client,
                notifications: sessionStartNotifications,
              });

              if (outcome.kind === "skipped") {
                toast.info(`Autopilot skipped ${observedEvent.task.id}.`, {
                  description: outcome.message,
                });
              } else if (
                outcome.postStartActionError &&
                !isSessionStartFailureFeedbackHandled(outcome.postStartActionError)
              ) {
                toast.error(`Autopilot message failed for ${observedEvent.task.id}.`, {
                  description: outcome.postStartActionError.message,
                });
              }
            } catch (error) {
              if (!isSessionStartFailureFeedbackHandled(error)) {
                toast.error(`Autopilot failed for ${observedEvent.task.id}.`, {
                  description: errorMessage(error),
                });
              }
            }
          }),
        );
      }),
    );
  }, [
    client,
    workspaceRepoPath,
    activeWorkspace,
    sessionStartNotifications,
    settingsSnapshotQuery.data?.autopilot,
    tasks,
  ]);

  return <>{children}</>;
}
