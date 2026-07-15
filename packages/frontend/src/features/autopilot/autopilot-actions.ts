import type {
  AgentSessionRecord,
  AutopilotActionId,
  RepoRuntimeRef,
  TaskCard,
} from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection, AgentRole } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type {
  ResolvedSessionStartDecision,
  RunSessionStartWorkflow,
} from "@/features/session-start";
import {
  coerceVisibleSelectionToCatalog,
  pickDefaultVisibleSelectionForCatalog,
  roleDefaultSelectionFor,
} from "@/features/session-start/session-start-selection";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { errorMessage } from "@/lib/errors";
import { MISSING_BUILD_TARGET_ERROR } from "@/lib/session-start-errors";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import { loadRepoConfigFromQuery, toRepoSettingsInput } from "@/state/queries/workspace";
import { AGENT_ROLE_LABELS } from "@/types";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import { getSessionLaunchAction } from "../session-start/session-start-launch-options";
import { AUTOPILOT_ACTION_DEFINITIONS, type AutopilotActionDefinition } from "./autopilot-catalog";

type AutopilotActionOutcome =
  | {
      kind: "started";
      message: string;
      postStartActionError: Error | null;
    }
  | {
      kind: "skipped";
      message: string;
    };

type ExecuteAutopilotActionArgs = {
  activeWorkspace: ActiveWorkspace;
  task: TaskCard;
  actionId: AutopilotActionId;
  queryClient: QueryClient;
  loadTaskSessionRecords: (repoPath: string, taskId: string) => Promise<AgentSessionRecord[]>;
  loadRepoRuntimeCatalog: (runtimeRef: RepoRuntimeRef) => Promise<AgentModelCatalog>;
  resolveTaskWorktree: (
    repoPath: string,
    taskId: string,
  ) => Promise<{
    workingDirectory: string;
  } | null>;
  runSessionStartWorkflow: RunSessionStartWorkflow;
};

type ResolvedAutopilotStart = {
  kind: "start";
  startMode: "fresh" | "reuse" | "fork";
  sourceSession?: AgentSessionIdentity | null;
  targetWorkingDirectory?: string | null;
  preferredSelection?: AgentModelSelection | null;
};

type SkippedAutopilotStart = {
  kind: "skipped";
  message: string;
};

type AutopilotStartResolution = ResolvedAutopilotStart | SkippedAutopilotStart;

const ROLE_LABELS = AGENT_ROLE_LABELS as Record<AgentRole, string>;

const findLatestSessionRecordByRole = (
  sessions: AgentSessionRecord[],
  role: AgentRole,
): AgentSessionRecord | null => {
  const matchingSessions = sessions
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
  loadRepoRuntimeCatalog: (runtimeRef: RepoRuntimeRef) => Promise<AgentModelCatalog>;
}): Promise<AgentModelSelection> => {
  if (preferredSelection) {
    return preferredSelection;
  }

  const repoConfig = await loadRepoConfigFromQuery(queryClient, activeWorkspace.workspaceId);
  const repoSettings = toRepoSettingsInput(repoConfig);
  const savedDefaultSelection = roleDefaultSelectionFor(repoSettings, role);
  const runtimeKind = savedDefaultSelection?.runtimeKind ?? repoSettings.defaultRuntimeKind;
  const catalog = await loadRepoRuntimeCatalog({
    repoPath: activeWorkspace.repoPath,
    runtimeKind,
  });

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

const isSkippableAutopilotError = (action: AutopilotActionDefinition, error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    action.startPolicy.kind === "launchAction" &&
    action.startPolicy.missingBuildTargetOutcome === "skip" &&
    error.message.includes(MISSING_BUILD_TARGET_ERROR)
  );
};

