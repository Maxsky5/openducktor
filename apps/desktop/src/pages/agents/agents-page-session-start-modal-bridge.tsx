import { type ReactElement, useEffect, useRef } from "react";
import { SessionStartModal } from "@/components/features/agents";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  buildSessionStartModalDescription,
  buildSessionStartModalTitle,
  toSessionStartPostAction,
  useSessionStartModalCoordinator,
} from "../shared/use-session-start-modal-coordinator";
import type { NewSessionStartDecision } from "./use-agent-studio-session-actions";
import type { PendingSessionStartRequest } from "./use-agent-studio-session-start-request";

type AgentStudioSessionStartModalBridgeProps = {
  request: PendingSessionStartRequest;
  activeRepo: string | null;
  repoSettings: RepoSettingsInput | null;
  onResolve: (decision: NewSessionStartDecision) => void;
};

export function AgentStudioSessionStartModalBridge({
  request,
  activeRepo,
  repoSettings,
  onResolve,
}: AgentStudioSessionStartModalBridgeProps): ReactElement {
  const openedRequestIdRef = useRef<string | null>(null);
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

  useEffect(() => {
    if (openedRequestIdRef.current === request.requestId) {
      return;
    }
    openedRequestIdRef.current = request.requestId;

    openStartModal({
      source: "agent_studio",
      taskId: request.taskId,
      role: request.role,
      scenario: request.scenario,
      startMode: request.startMode,
      selectedModel: request.selectedModel,
      postStartAction: toSessionStartPostAction(request.reason),
    });
  }, [openStartModal, request]);

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
            onResolve(null);
          }
        },
        onConfirm: (_runInBackground) => {
          onResolve({ selectedModel: selection ?? null });
        },
      }}
    />
  );
}
