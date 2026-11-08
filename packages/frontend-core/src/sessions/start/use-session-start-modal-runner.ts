import { useQueryClient } from "@tanstack/react-query";
import { repoDefaultModelSelectionFor } from "../session-start-selection";
import {
  GOAL_GENERATION_NEEDS_DEFAULT_MODEL,
  generateSessionStartGoal,
} from "./session-start-goal-generation";
import { launchGoalObjective, supportsTaskTargetBranchSelection } from "@openducktor/workflows";
import type { GitBranch, RuntimeKind } from "@openducktor/contracts";
import type { AgentDeliveryAvailability, AgentModelSelection } from "@openducktor/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClientConnection } from "../../connection/client-connection-react";
import type { SessionStartGoalMode, SessionStartModalModel } from "./session-start-modal-model";
import { useRuntimeGoalAvailability } from "../goals/use-runtime-goal-availability";
import { findRuntimeDefinition } from "../../lib/agent-runtime";
import { errorMessage } from "../../lib/errors";
import {
  INVALID_TASK_TARGET_BRANCH_LABEL,
  targetBranchFromSelection,
  taskTargetBranchValidationError,
} from "../../lib/target-branch";
import type { AgentSessionIdentity } from "../../types/agent-orchestrator";
import type { RepoSettingsInput } from "../../types/session-slices";
import { isSessionStartFailureFeedbackHandled } from "./session-start-orchestration";
import type {
  NewSessionStartDecision,
  ReuseSessionStartDecision,
  SessionStartExistingSessionOption,
} from "./session-start-types";
import { STANDARD_SPEED, withSpeed } from "../../lib/model-catalog-selection";
import { assertRuntimeSupportsSelectedStartMode } from "./session-start-validation";
import type { SessionStartModalOpenRequest } from "./use-session-start-modal-coordinator";
import { useSessionStartModalCoordinator } from "./use-session-start-modal-coordinator";
import { useSessionStartKickoffPrompt } from "./use-session-start-kickoff-prompt";
import { useStartupAttempt } from "../startup/use-startup-attempts";
import { startupIsPending } from "../startup/startup-navigation";

export type SessionStartModalDecision = Exclude<NewSessionStartDecision, null>;

type SessionStartModalConfirmPayload = Exclude<
  Parameters<SessionStartModalModel["onConfirm"]>[0],
  boolean | undefined
>;

type SessionStartDecisionInput = Omit<SessionStartModalConfirmPayload, "runInBackground">;

type LaunchFields = Pick<
  SessionStartModalDecision,
  "targetBranch" | "kickoffPrompt" | "goalObjective"
>;

type SessionStartDecisionRequestContext = Pick<
  SessionStartModalOpenRequest,
  "role" | "launchActionId" | "taskId"
>;

type SessionStartModalRunResult = {
  startupAttemptId: string;
  decision: SessionStartModalDecision;
  runInBackground: boolean;
  request: SessionStartModalOpenRequest;
};

type SessionStartModalRunnerResult = {
  sessionStartModal: SessionStartModalModel | null;
  isSessionStarting: boolean;
  runSessionStartRequest: <T>(
    request: SessionStartModalOpenRequest,
    execute: (result: SessionStartModalRunResult) => Promise<T>,
  ) => Promise<T | undefined>;
};

type PendingModalRun = {
  startupAttemptId?: string;
  scopeKey: string | null;
  request: SessionStartModalOpenRequest;
  execute: (result: SessionStartModalRunResult) => Promise<() => void>;
  cancel: () => void;
};

