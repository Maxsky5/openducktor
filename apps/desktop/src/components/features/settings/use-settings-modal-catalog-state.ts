import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { useEffect, useMemo, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { loadRepoRuntimeCatalog } from "@/state/operations";

type UseSettingsModalCatalogStateArgs = {
  open: boolean;
  selectedRepoPath: string | null;
  runtimeDefinitions: RuntimeDescriptor[];
};

export type SettingsModalCatalogState = {
  catalogsByRuntime: Record<string, AgentModelCatalog | null>;
  catalogErrorsByRuntime: Record<string, string | null>;
  isLoadingCatalog: boolean;
  loadingRuntimeKinds: RuntimeKind[];
  getCatalogForRuntime: (runtimeKind: RuntimeKind) => AgentModelCatalog | null;
  getCatalogErrorForRuntime: (runtimeKind: RuntimeKind) => string | null;
  isCatalogLoadingForRuntime: (runtimeKind: RuntimeKind) => boolean;
};

export const useSettingsModalCatalogState = ({
  open,
  selectedRepoPath,
  runtimeDefinitions,
}: UseSettingsModalCatalogStateArgs): SettingsModalCatalogState => {
  const [catalogsByRuntime, setCatalogsByRuntime] = useState<
    Record<string, AgentModelCatalog | null>
  >({});
  const [catalogErrorsByRuntime, setCatalogErrorsByRuntime] = useState<
    Record<string, string | null>
  >({});
  const [loadingRuntimeKinds, setLoadingRuntimeKinds] = useState<RuntimeKind[]>([]);
  const runtimeKinds = useMemo(
    () => runtimeDefinitions.map((definition) => definition.kind),
    [runtimeDefinitions],
  );

  useEffect(() => {
    if (!open || !selectedRepoPath || runtimeKinds.length === 0) {
      setCatalogsByRuntime({});
      setCatalogErrorsByRuntime({});
      setLoadingRuntimeKinds([]);
      return;
    }

    let cancelled = false;
    setCatalogErrorsByRuntime({});
    setLoadingRuntimeKinds(runtimeKinds);

    for (const runtimeKind of runtimeKinds) {
      void loadRepoRuntimeCatalog(selectedRepoPath, runtimeKind)
        .then((nextCatalog) => {
          if (cancelled) {
            return;
          }
          setCatalogsByRuntime((current) => ({
            ...current,
            [runtimeKind]: nextCatalog,
          }));
          setCatalogErrorsByRuntime((current) => ({
            ...current,
            [runtimeKind]: null,
          }));
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return;
          }
          setCatalogsByRuntime((current) => ({
            ...current,
            [runtimeKind]: null,
          }));
          setCatalogErrorsByRuntime((current) => ({
            ...current,
            [runtimeKind]: errorMessage(error),
          }));
        })
        .finally(() => {
          if (!cancelled) {
            setLoadingRuntimeKinds((current) => current.filter((entry) => entry !== runtimeKind));
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [open, runtimeKinds, selectedRepoPath]);

  return {
    catalogsByRuntime,
    catalogErrorsByRuntime,
    isLoadingCatalog: loadingRuntimeKinds.length > 0,
    loadingRuntimeKinds,
    getCatalogForRuntime: (runtimeKind) => catalogsByRuntime[runtimeKind] ?? null,
    getCatalogErrorForRuntime: (runtimeKind) => catalogErrorsByRuntime[runtimeKind] ?? null,
    isCatalogLoadingForRuntime: (runtimeKind) => loadingRuntimeKinds.includes(runtimeKind),
  };
};
