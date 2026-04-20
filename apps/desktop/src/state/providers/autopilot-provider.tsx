import type {
  AgentSessionRecord,
  AutopilotActionId,
  AutopilotEventId,
  TaskCard,
} from "@openducktor/contracts";
import { AUTOPILOT_EVENT_IDS } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection, AgentRole } from "@openducktor/core";
import { getAgentScenarioDefinition } from "@openducktor/core";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { type PropsWithChildren, type ReactElement, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  AUTOPILOT_ACTION_DEFINITIONS,
  getAutopilotRule,
} from "@/features/autopilot/autopilot-catalog";
import {
  coerceVisibleSelectionToCatalog,
  pickDefaultVisibleSelectionForCatalog,
  roleDefaultSelectionFor,
} from "@/features/session-start/session-start-selection";
import { startSessionWorkflow } from "@/features/session-start/session-start-workflow";
import { errorMessage } from "@/lib/errors";
import { isQaRejectedTask } from "@/lib/task-qa";
import { useWorkspaceState } from "@/state";
import { AGENT_ROLE_LABELS } from "@/types";
import type { ActiveWorkspace, AgentStateContextValue } from "@/types/state-slices";
import {
  useAgentOperationsContext,
  useRuntimeDefinitionsContext,
  useTaskDataContext,
} from "../app-state-contexts";
import { MISSING_BUILD_TARGET_ERROR } from "../operations/agent-orchestrator/handlers/start-session-constants";
import { loadTaskWorktree } from "../operations/agent-orchestrator/runtime/runtime";
import { normalizeWorkingDirectory } from "../operations/agent-orchestrator/support/core";
import {
  loadRepoConfigFromQuery,
  settingsSnapshotQueryOptions,
  toRepoSettingsInput,
} from "../queries/workspace";

type AutopilotObservedEvent = {
  eventId: AutopilotEventId;
  task: TaskCard;
};

type AutopilotActionOutcome = {
  kind: "started" | "skipped";
  message: string;
};

type ExecuteAutopilotActionArgs = {
  activeWorkspace: ActiveWorkspace;
  task: TaskCard;
  actionId: AutopilotActionId;
  queryClient: QueryClient;
  loadRepoRuntimeCatalog: (repoPath: string, runtimeKind: string) => Promise<AgentModelCatalog>;
  resolveTaskWorktree: (
    repoPath: string,
    taskId: string,
  ) => Promise<{
    workingDirectory: string;
  } | null>;
  startSessionWorkflow: StartSessionWorkflowFn;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
};

type StartSessionWorkflowFn = typeof startSessionWorkflow;

type ResolvedAutopilotStart = {
  startMode: "fresh" | "reuse" | "fork";
  sourceSessionId?: string | null;
  targetWorkingDirectory?: string | null;
  preferredSelection?: AgentModelSelection | null;
};

const ROLE_LABELS = AGENT_ROLE_LABELS as Record<AgentRole, string>;

const toTaskMap = (tasks: TaskCard[]): Map<string, TaskCard> => {
  return new Map(tasks.map((task) => [task.id, task]));
};

const detectTaskEvent = (
  previousTask: TaskCard | undefined,
  currentTask: TaskCard,
  eventId: AutopilotEventId,
): boolean => {
  if (!previousTask) {
    return false;
  }

  switch (eventId) {
    case "taskProgressedToSpecReady":
      return previousTask.status !== "spec_ready" && currentTask.status === "spec_ready";
    case "taskProgressedToReadyForDev":
      return previousTask.status !== "ready_for_dev" && currentTask.status === "ready_for_dev";
    case "taskProgressedToAiReview":
      return previousTask.status !== "ai_review" && currentTask.status === "ai_review";
    case "taskRejectedByQa":
      return !isQaRejectedTask(previousTask) && isQaRejectedTask(currentTask);
    case "taskProgressedToHumanReview":
      return previousTask.status !== "human_review" && currentTask.status === "human_review";
  }
};

export const detectAutopilotEvents = (
  previousTasksById: Map<string, TaskCard>,
  tasks: TaskCard[],
): AutopilotObservedEvent[] => {
  const observedEvents: AutopilotObservedEvent[] = [];

  for (const task of tasks) {
    for (const eventId of AUTOPILOT_EVENT_IDS) {
      if (detectTaskEvent(previousTasksById.get(task.id), task, eventId)) {
        observedEvents.push({ eventId, task });
      }
    }
  }

  return observedEvents;
};

