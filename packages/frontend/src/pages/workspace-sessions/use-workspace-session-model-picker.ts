import type { AgentModelSelection, RuntimeKind } from "@openducktor/core";
import { useCallback, useMemo } from "react";
import {
  selectableModelPickerCatalog,
  type ModelPickerRuntime,
  type ModelPickerValue,
} from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import { resolveModelSelectionOptions } from "@openducktor/frontend-core/sessions/model-selection/model-selection-options";
import { useModelSelectionActions } from "@openducktor/frontend-core/sessions/model-selection/use-model-selection-actions";
import { useSpeedControl } from "@openducktor/frontend-core/sessions/model-selection/use-speed-control";
import { withSpeed } from "@openducktor/frontend-core/lib/model-catalog-selection";
import { useRuntimeAvailabilityContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { useAgentModelFavorites } from "@openducktor/frontend-core/sessions/model-selection/use-agent-model-favorites";
import { useRefreshStaleRuntimeCatalog } from "@openducktor/frontend-core/queries/use-runtime-catalog-query";
import { useWorkspaceSessionCreateModel } from "@openducktor/frontend-core/workspace-sessions/create/use-workspace-session-create-model";
import {
  projectWorkspaceModelResources,
  type SessionModelTarget,
} from "./workspace-session-model-resources";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";

/** The props of the model picker, with the favorites of the host. */
function useModelPickerProps({
  runtimes,
  selection,
  sessionRuntimeKind,
  onValueChange,
  onOpenChange,
}: {
  runtimes: ModelPickerRuntime[];
  selection: AgentModelSelection | null;
  /** The runtime of an existing session, which the picker cannot change. */
  sessionRuntimeKind: RuntimeKind | undefined;
  onValueChange: (value: ModelPickerValue) => void;
  onOpenChange: () => void;
}) {
  const host = useHostClient();
  const favoriteState = useAgentModelFavorites({
    saveAgentModelFavorites: host.workspaceUpdateAgentModelFavorites,
  });
  return useMemo(
    () => ({
      runtimes,
      value: selection?.runtimeKind
        ? {
            runtimeKind: selection.runtimeKind,
            providerId: selection.providerId,
            modelId: selection.modelId,
          }
        : null,
      selectionPolicy: sessionRuntimeKind
        ? {
            kind: "runtime_locked" as const,
            runtimeKind: sessionRuntimeKind,
            reason: "An existing session cannot change runtime.",
          }
        : { kind: "editable" as const },
      favoriteState,
      onValueChange,
      onOpenChange,
    }),
    [runtimes, selection, sessionRuntimeKind, favoriteState, onValueChange, onOpenChange],
  );
}

/** The model picker of a new chat, with the repository Default Model. */
export function useWorkspaceSessionCreateModelPicker(
  repoPath: string,
  defaultSelection: AgentModelSelection | null,
) {
  const model = useWorkspaceSessionCreateModel(repoPath, defaultSelection);
  const modelPicker = useModelPickerProps({
    runtimes: model.runtimes,
    selection: model.selection,
    sessionRuntimeKind: undefined,
    onValueChange: model.selectModel,
    onOpenChange: model.onCatalogSelectorOpen,
  });
  return { ...model, modelPicker };
}

/** The model picker of a chat, with the model selection policies of its session. */
export function useWorkspaceSessionModelPicker(repoPath: string, session: SessionModelTarget) {
  const { availableRuntimeDefinitions, allRuntimeDefinitions, loadRepoRuntimeCatalog } =
    useRuntimeAvailabilityContext();
  const liveSession = session.identity != null;
  const selection = session.selection;
  const projected = useMemo(
    () =>
      projectWorkspaceModelResources(allRuntimeDefinitions, availableRuntimeDefinitions, session),
    [allRuntimeDefinitions, availableRuntimeDefinitions, session],
  );
  const { catalog, runtimes, runtimeKind, sessionRuntimeKind, supportsProfiles, isLoading } =
    projected;
  const options = useMemo(
    () =>
      resolveModelSelectionOptions({
        liveSession,
        selectionCatalog: catalog,
        selectedModelSelection: selection,
      }),
    [liveSession, catalog, selection],
  );
  const actions = useModelSelectionActions({
    loadedSessionIdentity: session.identity,
    updateAgentSessionModel: session.update,
    applyDraftSelection: session.updateDraft,
    selectedModelSelection: selection,
    selectionCatalog: catalog,
    selectedRuntimeKind: runtimeKind,
  });
  const { handleSelectModelPair, handleSelectSpeed } = actions;
  const updateSpeed = session.updateSpeed;
  const identity = session.identity;
  const selectSpeed = useCallback(
    async (speed: string) => {
      if (!updateSpeed || !selection) return handleSelectSpeed(speed);
      await updateSpeed(identity, withSpeed(selection, speed));
    },
    [handleSelectSpeed, identity, selection, updateSpeed],
  );
  const speed = useSpeedControl({
    key: identity?.externalSessionId ?? repoPath,
    runtimeKind,
    catalog,
    selection,
    disabled: false,
    onSelect: selectSpeed,
  });
  const onValueChange = useCallback(
    (value: ModelPickerValue) => {
      const runtime = runtimes.find((entry) => entry.descriptor.kind === value.runtimeKind);
      const catalog = selectableModelPickerCatalog(runtime?.resource);
      if (catalog) handleSelectModelPair(value, catalog);
    },
    [runtimes, handleSelectModelPair],
  );
  const refreshRuntimeCatalog = useRefreshStaleRuntimeCatalog(loadRepoRuntimeCatalog);
  const runtimeRef = session.runtimeRef;
  const onCatalogSelectorOpen = useCallback(
    () => refreshRuntimeCatalog(runtimeRef),
    [refreshRuntimeCatalog, runtimeRef],
  );
  const modelPicker = useModelPickerProps({
    runtimes,
    selection,
    sessionRuntimeKind,
    onValueChange,
    onOpenChange: onCatalogSelectorOpen,
  });
  return {
    selection,
    catalog,
    supportsProfiles,
    ...options,
    ...actions,
    isLoading,
    modelPicker,
    speed,
    onCatalogSelectorOpen,
  };
}
