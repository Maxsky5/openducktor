import {
  type AgentRuntimePreviewModelsInput,
  type AgentRuntimes,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeKind,
} from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentRuntimeCatalog,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { type UseQueryResult, useQueries, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { readRuntimeKindReadiness, type RuntimeReadinessSnapshot } from "@/lib/runtime-readiness";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import { useHostRuntimeStatusContext } from "@/state/app-state-contexts";
import {
  catalogQueryOptions,
  RUNTIME_CATALOG_STALE_TIME_MS,
  type CachedRuntimeCatalog,
  resolveRuntimeModelCatalogSurface,
  retryCatalogRead,
  retryRuntimeCatalog,
  runtimeCatalogQueryOptions,
  skippedRuntimeCatalogQueryOptions,
} from "./runtime-catalog";
import { skippedQueryOptions, SKIPPED_QUERY_KEY_SEGMENT } from "./skipped-query";
import { useRuntimeCatalogQuery } from "./use-runtime-catalog-query";

/** The model catalog of one runtime, as a view shows it. */
export type RuntimeModelCatalogResource = {
  catalog: AgentModelCatalog | null;
  /** No catalog is shown yet, and a read runs or waits for the runtime to become ready. */
  isLoading: boolean;
  isEnabled: boolean;
  error: string | null;
  /** Why a live read cannot run, such as a runtime that failed to start. */
  unavailableReason: string | null;
  retry: () => Promise<void>;
};

export type RuntimeModelCatalogQueryResource = RuntimeModelCatalogResource & {
  runtimeKind: RuntimeKind;
};

type CatalogQueryScope = {
  repoPath: string | null;
  runtimeKinds: readonly RuntimeKind[];
  enabledRuntimeKinds: readonly RuntimeKind[];
};

type LiveCatalogSource = {
  loadRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>;
  loadPreviewModels?: never;
  agentRuntimes?: never;
};

type PreviewCatalogSource = {
  loadRuntimeCatalog?: never;
  loadPreviewModels: (input: AgentRuntimePreviewModelsInput) => Promise<AgentRuntimeCatalog>;
  agentRuntimes: AgentRuntimes;
};

type UseRuntimeModelCatalogsArgs = CatalogQueryScope & (LiveCatalogSource | PreviewCatalogSource);

const PREVIEW_READINESS: RuntimeReadinessSnapshot = { state: "ready", message: null };

const sourceQueryOptions = (
  repoPath: string,
  runtimeKind: RuntimeKind,
  source: LiveCatalogSource | PreviewCatalogSource,
) => {
  if (source.loadPreviewModels) {
    return catalogQueryOptions(
      [
        "workspace-model-preview",
        normalizeWorkingDirectory(repoPath),
        runtimeKind,
        source.agentRuntimes[runtimeKind].executablePath,
      ],
      () => source.loadPreviewModels({ repoPath, runtimeKind }),
    );
  }
  return runtimeCatalogQueryOptions(
    { repoPath, runtimeKind, workingDirectory: repoPath },
    source.loadRuntimeCatalog,
  );
};

const skippedSourceQueryOptions = (
  runtimeKind: RuntimeKind,
  source: LiveCatalogSource | PreviewCatalogSource,
) => {
  if (source.loadPreviewModels) {
    return skippedQueryOptions<CachedRuntimeCatalog>({
      queryKey: ["workspace-model-preview", SKIPPED_QUERY_KEY_SEGMENT, runtimeKind],
      staleTime: RUNTIME_CATALOG_STALE_TIME_MS,
    });
  }
  return skippedRuntimeCatalogQueryOptions();
};

/**
 * Reads the model catalog of one runtime directory, with the same loading and error rules as
 * `useRuntimeModelCatalogs`.
 */
export function useRuntimeModelCatalogQuery({
  runtimeRef,
  loadRuntimeCatalog,
  enabled = true,
}: {
  runtimeRef: RuntimeWorkingDirectoryRef | null;
  loadRuntimeCatalog: LiveCatalogSource["loadRuntimeCatalog"];
  enabled?: boolean;
}): RuntimeModelCatalogResource {
  const queryClient = useQueryClient();
  const runtimeStatus = useHostRuntimeStatusContext();
  const query = useRuntimeCatalogQuery({ runtimeRef, loadRuntimeCatalog, enabled });
  const runtimeKind = runtimeRef?.runtimeKind ?? null;
  const readiness = useMemo(
    () =>
      runtimeKind
        ? readRuntimeKindReadiness(runtimeStatus, RUNTIME_DESCRIPTORS_BY_KIND[runtimeKind])
        : null,
    [runtimeKind, runtimeStatus],
  );
  const retry = useCallback(async (): Promise<void> => {
    if (runtimeRef === null) {
      throw new Error("A runtime is required to retry the model catalog.");
    }
    await retryRuntimeCatalog({ queryClient, runtimeRef, loadRuntimeCatalog });
  }, [loadRuntimeCatalog, queryClient, runtimeRef]);
  const isEnabled = enabled && runtimeRef !== null;
  return useMemo(
    () => toRuntimeModelCatalogResource({ query, readiness, isEnabled, retry }),
    [isEnabled, query, readiness, retry],
  );
}

export function useRuntimeModelCatalogs(args: UseRuntimeModelCatalogsArgs) {
  const { repoPath, runtimeKinds, enabledRuntimeKinds } = args;
  const runtimeStatus = useHostRuntimeStatusContext();
  const source = useMemo<LiveCatalogSource | PreviewCatalogSource>(() => {
    if (args.loadPreviewModels) {
      return { loadPreviewModels: args.loadPreviewModels, agentRuntimes: args.agentRuntimes };
    }
    return { loadRuntimeCatalog: args.loadRuntimeCatalog };
  }, [args.loadPreviewModels, args.agentRuntimes, args.loadRuntimeCatalog]);
  const queryClient = useQueryClient();
  const hasRepoPath = source.loadPreviewModels ? Boolean(repoPath) : repoPath !== null;
  const uniqueRuntimeKinds = useMemo(() => Array.from(new Set(runtimeKinds)), [runtimeKinds]);
  const enabledRuntimeKindSet = useMemo(() => new Set(enabledRuntimeKinds), [enabledRuntimeKinds]);
  // A preview read does not use the shared runtime, so only live reads wait for it.
  const readinessByRuntime = useMemo(
    () =>
      uniqueRuntimeKinds.map((runtimeKind) =>
        source.loadPreviewModels
          ? PREVIEW_READINESS
          : readRuntimeKindReadiness(runtimeStatus, RUNTIME_DESCRIPTORS_BY_KIND[runtimeKind]),
      ),
    [runtimeStatus, source, uniqueRuntimeKinds],
  );
  const catalogQueries = useQueries({
    queries: uniqueRuntimeKinds.map((runtimeKind, index) => {
      return {
        ...(repoPath
          ? sourceQueryOptions(repoPath, runtimeKind, source)
          : skippedSourceQueryOptions(runtimeKind, source)),
        enabled:
          hasRepoPath &&
          enabledRuntimeKindSet.has(runtimeKind) &&
          readinessByRuntime[index]?.state === "ready",
      };
    }),
  });

  const resources = useMemo<RuntimeModelCatalogQueryResource[]>(
    () =>
      uniqueRuntimeKinds.map((runtimeKind, index) => {
        const query = catalogQueries[index];
        if (!query) {
          throw new Error(`Missing model catalog query for runtime '${runtimeKind}'.`);
        }
        const retry = async (): Promise<void> => {
          if (!repoPath && source.loadPreviewModels) {
            throw new Error("Choose a repository before retrying its models.");
          }
          if (repoPath === null) {
            throw new Error("A repository path is required to retry the model catalog.");
          }
          await retryCatalogRead(queryClient, sourceQueryOptions(repoPath, runtimeKind, source));
        };
        return {
          runtimeKind,
          ...toRuntimeModelCatalogResource({
            query,
            readiness: readinessByRuntime[index] ?? null,
            isEnabled: hasRepoPath && enabledRuntimeKindSet.has(runtimeKind),
            retry,
          }),
        };
      }),
    [
      catalogQueries,
      enabledRuntimeKindSet,
      hasRepoPath,
      queryClient,
      readinessByRuntime,
      repoPath,
      source,
      uniqueRuntimeKinds,
    ],
  );

  return { resources } satisfies { resources: RuntimeModelCatalogQueryResource[] };
}

/**
 * Builds what a view shows for one model catalog read. A runtime that is not ready hides an
 * earlier read error, so the view offers no retry that the runtime cannot serve.
 */
const toRuntimeModelCatalogResource = ({
  query,
  readiness,
  isEnabled,
  retry,
}: {
  query: Pick<UseQueryResult<CachedRuntimeCatalog, Error>, "data" | "error" | "isFetching">;
  readiness: RuntimeReadinessSnapshot | null;
  isEnabled: boolean;
  retry: () => Promise<void>;
}): RuntimeModelCatalogResource => {
  const surface = resolveRuntimeModelCatalogSurface(query.data?.models, query.error);
  const isWaitingForRuntime = readiness?.state === "checking";
  return {
    catalog: surface.catalog,
    isLoading: isEnabled && surface.catalog === null && (query.isFetching || isWaitingForRuntime),
    isEnabled,
    error: readiness?.state === "ready" ? surface.error : null,
    unavailableReason: readiness?.state === "blocked" ? readiness.message : null,
    retry,
  };
};