const resolveAutopilotStart = async ({
  activeWorkspace,
  action,
  task,
  loadTaskSessionRecords,
  resolveTaskWorktree,
}: Pick<
  ExecuteAutopilotActionArgs,
  "activeWorkspace" | "task" | "loadTaskSessionRecords" | "resolveTaskWorktree"
> & {
  action: AutopilotActionDefinition;
}): Promise<AutopilotStartResolution> => {
  const taskSessions = await loadTaskSessionRecords(activeWorkspace.repoPath, task.id);
  const latestRoleSession = findLatestSessionRecordByRole(taskSessions, action.role);

  if (action.startPolicy.kind === "latestRoleSession") {
    if (!latestRoleSession) {
      return {
        kind: "skipped",
        message: `No ${ROLE_LABELS[action.role]} session is available to ${action.startPolicy.startMode} for task "${task.id}".`,
      };
    }

    return {
      kind: "start",
      startMode: action.startPolicy.startMode,
      sourceSession: toAgentSessionIdentity(latestRoleSession),
      preferredSelection: toAgentModelSelection(latestRoleSession.selectedModel),
    };
  }

  const { allowedStartModes } = getSessionLaunchAction(action.launchActionId);
  if (!allowedStartModes.includes("reuse")) {
    return {
      kind: "start",
      startMode: "fresh",
    };
  }

  const continuationTarget = await resolveTaskWorktree(activeWorkspace.repoPath, task.id);
  if (!continuationTarget) {
    if (action.role === "qa" && allowedStartModes.includes("fresh")) {
      return {
        kind: "start",
        startMode: "fresh",
      };
    }
    throw new Error(MISSING_BUILD_TARGET_ERROR);
  }

  if (
    latestRoleSession &&
    normalizeWorkingDirectory(latestRoleSession.workingDirectory) ===
      normalizeWorkingDirectory(continuationTarget.workingDirectory)
  ) {
    return {
      kind: "start",
      startMode: "reuse",
      sourceSession: toAgentSessionIdentity(latestRoleSession),
      targetWorkingDirectory: continuationTarget.workingDirectory,
    };
  }

  return {
    kind: "start",
    startMode: "fresh",
    targetWorkingDirectory: continuationTarget.workingDirectory,
  };
};

const requireAutopilotSourceSession = (
  resolution: ResolvedAutopilotStart,
): AgentSessionIdentity => {
  if (resolution.sourceSession) {
    return resolution.sourceSession;
  }
  throw new Error(`${resolution.startMode} autopilot start requires a source session.`);
};

const toSessionStartDecision = ({
  resolution,
  selectedModel,
}: {
  resolution: ResolvedAutopilotStart;
  selectedModel: AgentModelSelection | null;
}): ResolvedSessionStartDecision => {
  if (resolution.startMode === "reuse") {
    return {
      startMode: "reuse",
      sourceSession: requireAutopilotSourceSession(resolution),
    };
  }

  if (!selectedModel) {
    throw new Error(`${resolution.startMode} autopilot start requires a selected model.`);
  }

  if (resolution.startMode === "fork") {
    return {
      startMode: "fork",
      sourceSession: requireAutopilotSourceSession(resolution),
      selectedModel,
    };
  }

  return {
    startMode: "fresh",
    selectedModel,
  };
};

export const executeAutopilotAction = async ({
  activeWorkspace,
  task,
  actionId,
  queryClient,
  loadTaskSessionRecords,
  loadRepoRuntimeCatalog,
  resolveTaskWorktree,
  runSessionStartWorkflow,
}: ExecuteAutopilotActionArgs): Promise<AutopilotActionOutcome> => {
  const action = AUTOPILOT_ACTION_DEFINITIONS[actionId];

  try {
    const startResolution = await resolveAutopilotStart({
      activeWorkspace,
      action,
      task,
      loadTaskSessionRecords,
      resolveTaskWorktree,
    });
    if (startResolution.kind === "skipped") {
      return startResolution;
    }
    const selectedModel =
      startResolution.startMode === "reuse"
        ? null
        : await resolveAutopilotSelection({
            activeWorkspace,
            role: action.role,
            ...(startResolution.preferredSelection !== undefined
              ? { preferredSelection: startResolution.preferredSelection }
              : {}),
            queryClient,
            loadRepoRuntimeCatalog,
          });

    const workflow = await runSessionStartWorkflow({
      request: {
        taskId: task.id,
        role: action.role,
        launchActionId: action.launchActionId,
        postStartAction: "kickoff",
        ...(startResolution.targetWorkingDirectory !== undefined
          ? { targetWorkingDirectory: startResolution.targetWorkingDirectory }
          : {}),
      },
      decision: toSessionStartDecision({
        resolution: startResolution,
        selectedModel,
      }),
      task,
    });

    return {
      kind: "started",
      message: `Started ${action.label} for ${task.id}.`,
      postStartActionError: workflow.postStartActionError,
    };
  } catch (error) {
    if (isSkippableAutopilotError(action, error)) {
      return {
        kind: "skipped",
        message: errorMessage(error),
      };
    }
    throw error;
  }
};