/** Locks the foreground submission until it settles or moves to background feedback. */
export function useSessionStartModalRunner({
  branches = [],
  favoriteState,
  repoSettings,
  workspaceRepoPath,
  scopeKey = workspaceRepoPath,
  workspaceId = scopeKey,
  onBackgroundTransfer,
}: {
  branches?: GitBranch[];
  favoriteState: SessionStartModalModel["favoriteState"];
  repoSettings: RepoSettingsInput | null;
  workspaceRepoPath: string | null;
  workspaceId?: string | null;
  scopeKey?: string | null;
  onBackgroundTransfer?: ((attemptId: string) => void) | undefined;
}): SessionStartModalRunnerResult {
  const { feedback, startupAttempts } = useClientConnection();
  const queryClient = useQueryClient();
  const scopeRef = useRef(scopeKey);
  const pendingRunRef = useRef<PendingModalRun | null>(null);
  const startupAttemptId =
    pendingRunRef.current?.scopeKey === scopeKey
      ? (pendingRunRef.current.startupAttemptId ?? null)
      : null;
  const activeAttempt = useStartupAttempt(startupAttemptId);
  const confirmationsRef = useRef(new Map<string | null, PendingModalRun>());
  const [confirmations, setConfirmations] = useState(confirmationsRef.current);
  const isStarting = confirmations.has(scopeKey) || startupIsPending(activeAttempt);

  const {
    intent,
    isOpen,
    selection,
    eligibleRuntimeDefinitions,
    selectedRuntimeDescriptor,
    selectedRuntimeKind,
    modelPickerRuntimes,
    supportsProfiles,
    supportsVariants,
    catalogError,
    isCatalogLoading,
    runtimeDefinitionsError,
    isRuntimeDefinitionsLoading,
    retryRuntimeDefinitions,
    runtimeSettingsError,
    isRuntimeSettingsLoading,
    hasRuntimeSettingsSnapshot,
    retryRuntimeSettings,
    runtimeProfileOptions,
    variantOptions,
    availableStartModes,
    selectedStartMode,
    existingSessionOptions,
    selectedSourceSessionValue,
    showTargetBranchSelector,
    targetBranchOptions,
    selectedTargetBranch,
    targetBranchError,
    openStartModal,
    closeStartModal,
    handleSelectStartMode,
    handleSelectSourceSessionValue,
    handleSelectTargetBranch,
    handleSelectRuntimeProfile,
    handleSelectModelPair,
    handleSelectVariant,
  } = useSessionStartModalCoordinator({
    branches,
    repoSettings,
    workspaceRepoPath,
  });

  const { kickoffPrompt, isKickoffPromptLoading, kickoffPromptError, onRetryKickoffPrompt } =
    useSessionStartKickoffPrompt({
      kickoff: intent?.kickoff,
      selectedTargetBranch,
    });

  const goalRuntimeKind =
    selectedStartMode === "reuse"
      ? (existingSessionOptions.find((option) => option.value === selectedSourceSessionValue)
          ?.sourceSession.runtimeKind ?? null)
      : selectedRuntimeKind;
  const goalAvailability = useRuntimeGoalAvailability(goalRuntimeKind);
  const goalMode = useMemo((): SessionStartGoalMode | undefined => {
    const task = intent?.kickoff?.task;
    if (!intent || !task || intent.postStartAction === "none") return undefined;
    const defaultObjective = launchGoalObjective(
      intent.taskWorkflow.launchAction(intent.launchActionId, intent.role),
      task,
      intent.kickoff?.request.humanFeedback,
    );
    if (defaultObjective === undefined) return undefined;
    const model = repoDefaultModelSelectionFor(repoSettings);
    return {
      defaultObjective,
      generation:
        model && workspaceId && workspaceRepoPath
          ? {
              kind: "available",
              run: () =>
                generateSessionStartGoal({
                  queryClient,
                  workspace: { workspaceId, repoPath: workspaceRepoPath },
                  task,
                  taskWorkflow: intent.taskWorkflow,
                  launchActionId: intent.launchActionId,
                  humanFeedback: intent.kickoff?.request.humanFeedback,
                  defaultObjective,
                  model,
                }),
            }
          : { kind: "unavailable", reason: GOAL_GENERATION_NEEDS_DEFAULT_MODEL },
      unavailableReason: goalModeUnavailableReason(goalAvailability),
    };
  }, [goalAvailability, intent, queryClient, repoSettings, workspaceId, workspaceRepoPath]);

  const handleRetryRuntimeDefinitions = useCallback((): void => {
    void retryRuntimeDefinitions().catch((error) => {
      feedback.show("error", "Failed to refresh runtime definitions.", {
        description: errorMessage(error),
      });
    });
  }, [feedback, retryRuntimeDefinitions]);

  const handleRetryRuntimeSettings = useCallback((): void => {
    void retryRuntimeSettings().catch((error) => {
      feedback.show("error", "Failed to refresh runtime settings.", {
        description: errorMessage(error),
      });
    });
  }, [feedback, retryRuntimeSettings]);

  const resolvePendingRun = useCallback(
    (settle?: () => void): void => {
      const pendingRun = pendingRunRef.current;
      if (!pendingRun) {
        return;
      }

      pendingRunRef.current = null;
      if (pendingRun.startupAttemptId) {
        const attempt = startupAttempts.getAttempt(pendingRun.startupAttemptId);
        if (attempt) {
          if (settle && attempt.presentation === "dialog" && attempt.status.phase === "ready")
            startupAttempts.handoff(attempt.id);
          else if (!settle) startupAttempts.continueInBackground(attempt.id);
        }
      }
      closeStartModal();
      (settle ?? pendingRun.cancel)();
    },
    [closeStartModal, startupAttempts],
  );

  const releaseConfirmation = useCallback((run: PendingModalRun): void => {
    if (confirmationsRef.current.get(run.scopeKey) !== run) return;
    const remaining = new Map(confirmationsRef.current);
    remaining.delete(run.scopeKey);
    confirmationsRef.current = remaining;
    setConfirmations(remaining);
  }, []);

  const continueRunInBackground = useCallback(
    (run: PendingModalRun): void => {
      if (!run.startupAttemptId) return;
      startupAttempts.continueInBackground(run.startupAttemptId);
      if (pendingRunRef.current === run) {
        pendingRunRef.current = null;
        closeStartModal();
        onBackgroundTransfer?.(run.startupAttemptId);
      }
      if (confirmationsRef.current.get(run.scopeKey) !== run) run.cancel();
      releaseConfirmation(run);
    },
    [closeStartModal, onBackgroundTransfer, releaseConfirmation, startupAttempts],
  );

  useEffect(
    () => () => {
      const pendingRun = pendingRunRef.current;
      pendingRunRef.current = null;
      if (pendingRun?.startupAttemptId)
        startupAttempts.continueInBackground(pendingRun.startupAttemptId);
      pendingRun?.cancel();
      for (const run of confirmationsRef.current.values())
        if (run !== pendingRun && run.startupAttemptId)
          startupAttempts.continueInBackground(run.startupAttemptId);
    },
    [startupAttempts],
  );

  useEffect(() => {
    if (scopeRef.current !== scopeKey) {
      scopeRef.current = scopeKey;
      resolvePendingRun();
    }
  }, [scopeKey, resolvePendingRun]);

  const runSessionStartRequest = useCallback(
    <T>(
      request: SessionStartModalOpenRequest,
      execute: (result: SessionStartModalRunResult) => Promise<T>,
    ): Promise<T | undefined> => {
      if (confirmationsRef.current.has(scopeKey)) {
        throw new Error("A session start is already in progress.");
      }
      resolvePendingRun();
      const targetBranchValidationError = taskTargetBranchValidationError(
        request.initialTargetBranchError,
      );
      if (
        targetBranchValidationError &&
        supportsTaskTargetBranchSelection(
          request.role,
          request.launchActionId,
          request.taskWorkflow,
        )
      ) {
        feedback.show("error", INVALID_TASK_TARGET_BRANCH_LABEL, {
          description: targetBranchValidationError,
        });
        return Promise.resolve(undefined);
      }
      const identifiedRequest = { ...request, requestId: crypto.randomUUID() };
      openStartModal(identifiedRequest);

      return new Promise<T | undefined>((resolve) => {
        pendingRunRef.current = {
          scopeKey,
          request: identifiedRequest,
          execute: async (result) => {
            const value = await execute(result);
            return () => resolve(value);
          },
          cancel: () => resolve(undefined),
        };
      });
    },
    [feedback, openStartModal, resolvePendingRun, scopeKey],
  );

  const confirmModal = useCallback(
    async (input?: Parameters<SessionStartModalModel["onConfirm"]>[0]) => {
      if (
        !input ||
        input === true ||
        confirmationsRef.current.has(scopeKey) ||
        isKickoffPromptLoading ||
        kickoffPromptError
      ) {
        return;
      }

      const pendingRun = pendingRunRef.current;
      if (!pendingRun) return;

      if (
        pendingRun.request.requestId !== intent?.requestId ||
        pendingRun.scopeKey !== scopeKey ||
        scopeRef.current !== scopeKey
      )
        return;
      confirmationsRef.current = new Map(confirmationsRef.current).set(scopeKey, pendingRun);
      setConfirmations(confirmationsRef.current);
      try {
        const decision = buildSessionStartModalDecision({
          input,
          existingSessionOptions,
          requestContext: pendingRun.request,
          selectedModel: selection,
        });
        // A source session of another role, as for the core pull request launch, gives the role.
        const sourceRole =
          decision.startMode === "fresh"
            ? undefined
            : existingSessionOptions.find(
                (option) => option.value === input.sourceSessionOptionValue,
              )?.role;
        const requestContext = sourceRole
          ? { ...pendingRun.request, role: sourceRole }
          : pendingRun.request;

        if (decision.startMode === "reuse") {
          const sourceOption = existingSessionOptions.find(
            (option) => option.value === input.sourceSessionOptionValue,
          );
          const sourceRuntimeKind = requireSourceSessionRuntimeKind(sourceOption);

          const sourceRuntimeDescriptor = findRuntimeDefinition(
            eligibleRuntimeDefinitions,
            sourceRuntimeKind,
          );
          assertRuntimeSupportsSelectedStartMode({
            ...requestContext,
            runtimeDescriptor: sourceRuntimeDescriptor,
            runtimeKind: sourceRuntimeKind,
            startMode: decision.startMode,
          });
        } else {
          assertRuntimeSupportsSelectedStartMode({
            ...requestContext,
            runtimeDescriptor: selectedRuntimeDescriptor,
            runtimeKind: decision.selectedModel.runtimeKind ?? selectedRuntimeKind,
            startMode: decision.startMode,
          });
        }

        if (!workspaceRepoPath || !workspaceId)
          throw new Error("Select a workspace before starting the session.");
        const roleLabel = requestContext.taskWorkflow.role(requestContext.role).label;
        const attemptId = startupAttempts.begin({
          origin: {
            workspaceId,
            repoPath: workspaceRepoPath,
            scope: { kind: "task", taskId: requestContext.taskId, role: requestContext.role },
          },
          label: requestContext.title ?? `Start ${roleLabel} session`,
          roleLabel,
          presentation: input.runInBackground ? "notification" : "dialog",
          instructionRequired: requestContext.postStartAction !== "none",
        });
        pendingRun.startupAttemptId = attemptId;
        if (input.runInBackground) continueRunInBackground(pendingRun);
        const settle = await pendingRun.execute({
          startupAttemptId: attemptId,
          decision,
          runInBackground: input.runInBackground ?? false,
          request: requestContext,
        });
        const outcome = startupAttempts.getAttempt(attemptId);
        if (
          startupIsPending(outcome) &&
          (outcome?.operations.length !== 0 || outcome.status.confirmation === "unconfirmed")
        ) {
          pendingRun.cancel();
          return;
        }
        if (outcome?.status.phase === "failed" || outcome?.status.phase === "canceled") {
          if (pendingRunRef.current !== pendingRun) settle();
          return;
        }
        if (outcome?.operations.length === 0) startupAttempts.release(attemptId);
        if (pendingRunRef.current === pendingRun) resolvePendingRun(settle);
        else settle();
      } catch (error) {
        if (pendingRun.startupAttemptId) {
          const attempt = startupAttempts.getAttempt(pendingRun.startupAttemptId);
          if (attempt && !["ready", "failed", "canceled"].includes(attempt.status.phase)) {
            if (attempt.operations.length === 0)
              startupAttempts.rejectBeforeDispatch(attempt.id, errorMessage(error));
            else startupAttempts.fail(attempt.id, errorMessage(error), false);
          }
        } else if (!isSessionStartFailureFeedbackHandled(error)) {
          feedback.show("error", "Failed to start the session.", {
            description: errorMessage(error),
          });
        }
        if (pendingRunRef.current !== pendingRun) pendingRun.cancel();
      } finally {
        releaseConfirmation(pendingRun);
      }
    },
    [
      feedback,
      intent?.requestId,
      scopeKey,
      isKickoffPromptLoading,
      kickoffPromptError,
      eligibleRuntimeDefinitions,
      existingSessionOptions,
      resolvePendingRun,
      selection,
      selectedRuntimeDescriptor,
      selectedRuntimeKind,
      workspaceId,
      workspaceRepoPath,
      startupAttempts,
      continueRunInBackground,
      releaseConfirmation,
    ],
  );

  const sessionStartModal = useMemo<SessionStartModalModel | null>(() => {
    if (!intent || (startupAttemptId && !activeAttempt)) {
      return null;
    }

    return {
      phase: startupAttemptId ? { kind: "progress", startupAttemptId } : { kind: "choices" },
      onContinueInBackground: () => {
        const run = pendingRunRef.current;
        if (run?.startupAttemptId === startupAttemptId) continueRunInBackground(run);
      },
      onEditChoices: () => {
        if (!startupAttemptId) return;
        const attempt = startupAttempts.getAttempt(startupAttemptId);
        if (attempt?.ownership.state !== "not_saved" || attempt.status.confirmation !== "current")
          return;
        startupAttempts.dismiss(startupAttemptId);
        if (pendingRunRef.current) delete pendingRunRef.current.startupAttemptId;
      },
      open: isOpen,
      requestId: intent.requestId,
      kickoffPrompt,
      isKickoffPromptLoading,
      kickoffPromptError,
      onRetryKickoffPrompt,
      goalMode,
      title: intent.title,
      description:
        intent.description ??
        "Choose how to start the session, then pick the runtime profile, model, and effort.",
      confirmLabel: "Start session",
      selectedModelSelection: selection,
      selectedRuntimeKind,
      modelPickerRuntimes,
      favoriteState,
      supportsProfiles,
      supportsVariants,
      selectionCatalogError: catalogError,
      isSelectionCatalogLoading: isCatalogLoading,
      runtimeDefinitionsError,
      isRuntimeDefinitionsLoading,
      onRetryRuntimeDefinitions: handleRetryRuntimeDefinitions,
      runtimeSettingsError,
      isRuntimeSettingsLoading,
      hasRuntimeSettingsSnapshot,
      onRetryRuntimeSettings: handleRetryRuntimeSettings,
      runtimeProfileOptions,
      variantOptions,
      availableStartModes,
      selectedStartMode,
      existingSessionOptions,
      selectedSourceSessionValue,
      showTargetBranchSelector,
      targetBranchOptions,
      selectedTargetBranch,
      targetBranchError,
      onSelectStartMode: handleSelectStartMode,
      onSelectSourceSessionValue: handleSelectSourceSessionValue,
      onSelectTargetBranch: handleSelectTargetBranch,
      onSelectRuntimeProfile: handleSelectRuntimeProfile,
      onSelectModelPair: handleSelectModelPair,
      onSelectVariant: handleSelectVariant,
      allowRunInBackground: true,
      backgroundConfirmLabel: "Run in background",
      isStarting,
      onOpenChange: (nextOpen: boolean) => {
        if (!nextOpen) {
          if (isStarting) {
            return;
          }
          if (
            startupAttemptId &&
            startupAttempts.getAttempt(startupAttemptId)?.presentation === "dialog"
          )
            startupAttempts.dismiss(startupAttemptId);
          resolvePendingRun();
        }
      },
      onConfirm: confirmModal,
    };
  }, [
    goalMode,
    kickoffPrompt,
    isKickoffPromptLoading,
    kickoffPromptError,
    onRetryKickoffPrompt,
    runtimeProfileOptions,
    availableStartModes,
    catalogError,
    confirmModal,
    existingSessionOptions,
    handleSelectRuntimeProfile,
    handleSelectModelPair,
    handleSelectTargetBranch,
    handleRetryRuntimeDefinitions,
    handleRetryRuntimeSettings,
    handleSelectSourceSessionValue,
    handleSelectStartMode,
    handleSelectVariant,
    intent,
    isCatalogLoading,
    isRuntimeDefinitionsLoading,
    isRuntimeSettingsLoading,
    isOpen,
    modelPickerRuntimes,
    favoriteState,
    resolvePendingRun,
    runtimeDefinitionsError,
    runtimeSettingsError,
    hasRuntimeSettingsSnapshot,
    selectedTargetBranch,
    targetBranchError,
    selectedRuntimeKind,
    selectedSourceSessionValue,
    selectedStartMode,
    showTargetBranchSelector,
    selection,
    isStarting,
    supportsProfiles,
    supportsVariants,
    targetBranchOptions,
    variantOptions,
    startupAttemptId,
    activeAttempt,
    startupAttempts,
    continueRunInBackground,
  ]);

  return {
    sessionStartModal,
    isSessionStarting: isStarting,
    runSessionStartRequest,
  };
}

