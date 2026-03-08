import { type ReactElement, useEffect, useRef } from "react";
import { SessionStartModal } from "@/components/features/agents";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  buildSessionStartModalDescription,
  buildSessionStartModalTitle,
  toSessionStartPostAction,
  useSessionStartModalCoordinator,
} from "../shared/use-session-start-modal-coordinator";
import type {
  NewSessionStartDecision,
  NewSessionStartRequest,
} from "./use-agent-studio-session-actions";

type AgentStudioSessionStartModalBridgeProps = {
  request: NewSessionStartRequest;
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
  const initializedRequestKeyRef = useRef<string | null>(null);
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
    const requestKey = [
      request.taskId,
      request.role,
      request.scenario,
      request.startMode,
      request.reason,
      request.selectedModel?.providerId ?? "",
      request.selectedModel?.modelId ?? "",
      request.selectedModel?.variant ?? "",
      request.selectedModel?.profileId ?? "",
    ].join(":");
    if (initializedRequestKeyRef.current === requestKey) {
      return;
    }
    initializedRequestKeyRef.current = requestKey;

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
