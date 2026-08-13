import type { RepoRuntimeRef, RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentSessionStartMode } from "@openducktor/core";
import { useCallback, useMemo, useState } from "react";
import type { ComboboxOption } from "@/components/ui/combobox";
import {
  filterRuntimeDefinitionsForStartMode,
  findRuntimeDefinition,
  resolveRuntimeKindSelection,
  toAgentRuntimeOptions,
} from "@/lib/agent-runtime";
import { repoRuntimeReadinessTargetForRuntime } from "@/lib/repo-runtime-readiness";
import { useRepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import {
  type RuntimeModelCatalogResource,
  useRuntimeModelCatalogs,
} from "@/state/queries/use-runtime-model-catalogs";

type UseSessionStartModalRuntimeStateArgs = {
  initialCatalog: AgentModelCatalog | null | undefined;
  isOpen: boolean;
  loadCatalog: (runtimeRef: RepoRuntimeRef) => Promise<AgentModelCatalog>;
  runtimeDefinitions: RuntimeDescriptor[];
  selectedStartMode: AgentSessionStartMode;
  workspaceRepoPath: string | null;
};

type UseSessionStartModalRuntimeStateResult = {
  catalog: AgentModelCatalog | null;
  catalogResources: RuntimeModelCatalogResource[];
  catalogError: string | null;
  isCatalogLoading: boolean;
  eligibleRuntimeDefinitions: RuntimeDescriptor[];
  runtimeOptions: ComboboxOption[];
  selectedRuntimeDescriptor: RuntimeDescriptor | null;
  selectedRuntimeKind: RuntimeKind | null;
  setRequestedRuntimeKind: (runtimeKind: RuntimeKind | null) => void;
};

const EMPTY_RUNTIME_KINDS: RuntimeKind[] = [];

export function useSessionStartModalRuntimeState({
  initialCatalog,
  isOpen,
  loadCatalog,
  runtimeDefinitions,
  selectedStartMode,
  workspaceRepoPath,
}: UseSessionStartModalRuntimeStateArgs): UseSessionStartModalRuntimeStateResult {
  const [requestedRuntimeKind, setRequestedRuntimeKindState] = useState<RuntimeKind | null>(null);
  const eligibleRuntimeDefinitions = useMemo(
    () => filterRuntimeDefinitionsForStartMode(runtimeDefinitions, selectedStartMode),
    [runtimeDefinitions, selectedStartMode],
  );
  const runtimeOptions = useMemo(
    () => toAgentRuntimeOptions(eligibleRuntimeDefinitions),
    [eligibleRuntimeDefinitions],
  );
  const selectedRuntimeKind = useMemo(
    () =>
      resolveRuntimeKindSelection({
        runtimeDefinitions: eligibleRuntimeDefinitions,
        requestedRuntimeKind,
      }),
    [requestedRuntimeKind, eligibleRuntimeDefinitions],
  );
  const selectedRuntimeDescriptor = useMemo(
    () =>
      selectedRuntimeKind
        ? findRuntimeDefinition(eligibleRuntimeDefinitions, selectedRuntimeKind)
        : null,
    [eligibleRuntimeDefinitions, selectedRuntimeKind],
  );
  const selectedRuntimeReadiness = useRepoRuntimeReadiness({
    hasWorkspace: workspaceRepoPath !== null,
    runtimeTarget: repoRuntimeReadinessTargetForRuntime(selectedRuntimeKind),
  });
  const setRequestedRuntimeKind = useCallback((runtimeKind: RuntimeKind | null): void => {
    setRequestedRuntimeKindState(runtimeKind);
  }, []);
  const eligibleRuntimeKinds = useMemo(
    () => eligibleRuntimeDefinitions.map((runtime) => runtime.kind),
    [eligibleRuntimeDefinitions],
  );
  const usesInitialCatalog =
    initialCatalog !== undefined &&
    (initialCatalog === null || initialCatalog.runtime?.kind === selectedRuntimeKind);
  const canLoadCatalog = selectedRuntimeReadiness.state === "ready";
  const enabledRuntimeKinds = useMemo(() => {
    if (!isOpen || selectedStartMode === "reuse" || !canLoadCatalog) {
      return EMPTY_RUNTIME_KINDS;
    }
    if (!usesInitialCatalog || !selectedRuntimeKind) {
      return eligibleRuntimeKinds;
    }
    return eligibleRuntimeKinds.filter((runtimeKind) => runtimeKind !== selectedRuntimeKind);
  }, [
    canLoadCatalog,
    eligibleRuntimeKinds,
    isOpen,
    selectedRuntimeKind,
    selectedStartMode,
    usesInitialCatalog,
  ]);
  const { resources } = useRuntimeModelCatalogs({
    repoPath: workspaceRepoPath,
    runtimeKinds: eligibleRuntimeKinds,
    enabledRuntimeKinds,
    loadCatalog,
  });
  const catalogResources = useMemo(
    () =>
      resources.map((resource) =>
        usesInitialCatalog && resource.runtimeKind === selectedRuntimeKind
          ? {
              ...resource,
              catalog: initialCatalog ?? null,
              isLoading: false,
              error: null,
            }
          : resource,
      ),
    [initialCatalog, resources, selectedRuntimeKind, usesInitialCatalog],
  );
  const selectedResource =
    catalogResources.find((resource) => resource.runtimeKind === selectedRuntimeKind) ?? null;
  const isWaitingForRuntime = selectedRuntimeReadiness.state === "checking";

  return {
    catalog: selectedResource?.catalog ?? null,
    catalogResources,
    catalogError: selectedResource?.error ?? null,
    isCatalogLoading:
      isOpen && selectedStartMode !== "reuse" && selectedRuntimeKind !== null
        ? isWaitingForRuntime || (selectedResource?.isLoading ?? false)
        : false,
    eligibleRuntimeDefinitions,
    runtimeOptions,
    selectedRuntimeDescriptor,
    selectedRuntimeKind,
    setRequestedRuntimeKind,
  };
}
