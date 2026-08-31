import type { TaskCard } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type PropsWithChildren, type ReactElement, useEffect, useRef } from "react";
import { toast } from "sonner";
import { executeAutopilotAction } from "@/features/autopilot/autopilot-actions";
import { getAutopilotRule } from "@/features/autopilot/autopilot-catalog";
import {
  detectAutopilotEvents,
  shouldAdvanceAutopilotBaseline,
  toTaskMap,
} from "@/features/autopilot/autopilot-events";
import {
  isSessionStartFailureFeedbackHandled,
  useSessionStartWorkflowRunner,
} from "@/features/session-start";
import { errorMessage } from "@/lib/errors";
import {
  useAgentOperationsContext,
  useRuntimeDefinitionsContext,
  useTaskSnapshotContext,
  useWorkspaceStateContext,
} from "../app-state-contexts";
import { loadTaskWorktree } from "../operations/agent-orchestrator/runtime/runtime";
import { loadAgentSessionListFromQuery } from "../queries/agent-sessions";
import { settingsSnapshotQueryOptions } from "../queries/workspace";

export function AutopilotProvider({ children }: PropsWithChildren): ReactElement {
  const queryClient = useQueryClient();
  const { activeWorkspace } = useWorkspaceStateContext();
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const { tasks } = useTaskSnapshotContext();
  const { loadRepoRuntimeCatalog } = useRuntimeDefinitionsContext();
  const { startAgentSession, sendAgentMessage } = useAgentOperationsContext();
  const runSessionStartWorkflow = useSessionStartWorkflowRunner({
    workspaceId: activeWorkspace?.workspaceId ?? null,
    startAgentSession,
    sendAgentMessage,
  });
  const settingsSnapshotQuery = useQuery(settingsSnapshotQueryOptions());
  const previousRepoRef = useRef<string | null>(null);
  const previousTasksByIdRef = useRef<Map<string, TaskCard> | null>(null);

  if (previousTasksByIdRef.current === null) {
    previousTasksByIdRef.current = new Map();
  }

  useEffect(() => {
    if (!workspaceRepoPath || !activeWorkspace) {
      previousRepoRef.current = null;
      previousTasksByIdRef.current = new Map();
      return;
    }

    const nextTasksById = toTaskMap(tasks);
    if (previousTasksByIdRef.current === null) {
      throw new Error("Autopilot task baseline ref was not initialized.");
    }
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
                alwaysStartQaReviewsFresh: autopilotSettings.alwaysStartQaReviewsFresh,
                queryClient,
                loadTaskSessionRecords: (repoPath, taskId) =>
                  loadAgentSessionListFromQuery(queryClient, repoPath, taskId, {
                    forceFresh: true,
                  }),
                loadRepoRuntimeCatalog,
                resolveTaskWorktree: loadTaskWorktree,
                runSessionStartWorkflow,
              });

              if (outcome.kind === "skipped") {
                toast.info(`Autopilot skipped ${observedEvent.task.id}.`, {
                  description: outcome.message,
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
    workspaceRepoPath,
    activeWorkspace,
    loadRepoRuntimeCatalog,
    queryClient,
    runSessionStartWorkflow,
    settingsSnapshotQuery.data?.autopilot,
    tasks,
  ]);

  return <>{children}</>;
}
