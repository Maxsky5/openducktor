import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentSessionStartMode } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import type { ComboboxOption } from "@/components/ui/combobox";
import {
  filterRuntimeDefinitionsForStartMode,
  findRuntimeDefinition,
  resolveRuntimeKindSelection,
  toAgentRuntimeOptions,
} from "@/lib/agent-runtime";
import { repoRuntimeCatalogQueryOptions } from "@/state/queries/runtime-catalog";

type UseSessionStartModalRuntimeStateArgs = {
  initialCatalog: AgentModelCatalog | null | undefined;
  isOpen: boolean;
  loadCatalog: (repoPath: string, runtimeKind: RuntimeKind) => Promise<AgentModelCatalog>;
  runtimeDefinitions: RuntimeDescriptor[];
  selectedStartMode: AgentSessionStartMode;
  workspaceRepoPath: string | null;
};

type UseSessionStartModalRuntimeStateResult = {
  catalog: AgentModelCatalog | null;
  isCatalogLoading: boolean;
  eligibleRuntimeDefinitions: RuntimeDescriptor[];
  runtimeOptions: ComboboxOption[];
  selectedRuntimeDescriptor: RuntimeDescriptor | null;
  selectedRuntimeKind: RuntimeKind | null;
  setRequestedRuntimeKind: (runtimeKind: RuntimeKind | null) => void;
};

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

  const setRequestedRuntimeKind = useCallback((runtimeKind: RuntimeKind | null): void => {
    setRequestedRuntimeKindState(runtimeKind);
  }, []);

  const usesInitialCatalog =
    initialCatalog !== undefined &&
    (initialCatalog === null || initialCatalog.runtime?.kind === selectedRuntimeKind);

  const catalogQuery = useQuery({
    ...repoRuntimeCatalogQueryOptions(workspaceRepoPath, selectedRuntimeKind, loadCatalog),
    enabled:
      !usesInitialCatalog && Boolean(workspaceRepoPath) && isOpen && selectedRuntimeKind !== null,
    queryFn: async (): Promise<AgentModelCatalog> => {
      if (!workspaceRepoPath) {
        throw new Error("No repository selected.");
      }
      if (!selectedRuntimeKind) {
        throw new Error("Select a runtime before loading model catalogs.");
      }
      return loadCatalog(workspaceRepoPath, selectedRuntimeKind);
    },
  });

  const catalog = usesInitialCatalog ? initialCatalog : (catalogQuery.data ?? null);
  const isCatalogLoading =
    !usesInitialCatalog && isOpen && workspaceRepoPath !== null && selectedRuntimeKind !== null
      ? catalogQuery.isLoading
      : false;

  return {
    catalog,
    isCatalogLoading,
    eligibleRuntimeDefinitions,
    runtimeOptions,
    selectedRuntimeDescriptor,
    selectedRuntimeKind,
    setRequestedRuntimeKind,
  };
}
