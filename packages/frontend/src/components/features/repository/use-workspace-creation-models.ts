import type {
  AgentModelFavorite,
  RuntimeDescriptor,
  RuntimeKind,
  SettingsSnapshot,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { useEffect, useMemo, useState } from "react";
import type { ModelPickerFavoriteState } from "@/components/features/agents/model-picker";
import { useRuntimeAvailabilityContext } from "@/state/app-state-contexts";
import { useAgentModelFavorites } from "@/state/mutations/use-agent-model-favorites";
import { host } from "@/state/operations/shared/host";
import {
  type RuntimeModelCatalogQueryResource,
  useRuntimeModelCatalogs,
} from "@/state/queries/use-runtime-model-catalogs";
import { errorMessage } from "@/lib/errors";

type RuntimeStartState = {
  key: string;
  ready: RuntimeKind[];
  errors: string[];
  pending: boolean;
};

export type WorkspaceCreationModelSurface = {
  availableRuntimeDefinitions: RuntimeDescriptor[];
  catalogResources: RuntimeModelCatalogQueryResource[];
  favoriteState: ModelPickerFavoriteState;
  isLoadingRuntimeDefinitions: boolean;
  isLoadingCatalog: boolean;
  errors: string[];
  getCatalogForRuntime: (runtimeKind: RuntimeKind) => AgentModelCatalog | null;
  isCatalogLoadingForRuntime: (runtimeKind: RuntimeKind) => boolean;
  retry: () => Promise<void>;
};

export function useWorkspaceCreationModels({
  repoPath,
  active,
  saveAgentModelFavorites,
}: {
  repoPath: string;
  active: boolean;
  saveAgentModelFavorites: (favorites: AgentModelFavorite[]) => Promise<SettingsSnapshot>;
}): WorkspaceCreationModelSurface {
  const runtime = useRuntimeAvailabilityContext();
  const favoriteState = useAgentModelFavorites({ saveAgentModelFavorites });
  const runtimeKinds = useMemo(
    () => runtime.availableRuntimeDefinitions.map((definition) => definition.kind),
    [runtime.availableRuntimeDefinitions],
  );
  const key = `${repoPath}\0${runtimeKinds.join(",")}`;
  const [attempt, setAttempt] = useState(0);
  const [startState, setStartState] = useState<RuntimeStartState>({
    key: "",
    ready: [],
    errors: [],
    pending: false,
  });
  const [retryError, setRetryError] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !repoPath) return;
    let cancelled = false;
    setStartState({ key, ready: [], errors: [], pending: runtimeKinds.length > 0 });
    void Promise.all(
      runtimeKinds.map(async (runtimeKind) => {
        try {
          await host.runtimeEnsure(repoPath, runtimeKind);
          if (!cancelled) {
            setStartState((current) =>
              current.key === key
                ? { ...current, ready: [...current.ready, runtimeKind] }
                : current,
            );
          }
        } catch (cause) {
          if (!cancelled) {
            setStartState((current) =>
              current.key === key
                ? {
                    ...current,
                    errors: [...current.errors, `${runtimeKind}: ${errorMessage(cause)}`],
                  }
                : current,
            );
          }
        }
      }),
    ).then(() => {
      if (!cancelled) {
        setStartState((current) =>
          current.key === key ? { ...current, pending: false } : current,
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [active, attempt, key, repoPath, runtimeKinds]);

  const readyKinds = startState.key === key ? startState.ready : [];
  const { resources } = useRuntimeModelCatalogs({
    repoPath: active && repoPath ? repoPath : null,
    runtimeKinds,
    enabledRuntimeKinds: readyKinds,
    loadRuntimeCatalog: runtime.loadRepoRuntimeCatalog,
  });
  const errors = [
    ...(runtime.runtimeDefinitionsError
      ? [`Runtime definitions: ${runtime.runtimeDefinitionsError}`]
      : []),
    ...(runtime.runtimeSettingsError ? [`Runtime settings: ${runtime.runtimeSettingsError}`] : []),
    ...(startState.key === key ? startState.errors : []),
    ...resources.flatMap((resource) =>
      resource.error ? [`${resource.runtimeKind}: ${resource.error}`] : [],
    ),
    ...(retryError ? [retryError] : []),
  ];

  return {
    availableRuntimeDefinitions: runtime.availableRuntimeDefinitions,
    catalogResources: resources,
    favoriteState,
    isLoadingRuntimeDefinitions:
      runtime.isLoadingRuntimeDefinitions || runtime.isLoadingRuntimeSettings,
    isLoadingCatalog:
      (startState.key === key && startState.pending) ||
      resources.some((resource) => resource.isFetching),
    errors,
    getCatalogForRuntime: (runtimeKind) => {
      const resource = resources.find((candidate) => candidate.runtimeKind === runtimeKind);
      return resource?.isEnabled && !resource.error ? resource.catalog : null;
    },
    isCatalogLoadingForRuntime: (runtimeKind) =>
      resources.find((resource) => resource.runtimeKind === runtimeKind)?.isFetching ?? false,
    retry: async () => {
      setRetryError(null);
      try {
        if (runtime.runtimeDefinitionsError) await runtime.refreshRuntimeDefinitions();
        if (runtime.runtimeSettingsError) await runtime.refreshRuntimeSettings();
        if (startState.errors.length > 0) setAttempt((current) => current + 1);
        await Promise.all(
          resources
            .filter((resource) => resource.isEnabled && resource.error)
            .map((resource) => resource.retry()),
        );
      } catch (cause) {
        setRetryError(errorMessage(cause));
      }
    },
  };
}