export const buildSessionStartModalDecision = ({
  input,
  existingSessionOptions,
  requestContext,
  selectedModel,
}: {
  input: SessionStartDecisionInput;
  existingSessionOptions: SessionStartExistingSessionOption[];
  requestContext: SessionStartDecisionRequestContext;
  selectedModel: AgentModelSelection | null;
}): SessionStartModalDecision => {
  if (input.startMode === "reuse") {
    const sourceSession = requireSourceSession(
      input.sourceSessionOptionValue,
      existingSessionOptions,
      requestContext,
    );

    const decision: ReuseSessionStartDecision = {
      startMode: "reuse",
      sourceSession,
      ...buildLaunchFields(input),
    };
    if (input.speed !== undefined)
      decision.speed = input.speed === STANDARD_SPEED ? null : input.speed;
    return decision;
  }

  // A fresh or forked session uses only the speed chosen for this start.
  const resolvedSelectedModel = withSpeed(
    requireSelectedModel(selectedModel, requestContext),
    input.speed ?? STANDARD_SPEED,
  );

  if (input.startMode === "fork") {
    const sourceSession = requireSourceSession(
      input.sourceSessionOptionValue,
      existingSessionOptions,
      requestContext,
    );

    return {
      startMode: "fork",
      selectedModel: resolvedSelectedModel,
      sourceSession,
      ...buildLaunchFields(input),
    };
  }

  return {
    startMode: "fresh",
    selectedModel: resolvedSelectedModel,
    ...buildLaunchFields(input),
  };
};