export const shouldAdvanceAutopilotBaseline = (params: {
  observedEvents: AutopilotObservedEvent[];
  hasAutopilotSettings: boolean;
}): boolean => {
  return params.hasAutopilotSettings || params.observedEvents.length === 0;
};

const findLatestSessionRecordByRole = (
  task: TaskCard,
  role: AgentRole,
): AgentSessionRecord | null => {
  const matchingSessions = (task.agentSessions ?? [])
    .filter((session) => session.role === role)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  return matchingSessions[0] ?? null;
};

const toAgentModelSelection = (
  selection: AgentSessionRecord["selectedModel"],
): AgentModelSelection | null => {
  if (!selection) {
    return null;
  }

  return {
    runtimeKind: selection.runtimeKind,
    providerId: selection.providerId,
    modelId: selection.modelId,
    ...(selection.variant ? { variant: selection.variant } : {}),
    ...(selection.profileId ? { profileId: selection.profileId } : {}),
  };
};

const resolveAutopilotSelection = async ({
  activeWorkspace,
  role,
  preferredSelection,
  queryClient,
  loadRepoRuntimeCatalog,
}: {
  activeWorkspace: ActiveWorkspace;
  role: AgentRole;
  preferredSelection?: AgentModelSelection | null;
  queryClient: QueryClient;
  loadRepoRuntimeCatalog: (repoPath: string, runtimeKind: string) => Promise<AgentModelCatalog>;
}): Promise<AgentModelSelection> => {
  if (preferredSelection) {
    return preferredSelection;
  }

  const repoConfig = await loadRepoConfigFromQuery(queryClient, activeWorkspace.workspaceId);
  const repoSettings = toRepoSettingsInput(repoConfig);
  const savedDefaultSelection = roleDefaultSelectionFor(repoSettings, role);
  const runtimeKind = savedDefaultSelection?.runtimeKind ?? repoSettings.defaultRuntimeKind;
  const catalog = await loadRepoRuntimeCatalog(activeWorkspace.repoPath, runtimeKind);

  if (savedDefaultSelection) {
    const validatedSelection = coerceVisibleSelectionToCatalog(catalog, savedDefaultSelection);
    if (!validatedSelection) {
      throw new Error(
        `Saved default ${ROLE_LABELS[role]} model is not available for runtime ${runtimeKind}.`,
      );
    }

    return validatedSelection;
  }

  const catalogDefaultSelection = pickDefaultVisibleSelectionForCatalog(catalog);
  if (!catalogDefaultSelection) {
    throw new Error(
      `No default ${ROLE_LABELS[role]} model is available for runtime ${runtimeKind}.`,
    );
  }

  return catalogDefaultSelection;
};

const isSkippableAutopilotError = (actionId: AutopilotActionId, error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    actionId !== "startGeneratePullRequest" && error.message.includes(MISSING_BUILD_TARGET_ERROR)
  );
};

const resolveAutopilotStart = async ({
  activeWorkspace,
  task,
  actionId,
  resolveTaskWorktree,
}: Pick<ExecuteAutopilotActionArgs, "activeWorkspace" | "task" | "resolveTaskWorktree"> & {
  actionId: AutopilotActionId;
}): Promise<ResolvedAutopilotStart> => {
  const action = AUTOPILOT_ACTION_DEFINITIONS[actionId];
  const latestRoleSession = findLatestSessionRecordByRole(task, action.role);

  if (actionId === "startGeneratePullRequest") {
    return {
      startMode: "fork",
      sourceSessionId: latestRoleSession?.sessionId ?? null,
      preferredSelection: toAgentModelSelection(latestRoleSession?.selectedModel ?? null),
    };
  }

  const { allowedStartModes } = getAgentScenarioDefinition(action.scenario);
  if (!allowedStartModes.includes("reuse")) {
    return {
      startMode: "fresh",
    };
  }

  const continuationTarget = await resolveTaskWorktree(activeWorkspace.repoPath, task.id);
  if (!continuationTarget) {
    throw new Error(MISSING_BUILD_TARGET_ERROR);
  }

  if (
    latestRoleSession &&
    normalizeWorkingDirectory(latestRoleSession.workingDirectory) ===
      normalizeWorkingDirectory(continuationTarget.workingDirectory)
  ) {
    return {
      startMode: "reuse",
      sourceSessionId: latestRoleSession.sessionId,
      targetWorkingDirectory: continuationTarget.workingDirectory,
    };
  }

  return {
    startMode: "fresh",
    targetWorkingDirectory: continuationTarget.workingDirectory,
  };
};

