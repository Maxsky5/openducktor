import {
  type AgentModelFavorite,
  agentModelFavoriteKey,
  isSameAgentModelFavorite,
  type RuntimeDescriptor,
  type RuntimeKind,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { resolveSavedModelAlias } from "../../lib/model-catalog-selection";
import type { RuntimeModelCatalogResource } from "../../queries/use-runtime-model-catalogs";

export type ModelPickerValue = AgentModelFavorite;
export type ModelPickerView = "favorites" | RuntimeKind;

export type ModelPickerCatalogResource =
  | {
      status: "loading";
      catalog: null;
      retry: () => Promise<void>;
    }
  | {
      status: "ready";
      catalog: AgentModelCatalog;
    }
  | {
      status: "failed";
      catalog: AgentModelCatalog | null;
      error: string;
      retry: () => Promise<void>;
    }
  | {
      status: "unavailable";
      catalog: null;
      reason: string;
    };

/** A failed refresh keeps its last catalog selectable. */
export const selectableModelPickerCatalog = (
  resource: ModelPickerCatalogResource | undefined,
): AgentModelCatalog | null =>
  resource?.status === "ready" || resource?.status === "failed" ? resource.catalog : null;

type ModelPickerCatalogResourceInput = {
  catalog: AgentModelCatalog | null;
  /** No catalog is shown yet, and a read runs or waits for the runtime. */
  isLoading: boolean;
  error: string | null;
  isAvailable: boolean;
  unavailableReason: string;
  retry?: () => Promise<void>;
};

const requiredRetry = (retry: (() => Promise<void>) | undefined): (() => Promise<void>) => {
  if (!retry) {
    throw new Error("A loading or failed model catalog must provide a retry action.");
  }
  return retry;
};

export const unavailableModelPickerCatalogResource = (
  reason: string,
): ModelPickerCatalogResource => ({
  status: "unavailable",
  catalog: null,
  reason,
});

/** A cached catalog stays ready during a background refresh. `isLoading` covers only a first read. */
export const toModelPickerCatalogResource = ({
  catalog,
  isLoading,
  error,
  isAvailable,
  unavailableReason,
  retry,
}: ModelPickerCatalogResourceInput): ModelPickerCatalogResource => {
  if (!isAvailable) {
    return unavailableModelPickerCatalogResource(unavailableReason);
  }
  if (isLoading) {
    return { status: "loading", catalog: null, retry: requiredRetry(retry) };
  }
  if (error) {
    return { status: "failed", catalog, error, retry: requiredRetry(retry) };
  }
  if (!catalog) {
    return unavailableModelPickerCatalogResource(unavailableReason);
  }
  return { status: "ready", catalog };
};

/** A runtime that cannot serve its catalog shows its own reason, such as a failed start. */
export const modelPickerResourceFromCatalogQuery = (
  resource: RuntimeModelCatalogResource | undefined,
  unavailableReason = "This runtime catalog is not available yet.",
): ModelPickerCatalogResource =>
  resource
    ? toModelPickerCatalogResource({
        catalog: resource.catalog,
        isLoading: resource.isLoading,
        error: resource.error,
        isAvailable: resource.isEnabled,
        unavailableReason: resource.unavailableReason ?? unavailableReason,
        retry: resource.retry,
      })
    : unavailableModelPickerCatalogResource(unavailableReason);

export type ModelPickerRuntime = {
  descriptor: RuntimeDescriptor;
  resource: ModelPickerCatalogResource;
  isEnabledForFavorites: boolean;
  disabledReason?: string | null;
};

export type ModelPickerFavoriteState = {
  favorites: AgentModelFavorite[] | null;
  isLoading: boolean;
  readError: string | null;
  isMutationPending: boolean;
  mutationError: string | null;
  canMutate: boolean;
  toggleFavorite: (
    favorite: AgentModelFavorite,
    savedFavorites?: readonly AgentModelFavorite[],
  ) => void;
  retryRead: () => void;
  retryMutation: () => void;
};

export type ModelPickerSelectionPolicy =
  | { kind: "editable" }
  | { kind: "runtime_locked"; runtimeKind: RuntimeKind; reason: string }
  | { kind: "read_only"; reason: string };

export type ModelPickerItem = {
  value: ModelPickerValue;
  runtime: RuntimeDescriptor;
  model: AgentModelCatalog["models"][number];
  savedFavorites: AgentModelFavorite[];
  isFavorite: boolean;
  isEnabledForFavorites: boolean;
  runtimeIndex: number;
  catalogIndex: number;
};

export const modelPickerValueKey = (value: ModelPickerValue): string =>
  agentModelFavoriteKey(value);

export const isSameModelPickerValue = (
  left: ModelPickerValue | null,
  right: ModelPickerValue | null,
): boolean => isSameAgentModelFavorite(left, right);

const normalizeSearchTerms = (query: string): string[] =>
  query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);

