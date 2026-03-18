import { type ReactElement, useEffect, useRef } from "react";
import { SessionStartModal } from "@/components/features/agents";
import {
  buildSessionStartModalDescription,
  buildSessionStartModalTitle,
  type SessionStartModalOpenRequest,
  toSessionStartPostAction,
  useSessionStartModalCoordinator,
} from "@/features/session-start";
import type { RepoSettingsInput } from "@/types/state-slices";
import type { NewSessionStartDecision } from "../use-agent-studio-session-actions";
import type { PendingSessionStartRequest } from "./use-agent-studio-session-start-request";

type AgentStudioSessionStartModalBridgeProps = {
  request: PendingSessionStartRequest;
  activeRepo: string | null;
  repoSettings: RepoSettingsInput | null;
  onResolve: (decision: NewSessionStartDecision) => void;
};

type UseSessionStartModalRequestActivationArgs = {
  request: PendingSessionStartRequest;
  openStartModal: (request: SessionStartModalOpenRequest) => void;
};

export function useSessionStartModalRequestActivation({
  request,
  openStartModal,
}: UseSessionStartModalRequestActivationArgs): void {
  const openedRequestIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (openedRequestIdRef.current === request.requestId) {
      return;
    }
    const nextRequestId = request.requestId;
    openStartModal({
      source: "agent_studio",
      taskId: request.taskId,
      role: request.role,
      scenario: request.scenario,
      startMode: request.startMode,
      selectedModel: request.selectedModel,
      postStartAction: toSessionStartPostAction(request.reason),
    });
    openedRequestIdRef.current = nextRequestId;
  }, [openStartModal, request]);
}

export function AgentStudioSessionStartModalBridge({
  request,
  activeRepo,
  repoSettings,
  onResolve,
}: AgentStudioSessionStartModalBridgeProps): ReactElement {
  const activeRequestIdRef = useRef(request.requestId);
  const resolvedRequestIdRef = useRef<string | null>(null);
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
    openStartModal,
    closeStartModal,
    handleSelectRuntime,
    handleSelectAgent,
    handleSelectModel,
    handleSelectVariant,
  } = useSessionStartModalCoordinator({
    activeRepo,
    repoSettings,
  });

  useSessionStartModalRequestActivation({ request, openStartModal });

  if (activeRequestIdRef.current !== request.requestId) {
    activeRequestIdRef.current = request.requestId;
    resolvedRequestIdRef.current = null;
  }

  const resolveDecision = (decision: NewSessionStartDecision): void => {
    if (resolvedRequestIdRef.current === request.requestId) {
      return;
    }
    resolvedRequestIdRef.current = request.requestId;
    onResolve(decision);
  };

  return (
    <SessionStartModal
      model={{
        open: isOpen,
        title: intent?.title ?? buildSessionStartModalTitle(request.role),
        description:
          intent?.description ??
          buildSessionStartModalDescription({
            scenario: request.scenario,
            startMode: request.startMode,
          }),
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
        onSelectRuntime: handleSelectRuntime,
        onSelectAgent: handleSelectAgent,
        onSelectModel: handleSelectModel,
        onSelectVariant: handleSelectVariant,
        allowRunInBackground: false,
        isStarting: false,
        onOpenChange: (nextOpen) => {
          if (!nextOpen) {
            closeStartModal();
            resolveDecision(null);
          }
        },
        onConfirm: (_runInBackground) => {
          resolvedRequestIdRef.current = request.requestId;
          closeStartModal();
          onResolve({ selectedModel: selection ?? null });
        },
      }}
    />
  );
}