export const requireSourceSessionRuntimeKind = (
  sourceSession: SessionStartExistingSessionOption | null | undefined,
): RuntimeKind => {
  const runtimeKind = sourceSession?.sourceSession.runtimeKind ?? null;
  if (runtimeKind) {
    return runtimeKind;
  }

  throw new Error("Reusable session is missing a runtime kind.");
};

/** Why the selected runtime cannot use Goal mode, or null. Without a runtime, none is chosen. */
const goalModeUnavailableReason = (
  availability: AgentDeliveryAvailability | null,
): string | null => {
  if (availability === null) return "Choose a model to use Goal mode.";
  if (availability.available) return null;
  return availability.reason;
};

const buildLaunchFields = (input: SessionStartDecisionInput): LaunchFields => {
  const fields: LaunchFields = {};
  if (input.targetBranch) fields.targetBranch = targetBranchFromSelection(input.targetBranch);
  if (input.kickoffPrompt !== undefined) fields.kickoffPrompt = input.kickoffPrompt;
  if (input.goalObjective !== undefined) fields.goalObjective = input.goalObjective;
  return fields;
};

const requireSelectedModel = (
  selection: AgentModelSelection | null,
  request: SessionStartDecisionRequestContext,
): AgentModelSelection => {
  if (selection) {
    return selection;
  }

  throw new Error(
    `Starting a ${request.role} ${request.launchActionId} session for ${request.taskId} requires an explicit model selection.`,
  );
};

const requireSourceSession = (
  sourceSessionOptionValue: string | null,
  existingSessionOptions: SessionStartExistingSessionOption[],
  request: SessionStartDecisionRequestContext,
): AgentSessionIdentity => {
  const sourceSessionOption = existingSessionOptions.find(
    (option) => option.value === sourceSessionOptionValue,
  );
  if (sourceSessionOption) {
    return sourceSessionOption.sourceSession;
  }

  throw new Error(
    `Starting a ${request.role} ${request.launchActionId} session for ${request.taskId} requires a source session.`,
  );
};
