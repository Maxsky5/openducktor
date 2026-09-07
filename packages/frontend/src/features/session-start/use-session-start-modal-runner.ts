import { assertRuntimeSupportsSelectedStartMode } from "./session-start-validation";
export { assertRuntimeSupportsSelectedStartMode } from "./session-start-validation";
import type { GitBranch, GitTargetBranch, RuntimeKind } from "@openducktor/contracts";
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
import type { SessionStartModalOpenRequest } from "./use-session-start-modal-coordinator";
import { useSessionStartModalCoordinator } from "./use-session-start-modal-coordinator";

export type SessionStartModalDecision = Exclude<NewSessionStartDecision, null>;

type SessionStartModalRunRequest = SessionStartModalOpenRequest & {
  selectedModel?: AgentModelSelection | null;
};

type SessionStartModalConfirmPayload = Exclude<
  Parameters<SessionStartModalModel["onConfirm"]>[0],
  boolean | undefined
>;

type SessionStartDecisionInput = Omit<SessionStartModalConfirmPayload, "runInBackground">;

type SessionStartTargetBranchFields = {
  kickoffPrompt?: string;
  targetBranch?: GitTargetBranch;
};

type SessionStartDecisionRequestContext = Pick<
  SessionStartModalRunRequest,
  "role" | "launchActionId" | "taskId"
>;

type SessionStartModalRunResult = {
  decision: SessionStartModalDecision;
  runInBackground: boolean;
  request: SessionStartModalRunRequest;
};

type PendingModalRun = {
  request: SessionStartModalRunRequest;
  execute: (result: SessionStartModalRunResult) => Promise<() => void>;
  cancel: () => void;
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
  const buildTargetBranchFields = (): SessionStartTargetBranchFields => {
    const fields: SessionStartTargetBranchFields = {};
    if (input.targetBranch) fields.targetBranch = targetBranchFromSelection(input.targetBranch);
    if (input.kickoffPrompt !== undefined) fields.kickoffPrompt = input.kickoffPrompt;
    return fields;
  };

  if (input.startMode === "reuse") {
    const sourceSession = requireSourceSession(
      input.sourceSessionOptionValue,
      existingSessionOptions,
      requestContext,
    );

    return {
      startMode: "reuse",
      sourceSession,
      ...buildTargetBranchFields(),
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
      ...buildTargetBranchFields(),
    };
  }

  return {
    startMode: "fresh",
    selectedModel: resolvedSelectedModel,
    ...buildTargetBranchFields(),
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
  const [isStarting, setIsStarting] = useState(false);
  const confirmingRef = useRef(false);
  const [promptRetry, setPromptRetry] = useState(0);
  const [promptState, setPromptState] = useState<{
    key: string;
    text?: string;
    error?: string;
  } | null>(null);

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
  const promptKey = `${intent?.requestId ?? ""}:${selectedTargetBranch}:${promptRetry}`;
  const needsPrompt = Boolean(intent?.resolveKickoffPrompt);
  const promptLoading = needsPrompt && promptState?.key !== promptKey;
  useEffect(() => {
    const resolve = intent?.resolveKickoffPrompt;
    if (!resolve) return;
    let active = true;
    void (async () => {
      try {
        const branch = selectedTargetBranch
          ? targetBranchFromSelection(selectedTargetBranch)
          : undefined;
        const text = await resolve(branch);
        if (active) setPromptState({ key: promptKey, text });
      } catch (cause) {
        if (active) setPromptState({ key: promptKey, error: errorMessage(cause) });
      }
    })();
    return () => {
      active = false;
    };
  }, [intent?.resolveKickoffPrompt, promptKey, selectedTargetBranch]);

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
      request: SessionStartModalRunRequest,
      execute: (result: SessionStartModalRunResult) => Promise<T>,
    ): Promise<T | undefined> => {
      if (confirmingRef.current) {
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
          request: identifiedRequest,
          execute: async (result) => {
            const value = await execute(result);
            return () => resolve(value);
          },
          cancel: () => resolve(undefined),
        };
      });
    },
    [openStartModal, resolvePendingRun],
  );

  const confirmModal = useCallback(
    async (input?: Parameters<SessionStartModalModel["onConfirm"]>[0]) => {
      if (
        !input ||
        input === true ||
        confirmingRef.current ||
        promptLoading ||
        (needsPrompt && promptState?.error)
      ) {
        return;
      }

      const pendingRun = pendingRunRef.current;
      if (!pendingRun) {
        toast.error("Session start request is no longer available.");
        return;
      }

      if (pendingRun.request.requestId !== intent?.requestId || scopeRef.current !== scopeKey)
        return;
      const requestContext = pendingRun.request;

      confirmingRef.current = true;
      setIsStarting(true);
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
        confirmingRef.current = false;
        setIsStarting(false);
      }
    },
    [
      intent?.requestId,
      scopeKey,
      promptLoading,
      needsPrompt,
      promptState,
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
      kickoffPrompt: needsPrompt && promptState?.key === promptKey ? promptState.text : undefined,
      isKickoffPromptLoading: promptLoading,
      kickoffPromptError:
        needsPrompt && promptState?.key === promptKey ? (promptState.error ?? null) : null,
      onRetryKickoffPrompt: () => setPromptRetry((value) => value + 1),
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
    needsPrompt,
    promptState,
    promptKey,
    promptLoading,
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
      request: SessionStartModalRunRequest,
      execute: (result: SessionStartModalRunResult) => Promise<T>,
    ) => Promise<T | undefined>;
  };
}