const scoreField = (field: string, term: string, fieldWeight: number): number | null => {
  const normalized = field.toLocaleLowerCase();
  if (normalized === term) {
    return fieldWeight;
  }
  if (normalized.startsWith(term)) {
    return fieldWeight + 1;
  }
  return normalized.includes(term) ? fieldWeight + 2 : null;
};

const scoreItem = (item: ModelPickerItem, terms: string[]): number | null => {
  const fields = [
    [item.model.modelName, 0],
    [item.model.modelId, 0],
    [item.model.providerName, 4],
    [item.model.providerId, 4],
    [item.runtime.label, 8],
    [item.runtime.kind, 8],
  ] as const;
  let score = 0;
  for (const term of terms) {
    let bestScore: number | null = null;
    for (const [field, weight] of fields) {
      const fieldScore = scoreField(field, term, weight);
      if (fieldScore !== null && (bestScore === null || fieldScore < bestScore)) {
        bestScore = fieldScore;
      }
    }
    if (bestScore === null) {
      return null;
    }
    score += bestScore;
  }
  return score;
};

const compareStableCatalogOrder = (left: ModelPickerItem, right: ModelPickerItem): number =>
  left.runtimeIndex - right.runtimeIndex || left.catalogIndex - right.catalogIndex;

export const buildModelPickerItems = ({
  runtimes,
  favorites,
  activeView,
  searchQuery,
  lockedRuntimeKind,
}: {
  runtimes: readonly ModelPickerRuntime[];
  favorites: readonly AgentModelFavorite[] | null;
  activeView: ModelPickerView;
  searchQuery: string;
  lockedRuntimeKind: RuntimeKind | null;
}): ModelPickerItem[] => {
  const items = runtimes.flatMap((runtime, runtimeIndex) => {
    const catalog = selectableModelPickerCatalog(runtime.resource);
    if (!catalog || (lockedRuntimeKind && runtime.descriptor.kind !== lockedRuntimeKind)) {
      return [];
    }
    // Each favorite resolves its alias once. A model then finds its favorites by key, so a large
    // catalog does not resolve every favorite again for each model.
    const favoritesByModel = new Map<string, AgentModelFavorite[]>();
    for (const favorite of favorites ?? []) {
      if (favorite.runtimeKind !== runtime.descriptor.kind) continue;
      const key = modelPickerValueKey(resolveSavedModelAlias(catalog, favorite));
      favoritesByModel.set(key, [...(favoritesByModel.get(key) ?? []), favorite]);
    }
    return catalog.models.map((model, catalogIndex) => {
      const value = {
        runtimeKind: runtime.descriptor.kind,
        providerId: model.providerId,
        modelId: model.modelId,
      };
      const savedFavorites = favoritesByModel.get(modelPickerValueKey(value)) ?? [];
      return {
        value,
        runtime: runtime.descriptor,
        model,
        savedFavorites,
        isFavorite: savedFavorites.length > 0,
        isEnabledForFavorites: runtime.isEnabledForFavorites,
        runtimeIndex,
        catalogIndex,
      } satisfies ModelPickerItem;
    });
  });
  const terms = normalizeSearchTerms(searchQuery);
  if (terms.length > 0) {
    return items
      .flatMap((item) => {
        const score = scoreItem(item, terms);
        return score === null ? [] : [{ item, score }];
      })
      .toSorted(
        (left, right) =>
          left.score - right.score ||
          Number(right.item.isFavorite) - Number(left.item.isFavorite) ||
          compareStableCatalogOrder(left.item, right.item),
      )
      .map(({ item }) => item);
  }
  if (activeView === "favorites") {
    return items
      .filter((item) => item.isFavorite && item.isEnabledForFavorites)
      .toSorted(compareStableCatalogOrder);
  }
  return items
    .filter((item) => item.runtime.kind === activeView)
    .toSorted(
      (left, right) =>
        Number(right.isFavorite) - Number(left.isFavorite) ||
        compareStableCatalogOrder(left, right),
    );
};
