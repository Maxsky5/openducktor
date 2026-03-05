import type { AgentModelCatalog } from "@openducktor/core";
import { useEffect, useMemo, useState } from "react";
import {
  toModelGroupsByProvider,
  toModelOptions,
  toPrimaryAgentOptions,
} from "@/components/features/agents";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import { errorMessage } from "@/lib/errors";
import { loadRepoOpencodeCatalog } from "@/state/operations";

type UseSettingsModalCatalogStateArgs = {
  open: boolean;
  selectedRepoPath: string | null;
};

export type SettingsModalCatalogState = {
  catalog: AgentModelCatalog | null;
  catalogError: string | null;
  isLoadingCatalog: boolean;
  modelOptions: ComboboxOption[];
  agentOptions: ComboboxOption[];
  modelGroups: ComboboxGroup[];
};

export const useSettingsModalCatalogState = ({
  open,
  selectedRepoPath,
}: UseSettingsModalCatalogStateArgs): SettingsModalCatalogState => {
  const [catalog, setCatalog] = useState<AgentModelCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);

  const modelOptions = useMemo<ComboboxOption[]>(() => toModelOptions(catalog), [catalog]);
  const agentOptions = useMemo<ComboboxOption[]>(() => toPrimaryAgentOptions(catalog), [catalog]);
  const modelGroups = useMemo<ComboboxGroup[]>(() => toModelGroupsByProvider(catalog), [catalog]);

  useEffect(() => {
    if (!open || !selectedRepoPath) {
      setCatalog(null);
      setCatalogError(null);
      setIsLoadingCatalog(false);
      return;
    }

    let cancelled = false;
    setCatalog(null);
    setCatalogError(null);
    setIsLoadingCatalog(true);

    void loadRepoOpencodeCatalog(selectedRepoPath)
      .then((nextCatalog) => {
        if (!cancelled) {
          setCatalog(nextCatalog);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCatalog(null);
          setCatalogError(errorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingCatalog(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, selectedRepoPath]);

  return {
    catalog,
    catalogError,
    isLoadingCatalog,
    modelOptions,
    agentOptions,
    modelGroups,
  };
};
