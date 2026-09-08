import type { GitBranch, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { SessionStartModalModel } from "@/components/features/agents";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import { errorMessage } from "@/lib/errors";
import {
  INVALID_TASK_TARGET_BRANCH_LABEL,
  targetBranchFromSelection,
  taskTargetBranchValidationError,
} from "@/lib/target-branch";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { RepoSettingsInput } from "@/types/state-slices";
import { supportsTaskTargetBranchSelection } from "./constants";
import { isSessionStartFailureFeedbackHandled } from "./session-start-orchestration";
import type {
  NewSessionStartDecision,
  SessionStartExistingSessionOption,
} from "./session-start-types";
import { assertRuntimeSupportsSelectedStartMode } from "./session-start-validation";
import type { SessionStartModalOpenRequest } from "./use-session-start-modal-coordinator";
import { useSessionStartModalCoordinator } from "./use-session-start-modal-coordinator";
import { useSessionStartKickoffPrompt } from "./use-session-start-kickoff-prompt";

export type SessionStartModalDecision = Exclude<NewSessionStartDecision, null>;

type SessionStartModalConfirmPayload = Exclude<
  Parameters<SessionStartModalModel["onConfirm"]>[0],
  boolean | undefined
>;

type SessionStartDecisionInput = Omit<SessionStartModalConfirmPayload, "runInBackground">;

type LaunchFields = Pick<SessionStartModalDecision, "targetBranch" | "kickoffPrompt">;

type SessionStartDecisionRequestContext = Pick<
  SessionStartModalOpenRequest,
  "role" | "launchActionId" | "taskId"
>;

type SessionStartModalRunResult = {
  decision: SessionStartModalDecision;
  runInBackground: boolean;
  request: SessionStartModalOpenRequest;
};

type PendingModalRun = {
  scopeKey: string | null;
  request: SessionStartModalOpenRequest;
  execute: (result: SessionStartModalRunResult) => Promise<() => void>;
  cancel: () => void;
};

/** Keeps a start locked to its scope until execution ends, even if another scope opens a modal. */
export function useSessionStartModalRunner({
  branches = [],
  favoriteState,
  repoSettings,
  workspaceRepoPath,
  scopeKey = workspaceRepoPath,
}: {
  branches?: GitBranch[];
  favoriteState: SessionStartModalModel["favoriteState"];
  repoSettings: RepoSettingsInput | null;
  workspaceRepoPath: string | null;
  scopeKey?: string | null;
}) {
  const scopeRef = useRef(scopeKey);
  const selectionRef = useRef<AgentModelSelection | null>(null);
  const pendingRunRef = useRef<PendingModalRun | null>(null);
  const confirmationsRef = useRef(new Map<string | null, PendingModalRun>());
  const [confirmations, setConfirmations] = useState(confirmationsRef.current);
  const isStarting = confirmations.has(scopeKey);

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

  selectionRef.current = selection;
  const { kickoffPrompt, isKickoffPromptLoading, kickoffPromptError, onRetryKickoffPrompt } =
    useSessionStartKickoffPrompt({
      requestId: intent?.requestId,
      resolveKickoffPrompt: intent?.resolveKickoffPrompt,
      selectedTargetBranch,
    });

  const handleRetryRuntimeDefinitions = useCallback((): void => {
    void retryRuntimeDefinitions().catch((error) => {
      toast.error("Failed to refresh runtime definitions.", {
        description: errorMessage(error),
      });
    });
  }, [retryRuntimeDefinitions]);

  const handleRetryRuntimeSettings = useCallback((): void => {
    void retryRuntimeSettings().catch((error) => {
      toast.error("Failed to refresh runtime settings.", {
        description: errorMessage(error),
      });
    });
  }, [retryRuntimeSettings]);

  const resolvePendingRun = useCallback(
    (settle?: () => void): void => {
      const pendingRun = pendingRunRef.current;
      if (!pendingRun) {
        return;
      }

      pendingRunRef.current = null;
      closeStartModal();
      (settle ?? pendingRun.cancel)();
    },
    [closeStartModal],
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
        supportsTaskTargetBranchSelection(request.role, request.launchActionId)
      ) {
        toast.error(INVALID_TASK_TARGET_BRANCH_LABEL, {
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
    [openStartModal, resolvePendingRun, scopeKey],
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
      if (!pendingRun) {
        toast.error("Session start request is no longer available.");
        return;
      }

      if (
        pendingRun.request.requestId !== intent?.requestId ||
        pendingRun.scopeKey !== scopeKey ||
        scopeRef.current !== scopeKey
      )
        return;
      const requestContext = pendingRun.request;

      confirmationsRef.current = new Map(confirmationsRef.current).set(scopeKey, pendingRun);
      setConfirmations(confirmationsRef.current);
      try {
        const decision = buildSessionStartModalDecision({
          input,
          existingSessionOptions,
          requestContext,
          selectedModel: selectionRef.current,
        });

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

        const settle = await pendingRun.execute({
          decision,
          runInBackground: input.runInBackground ?? false,
          request: requestContext,
        });
        if (pendingRunRef.current === pendingRun) resolvePendingRun(settle);
        else settle();
      } catch (error) {
        if (!isSessionStartFailureFeedbackHandled(error)) {
          toast.error("Failed to start the session.", {
            description: errorMessage(error),
          });
        }
      } finally {
        if (confirmationsRef.current.get(scopeKey) === pendingRun) {
          const remaining = new Map(confirmationsRef.current);
          remaining.delete(scopeKey);
          confirmationsRef.current = remaining;
          setConfirmations(remaining);
        }
      }
    },
    [
      intent?.requestId,
      scopeKey,
      isKickoffPromptLoading,
      kickoffPromptError,
      eligibleRuntimeDefinitions,
      existingSessionOptions,
      resolvePendingRun,
      selectedRuntimeDescriptor,
      selectedRuntimeKind,
    ],
  );

  const sessionStartModal = useMemo<SessionStartModalModel | null>(() => {
    if (!intent) {
      return null;
    }

    return {
      open: isOpen,
      requestId: intent.requestId,
      kickoffPrompt,
      isKickoffPromptLoading,
      kickoffPromptError,
      onRetryKickoffPrompt,
      title: intent.title,
      description:
        intent.description ??
        "Choose how to start the session, then pick the runtime profile, model, and variant.",
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
      onSelectStartMode: handleSelectStartMode,
      onSelectSourceSessionValue: handleSelectSourceSessionValue,
      onSelectTargetBranch: handleSelectTargetBranch,
      onSelectRuntimeProfile: handleSelectRuntimeProfile,
      onSelectModelPair: handleSelectModelPair,
      onSelectVariant: handleSelectVariant,
      allowRunInBackground: intent.source === "kanban",
      backgroundConfirmLabel: "Run in background",
      isStarting,
      onOpenChange: (nextOpen: boolean) => {
        if (!nextOpen) {
          if (isStarting) {
            return;
          }
          resolvePendingRun();
        }
      },
      onConfirm: confirmModal,
    };
  }, [
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
  ]);

  return {
    sessionStartModal,
    runSessionStartRequest,
  } satisfies {
    sessionStartModal: SessionStartModalModel | null;
    runSessionStartRequest: <T>(
      request: SessionStartModalOpenRequest,
      execute: (result: SessionStartModalRunResult) => Promise<T>,
    ) => Promise<T | undefined>;
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

    return {
      startMode: "reuse",
      sourceSession,
      ...buildLaunchFields(input),
    };
  }

  const resolvedSelectedModel = requireSelectedModel(selectedModel, requestContext);

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

const buildLaunchFields = (input: SessionStartDecisionInput): LaunchFields => {
  const fields: LaunchFields = {};
  if (input.targetBranch) fields.targetBranch = targetBranchFromSelection(input.targetBranch);
  if (input.kickoffPrompt !== undefined) fields.kickoffPrompt = input.kickoffPrompt;
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
