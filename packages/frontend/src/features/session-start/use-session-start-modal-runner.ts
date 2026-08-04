import type {
  GitBranch,
  GitTargetBranch,
  RuntimeDescriptor,
  RuntimeKind,
} from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole, AgentSessionStartMode } from "@openducktor/core";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { SessionStartModalModel } from "@/components/features/agents";
import { findRuntimeDefinition, runtimeSupportsStartMode } from "@/lib/agent-runtime";
import { errorMessage } from "@/lib/errors";
import {
  INVALID_TASK_TARGET_BRANCH_LABEL,
  targetBranchFromSelection,
  taskTargetBranchValidationError,
} from "@/lib/target-branch";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { RepoSettingsInput } from "@/types/state-slices";
import { supportsTaskTargetBranchSelection } from "./constants";
import type { SessionStartExistingSessionOption } from "./session-start-types";
import type { SessionStartModalOpenRequest } from "./use-session-start-modal-coordinator";
import { useSessionStartModalCoordinator } from "./use-session-start-modal-coordinator";

export type SessionStartModalDecision =
  | {
      startMode: "fresh";
      selectedModel: AgentModelSelection;
      targetBranch?: GitTargetBranch;
    }
  | {
      startMode: "reuse";
      sourceSession: AgentSessionIdentity;
      targetBranch?: GitTargetBranch;
    }
  | {
      startMode: "fork";
      selectedModel: AgentModelSelection;
      sourceSession: AgentSessionIdentity;
      targetBranch?: GitTargetBranch;
    };

type SessionStartModalRunRequest = SessionStartModalOpenRequest & {
  selectedModel?: AgentModelSelection | null;
};

type SessionStartModalConfirmPayload = Exclude<
  Parameters<SessionStartModalModel["onConfirm"]>[0],
  boolean | undefined
>;

type SessionStartDecisionInput = Omit<SessionStartModalConfirmPayload, "runInBackground">;

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
  execute: (result: SessionStartModalRunResult) => Promise<unknown>;
  resolve: (value: unknown) => void;
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
  const buildTargetBranchFields = (): { targetBranch?: GitTargetBranch } =>
    input.targetBranch ? { targetBranch: targetBranchFromSelection(input.targetBranch) } : {};

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

export const assertRuntimeSupportsSelectedStartMode = ({
  launchActionId,
  role,
  runtimeDescriptor,
  runtimeKind,
  startMode,
  taskId,
}: {
  launchActionId: string;
  role: AgentRole;
  runtimeDescriptor: RuntimeDescriptor | null;
  runtimeKind: RuntimeKind | null;
  startMode: AgentSessionStartMode;
  taskId: string;
}): void => {
  if (!runtimeDescriptor) {
    throw new Error(
      `Starting a ${role} ${launchActionId} session for ${taskId} requires a runtime that supports ${startMode} session starts.`,
    );
  }
  if (runtimeSupportsStartMode(runtimeDescriptor, startMode)) {
    return;
  }

  const runtimeLabel = runtimeDescriptor.label || runtimeKind || runtimeDescriptor.kind;
  throw new Error(
    `Runtime "${runtimeLabel}" does not support ${startMode} session starts for ${launchActionId}. Select a compatible runtime or start mode.`,
  );
};

export function useSessionStartModalRunner({
  branches = [],
  repoSettings,
  workspaceRepoPath,
}: {
  branches?: GitBranch[];
  repoSettings: RepoSettingsInput | null;
  workspaceRepoPath: string | null;
}): {
  sessionStartModal: SessionStartModalModel | null;
  runSessionStartRequest: <T>(
    request: SessionStartModalRunRequest,
    execute: (result: SessionStartModalRunResult) => Promise<T>,
  ) => Promise<T | undefined>;
} {
  const selectionRef = useRef<AgentModelSelection | null>(null);
  const pendingRunRef = useRef<PendingModalRun | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const {
    intent,
    isOpen,
    selection,
    eligibleRuntimeDefinitions,
    selectedRuntimeDescriptor,
    selectedRuntimeKind,
    runtimeOptions,
    supportsProfiles,
    supportsVariants,
    catalogError,
    isCatalogLoading,
    agentOptions,
    modelOptions,
    modelGroups,
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
    handleSelectRuntime,
    handleSelectAgent,
    handleSelectModel,
    handleSelectVariant,
  } = useSessionStartModalCoordinator({
    branches,
    repoSettings,
    workspaceRepoPath,
  });

  selectionRef.current = selection;

  const resolvePendingRun = useCallback(
    (value: unknown): void => {
      const pendingRun = pendingRunRef.current;
      if (!pendingRun) {
        return;
      }

      pendingRunRef.current = null;
      closeStartModal();
      pendingRun.resolve(value);
    },
    [closeStartModal],
  );

  const runSessionStartRequest = useCallback(
    <T>(
      request: SessionStartModalRunRequest,
      execute: (result: SessionStartModalRunResult) => Promise<T>,
    ): Promise<T | undefined> => {
      if (isStarting) {
        throw new Error("A session start is already in progress.");
      }
      resolvePendingRun(undefined);
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
      openStartModal(request);

      return new Promise<T | undefined>((resolve) => {
        pendingRunRef.current = {
          request,
          execute: execute as (result: SessionStartModalRunResult) => Promise<unknown>,
          resolve: resolve as (value: unknown) => void,
        };
      });
    },
    [isStarting, openStartModal, resolvePendingRun],
  );

  const confirmModal = useCallback(
    async (input?: Parameters<SessionStartModalModel["onConfirm"]>[0]) => {
      if (!input || typeof input === "boolean") {
        return;
      }

      const pendingRun = pendingRunRef.current;
      if (!pendingRun) {
        toast.error("Session start request is no longer available.");
        return;
      }

      const requestContext = pendingRun.request;

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

        const value = await pendingRun.execute({
          decision,
          runInBackground: input.runInBackground ?? false,
          request: requestContext,
        });
        resolvePendingRun(value);
      } catch (error) {
        toast.error("Failed to start the session.", {
          description: errorMessage(error),
        });
      } finally {
        setIsStarting(false);
      }
    },
    [
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
      title: intent.title,
      description:
        intent.description ??
        "Choose how to start the session, then pick the agent, model, and variant.",
      confirmLabel: "Start session",
      selectedModelSelection: selection,
      selectedRuntimeKind,
      runtimeOptions,
      supportsProfiles,
      supportsVariants,
      selectionCatalogError: catalogError,
      isSelectionCatalogLoading: isCatalogLoading,
      agentOptions,
      modelOptions,
      modelGroups,
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
      onSelectRuntime: handleSelectRuntime,
      onSelectAgent: handleSelectAgent,
      onSelectModel: handleSelectModel,
      onSelectVariant: handleSelectVariant,
      allowRunInBackground: intent.source === "kanban",
      backgroundConfirmLabel: "Run in background",
      isStarting,
      onOpenChange: (nextOpen: boolean) => {
        if (!nextOpen) {
          if (isStarting) {
            return;
          }
          resolvePendingRun(undefined);
        }
      },
      onConfirm: confirmModal,
    };
  }, [
    agentOptions,
    availableStartModes,
    catalogError,
    confirmModal,
    existingSessionOptions,
    handleSelectAgent,
    handleSelectModel,
    handleSelectTargetBranch,
    handleSelectRuntime,
    handleSelectSourceSessionValue,
    handleSelectStartMode,
    handleSelectVariant,
    intent,
    isCatalogLoading,
    isOpen,
    modelGroups,
    modelOptions,
    resolvePendingRun,
    runtimeOptions,
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
  };
}
