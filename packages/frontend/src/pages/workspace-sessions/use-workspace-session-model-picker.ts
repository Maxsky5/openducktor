import type { AgentModelSelection, RuntimeKind } from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { type ModelPickerValue } from "@/components/features/agents/model-picker";
import { coerceVisibleSelectionToCatalog } from "@/features/model-selection/model-selection-state";
import { resolveModelSelectionOptions } from "@/features/agent-chat-composer/model-selection/model-selection-options";
import { useModelSelectionActions } from "@/features/agent-chat-composer/model-selection/use-model-selection-actions";
import { useRuntimeAvailabilityContext } from "@/state/app-state-contexts";
import { useAgentModelFavorites } from "@/state/mutations/use-agent-model-favorites";
import { host } from "@/state/operations/host";
import { refreshRuntimeCatalogIfStale } from "@/state/queries/runtime-catalog";
import { useRuntimeModelCatalogs } from "@/state/queries/use-runtime-model-catalogs";
import {
  projectWorkspaceModelResources,
  type SessionModelTarget,
} from "./workspace-session-model-resources";

const rejectMissingSessionUpdate = (): never => {
  throw new Error("No existing session is selected.");
};
const noCreationResources = [] as const;

/** Uses the existing model picker and selection policies for both creation and chat. */
export function useWorkspaceSessionModelPicker(
  repoPath: string,
  session?: SessionModelTarget,
  defaultSelection?: AgentModelSelection | null,
) {
  const { availableRuntimeDefinitions, allRuntimeDefinitions, loadRepoRuntimeCatalog } =
    useRuntimeAvailabilityContext();
  const [draftSelection, setDraftSelection] = useState<AgentModelSelection | null>(null);
  const definitions = session ? allRuntimeDefinitions : availableRuntimeDefinitions;
  const runtimeKinds = useMemo(() => definitions.map((entry) => entry.kind), [definitions]);
  const hasSession = session !== undefined;
  const liveSession = session?.identity != null;
  const enabledRuntimeKinds = useMemo(
    () => (hasSession ? [] : runtimeKinds),
    [runtimeKinds, hasSession],
  );
  const { resources } = useRuntimeModelCatalogs({
    repoPath,
    runtimeKinds,
    enabledRuntimeKinds,
    loadRuntimeCatalog: loadRepoRuntimeCatalog,
  });
  const favoriteState = useAgentModelFavorites({
    saveAgentModelFavorites: host.workspaceUpdateAgentModelFavorites,
  });
  const creationDefaultSelection = useMemo(() => {
    const defaultRuntimeKind = defaultSelection?.runtimeKind;
    if (!defaultSelection || !defaultRuntimeKind) {
      return null;
    }
    const defaultCatalog =
      resources.find((entry) => entry.runtimeKind === defaultRuntimeKind)?.catalog ?? null;
    if (!defaultCatalog) {
      return null;
    }
    return coerceVisibleSelectionToCatalog(defaultCatalog, defaultSelection);
  }, [defaultSelection, resources]);
  const selection = session ? session.selection : (draftSelection ?? creationDefaultSelection);
  const creationResources = session ? noCreationResources : resources;
  const projected = useMemo(
    () => projectWorkspaceModelResources(definitions, creationResources, selection, session),
    [definitions, creationResources, selection, session],
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
    loadedSessionIdentity: session?.identity ?? null,
    updateAgentSessionModel: session?.update ?? rejectMissingSessionUpdate,
    applyDraftSelection: session?.updateDraft ?? setDraftSelection,
    selectedModelSelection: selection,
    selectionCatalog: catalog,
    selectedRuntimeKind: runtimeKind,
  });
  const { handleSelectModelPair } = actions;
  const onValueChange = useCallback(
    (value: ModelPickerValue) => {
      const runtime = runtimes.find((entry) => entry.descriptor.kind === value.runtimeKind);
      if (runtime?.resource.status === "ready" || runtime?.resource.status === "refreshing")
        handleSelectModelPair(value, runtime.resource.catalog);
    },
    [runtimes, handleSelectModelPair],
  );
  const queryClient = useQueryClient();
  const refreshRuntimeCatalog = useCallback(
    (runtimeKind: RuntimeKind) => {
      refreshRuntimeCatalogIfStale(
        queryClient,
        { repoPath, runtimeKind, workingDirectory: repoPath },
        loadRepoRuntimeCatalog,
      );
    },
    [loadRepoRuntimeCatalog, queryClient, repoPath],
  );
  const onCatalogSelectorOpen = useCallback(() => {
    if (session?.runtimeRef) {
      refreshRuntimeCatalogIfStale(queryClient, session.runtimeRef, loadRepoRuntimeCatalog);
      return;
    }
    if (selection?.runtimeKind) {
      refreshRuntimeCatalog(selection.runtimeKind);
      return;
    }
    for (const runtimeKind of runtimeKinds) {
      refreshRuntimeCatalog(runtimeKind);
    }
  }, [
    loadRepoRuntimeCatalog,
    queryClient,
    refreshRuntimeCatalog,
    runtimeKinds,
    selection?.runtimeKind,
    session?.runtimeRef,
  ]);
  const modelPicker = useMemo(
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
      onOpenChange: onCatalogSelectorOpen,
    }),
    [runtimes, selection, sessionRuntimeKind, favoriteState, onValueChange, onCatalogSelectorOpen],
  );
  return {
    selection,
    catalog,
    supportsProfiles,
    ...options,
    ...actions,
    isLoading,
    modelPicker,
    onCatalogSelectorOpen,
  };
}