export const executeAutopilotAction = async ({
  activeWorkspace,
  task,
  actionId,
  queryClient,
  loadRepoRuntimeCatalog,
  resolveTaskWorktree,
  startSessionWorkflow,
  startAgentSession,
  sendAgentMessage,
}: ExecuteAutopilotActionArgs): Promise<AutopilotActionOutcome> => {
  const action = AUTOPILOT_ACTION_DEFINITIONS[actionId];
  const latestRoleSession = findLatestSessionRecordByRole(task, action.role);

  if (actionId === "startGeneratePullRequest" && !latestRoleSession) {
    return {
      kind: "skipped",
      message: `No Builder session is available to fork for task "${task.id}".`,
    };
  }

  try {
    const resolvedStart = await resolveAutopilotStart({
      activeWorkspace,
      task,
      actionId,
      resolveTaskWorktree,
    });

    await startSessionWorkflow({
      activeWorkspace,
      queryClient,
      intent: {
        taskId: task.id,
        role: action.role,
        scenario: action.scenario,
        startMode: resolvedStart.startMode,
        ...(resolvedStart.sourceSessionId
          ? { sourceSessionId: resolvedStart.sourceSessionId }
          : {}),
        ...(resolvedStart.targetWorkingDirectory !== undefined
          ? { targetWorkingDirectory: resolvedStart.targetWorkingDirectory }
          : {}),
        postStartAction: "kickoff",
      },
      selection:
        resolvedStart.startMode === "reuse"
          ? null
          : await resolveAutopilotSelection({
              activeWorkspace,
              role: action.role,
              ...(resolvedStart.preferredSelection !== undefined
                ? { preferredSelection: resolvedStart.preferredSelection }
                : {}),
              queryClient,
              loadRepoRuntimeCatalog,
            }),
      task,
      startAgentSession,
      sendAgentMessage,
      postStartExecution: "detached",
      onDetachedPostStartError: (error) => {
        toast.error(`Autopilot started ${action.label} for ${task.id}, but kickoff failed.`, {
          description: error.message,
        });
      },
    });

    return {
      kind: "started",
      message: `Started ${action.label} for ${task.id}.`,
    };
  } catch (error) {
    if (isSkippableAutopilotError(actionId, error)) {
      return {
        kind: "skipped",
        message: errorMessage(error),
      };
    }
    throw error;
  }
};

export function AutopilotProvider({ children }: PropsWithChildren): ReactElement {
  const queryClient = useQueryClient();
  const { activeWorkspace } = useWorkspaceState();
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const { tasks } = useTaskDataContext();
  const { loadRepoRuntimeCatalog } = useRuntimeDefinitionsContext();
  const { startAgentSession, sendAgentMessage } = useAgentOperationsContext();
  const settingsSnapshotQuery = useQuery(settingsSnapshotQueryOptions());
  const previousRepoRef = useRef<string | null>(null);
  const previousTasksByIdRef = useRef<Map<string, TaskCard>>(new Map());

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

    void (async () => {
      for (const observedEvent of observedEvents) {
        const rule = getAutopilotRule(autopilotSettings, observedEvent.eventId);
        for (const actionId of rule.actionIds) {
          try {
            const outcome = await executeAutopilotAction({
              activeWorkspace,
              task: observedEvent.task,
              actionId,
              queryClient,
              loadRepoRuntimeCatalog,
              resolveTaskWorktree: loadTaskWorktree,
              startSessionWorkflow,
              startAgentSession,
              sendAgentMessage,
            });

            if (outcome.kind === "started") {
              toast.success(`Autopilot: ${outcome.message}`);
            } else {
              toast.info(`Autopilot skipped ${observedEvent.task.id}.`, {
                description: outcome.message,
              });
            }
          } catch (error) {
            toast.error(`Autopilot failed for ${observedEvent.task.id}.`, {
              description: errorMessage(error),
            });
          }
        }
      }
    })();
  }, [
    workspaceRepoPath,
    activeWorkspace,
    loadRepoRuntimeCatalog,
    queryClient,
    sendAgentMessage,
    startAgentSession,
    settingsSnapshotQuery.data?.autopilot,
    tasks,
  ]);

  return <>{children}</>;
}
