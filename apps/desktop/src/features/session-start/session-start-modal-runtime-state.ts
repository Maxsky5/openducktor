import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import type { ComboboxOption } from "@/components/ui/combobox";
import {
  DEFAULT_RUNTIME_KIND,
  findRuntimeDefinition,
  resolveRuntimeKindSelection,
  toAgentRuntimeOptions,
} from "@/lib/agent-runtime";
import { repoRuntimeCatalogQueryOptions } from "@/state/queries/runtime-catalog";

type UseSessionStartModalRuntimeStateArgs = {
  activeRepo: string | null;
  initialCatalog: AgentModelCatalog | null | undefined;
  isOpen: boolean;
  loadCatalog: (repoPath: string, runtimeKind: RuntimeKind) => Promise<AgentModelCatalog>;
  runtimeDefinitions: RuntimeDescriptor[];
};

type UseSessionStartModalRuntimeStateResult = {
  catalog: AgentModelCatalog | null;
  isCatalogLoading: boolean;
  runtimeOptions: ComboboxOption[];
  selectedRuntimeDescriptor: RuntimeDescriptor | null;
  selectedRuntimeKind: RuntimeKind;
  setRequestedRuntimeKind: (runtimeKind: RuntimeKind) => void;
};

export function useSessionStartModalRuntimeState({
  activeRepo,
  initialCatalog,
  isOpen,
  loadCatalog,
  runtimeDefinitions,
}: UseSessionStartModalRuntimeStateArgs): UseSessionStartModalRuntimeStateResult {
  const [requestedRuntimeKind, setRequestedRuntimeKindState] =
    useState<RuntimeKind>(DEFAULT_RUNTIME_KIND);

  const runtimeOptions = useMemo(
    () => toAgentRuntimeOptions(runtimeDefinitions),
    [runtimeDefinitions],
  );

  const selectedRuntimeKind = useMemo(
    () =>
      resolveRuntimeKindSelection({
        runtimeDefinitions,
        requestedRuntimeKind,
      }),
    [requestedRuntimeKind, runtimeDefinitions],
  );

  const selectedRuntimeDescriptor = useMemo(
    () => findRuntimeDefinition(runtimeDefinitions, selectedRuntimeKind),
    [runtimeDefinitions, selectedRuntimeKind],
  );

  const setRequestedRuntimeKind = useCallback(
    (runtimeKind: RuntimeKind): void => {
      setRequestedRuntimeKindState(
        resolveRuntimeKindSelection({
          runtimeDefinitions,
          requestedRuntimeKind: runtimeKind,
        }),
      );
    },
    [runtimeDefinitions],
  );

  const catalogQuery = useQuery({
    ...repoRuntimeCatalogQueryOptions(activeRepo ?? "", selectedRuntimeKind, loadCatalog),
    enabled: initialCatalog === undefined && Boolean(activeRepo) && isOpen,
    queryFn: async (): Promise<AgentModelCatalog> => {
      if (!activeRepo) {
        throw new Error("No repository selected.");
      }
      return loadCatalog(activeRepo, selectedRuntimeKind);
    },
  });

  const catalog = initialCatalog ?? catalogQuery.data ?? null;
  const isCatalogLoading =
    initialCatalog === undefined && isOpen && activeRepo !== null ? catalogQuery.isLoading : false;

  return {
    catalog,
    isCatalogLoading,
    runtimeOptions,
    selectedRuntimeDescriptor,
    selectedRuntimeKind,
    setRequestedRuntimeKind,
  };
}
