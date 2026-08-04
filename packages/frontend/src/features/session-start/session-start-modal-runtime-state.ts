import type { RepoRuntimeRef, RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
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
import { errorMessage } from "@/lib/errors";
import { repoRuntimeReadinessTargetForRuntime } from "@/lib/repo-runtime-readiness";
import { useRepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import {
  RUNTIME_CATALOG_STALE_TIME_MS,
  runtimeCatalogQueryKeys,
  sessionStartRuntimeCatalogQueryOptions,
} from "@/state/queries/runtime-catalog";
import { skippedQueryOptions } from "@/state/queries/skipped-query";

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
  catalogError: string | null;
  isCatalogLoading: boolean;
  eligibleRuntimeDefinitions: RuntimeDescriptor[];
  runtimeOptions: ComboboxOption[];
  selectedRuntimeDescriptor: RuntimeDescriptor | null;
  selectedRuntimeKind: RuntimeKind | null;
  setRequestedRuntimeKind: (runtimeKind: RuntimeKind | null) => void;
};

const skippedSessionStartCatalogQueryOptions = (runtimeRef: RepoRuntimeRef | null) =>
  skippedQueryOptions<AgentModelCatalog>({
    queryKey: runtimeRef
      ? runtimeCatalogQueryKeys.repoSessionStart(runtimeRef.repoPath, runtimeRef.runtimeKind)
      : runtimeCatalogQueryKeys.all,
    staleTime: RUNTIME_CATALOG_STALE_TIME_MS,
  });

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

  const usesInitialCatalog =
    initialCatalog !== undefined &&
    (initialCatalog === null || initialCatalog.runtime?.kind === selectedRuntimeKind);
  const selectedRepoRuntimeRef = useMemo<RepoRuntimeRef | null>(() => {
    if (!workspaceRepoPath || !selectedRuntimeKind) {
      return null;
    }
    return {
      repoPath: workspaceRepoPath,
      runtimeKind: selectedRuntimeKind,
    };
  }, [selectedRuntimeKind, workspaceRepoPath]);

  const canLoadCatalog = selectedRuntimeReadiness.state === "ready";
  const isWaitingForRuntime = selectedRuntimeReadiness.state === "checking";
  const catalogQuery = useQuery(
    !usesInitialCatalog && selectedRepoRuntimeRef && isOpen && canLoadCatalog
      ? sessionStartRuntimeCatalogQueryOptions(selectedRepoRuntimeRef, loadCatalog)
      : skippedSessionStartCatalogQueryOptions(selectedRepoRuntimeRef),
  );

  const catalog = usesInitialCatalog ? initialCatalog : (catalogQuery.data ?? null);
  const catalogError =
    !usesInitialCatalog && catalogQuery.error ? errorMessage(catalogQuery.error) : null;
  const isCatalogLoading =
    !usesInitialCatalog && isOpen && workspaceRepoPath !== null && selectedRuntimeKind !== null
      ? isWaitingForRuntime || catalogQuery.isLoading
      : false;

  return {
    catalog,
    catalogError,
    isCatalogLoading,
    eligibleRuntimeDefinitions,
    runtimeOptions,
    selectedRuntimeDescriptor,
    selectedRuntimeKind,
    setRequestedRuntimeKind,
  };
}
