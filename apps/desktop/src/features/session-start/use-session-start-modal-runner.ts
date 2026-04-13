import type { GitBranch, GitTargetBranch } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { SessionStartModalModel } from "@/components/features/agents";
import { errorMessage } from "@/lib/errors";
import {
  INVALID_TASK_TARGET_BRANCH_LABEL,
  targetBranchFromSelection,
  taskTargetBranchValidationError,
} from "@/lib/target-branch";
import type { RepoSettingsInput } from "@/types/state-slices";
import { supportsTaskTargetBranchSelection } from "./constants";
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
      sourceSessionId: string;
      targetBranch?: GitTargetBranch;
    }
  | {
      startMode: "fork";
      selectedModel: AgentModelSelection;
      sourceSessionId: string;
      targetBranch?: GitTargetBranch;
    };

type SessionStartModalRunRequest = SessionStartModalOpenRequest & {
  selectedModel?: AgentModelSelection | null;
};

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
  request: Pick<SessionStartModalRunRequest, "role" | "scenario" | "taskId">,
): AgentModelSelection => {
  if (selection) {
    return selection;
  }

  throw new Error(
    `Starting a ${request.role} ${request.scenario} session for ${request.taskId} requires an explicit model selection.`,
  );
};

const requireSourceSessionId = (
  sourceSessionId: string | null,
  request: Pick<SessionStartModalRunRequest, "role" | "scenario" | "taskId">,
): string => {
  if (sourceSessionId) {
    return sourceSessionId;
  }

  throw new Error(
    `Starting a ${request.role} ${request.scenario} session for ${request.taskId} requires a source session.`,
  );
};

export function useSessionStartModalRunner({
  activeRepo,
  branches = [],
  repoSettings,
}: {
  activeRepo: string | null;
  branches?: GitBranch[];
  repoSettings: RepoSettingsInput | null;
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
    selectedRuntimeKind,
    runtimeOptions,
    supportsProfiles,
    supportsVariants,
    isCatalogLoading,
    agentOptions,
    modelOptions,
    modelGroups,
    variantOptions,
    availableStartModes,
    selectedStartMode,
    existingSessionOptions,
    selectedSourceSessionId,
    showTargetBranchSelector,
    targetBranchOptions,
    selectedTargetBranch,
    openStartModal,
    closeStartModal,
    handleSelectStartMode,
    handleSelectSourceSession,
    handleSelectTargetBranch,
    handleSelectRuntime,
    handleSelectAgent,
    handleSelectModel,
    handleSelectVariant,
  } = useSessionStartModalCoordinator({
    activeRepo,
    branches,
    repoSettings,
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
        supportsTaskTargetBranchSelection(request.role, request.scenario)
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

      const decision: SessionStartModalDecision =
        input.startMode === "reuse"
          ? {
              startMode: "reuse",
              sourceSessionId: requireSourceSessionId(input.sourceSessionId, requestContext),
              ...(input.targetBranch
                ? { targetBranch: targetBranchFromSelection(input.targetBranch) }
                : {}),
            }
          : input.startMode === "fork"
            ? {
                startMode: "fork",
                selectedModel: requireSelectedModel(selectionRef.current, requestContext),
                sourceSessionId: requireSourceSessionId(input.sourceSessionId, requestContext),
                ...(input.targetBranch
                  ? { targetBranch: targetBranchFromSelection(input.targetBranch) }
                  : {}),
              }
            : {
                startMode: "fresh",
                selectedModel: requireSelectedModel(selectionRef.current, requestContext),
                ...(input.targetBranch
                  ? { targetBranch: targetBranchFromSelection(input.targetBranch) }
                  : {}),
              };

      setIsStarting(true);
      try {
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
    [resolvePendingRun],
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
      isSelectionCatalogLoading: isCatalogLoading,
      agentOptions,
      modelOptions,
      modelGroups,
      variantOptions,
      availableStartModes,
      selectedStartMode,
      existingSessionOptions,
      selectedSourceSessionId,
      showTargetBranchSelector,
      targetBranchOptions,
      selectedTargetBranch,
      onSelectStartMode: handleSelectStartMode,
      onSelectSourceSession: handleSelectSourceSession,
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
    confirmModal,
    existingSessionOptions,
    handleSelectAgent,
    handleSelectModel,
    handleSelectTargetBranch,
    handleSelectRuntime,
    handleSelectSourceSession,
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
    selectedSourceSessionId,
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
