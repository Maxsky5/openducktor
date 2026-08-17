import {
  type AgentModelFavorite,
  agentModelFavoriteKey,
  isSameAgentModelFavorite,
  type RuntimeDescriptor,
  type RuntimeKind,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";

export type ModelPickerValue = AgentModelFavorite;
export type ModelPickerView = "favorites" | RuntimeKind;

export type ModelPickerCatalogResource =
  | {
      status: "loading";
      catalog: null;
      retry: () => Promise<void>;
    }
  | {
      status: "refreshing";
      catalog: AgentModelCatalog;
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

type ModelPickerCatalogResourceInput = {
  catalog: AgentModelCatalog | null;
  isFetching: boolean;
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

export const toModelPickerCatalogResource = ({
  catalog,
  isFetching,
  error,
  isAvailable,
  unavailableReason,
  retry,
}: ModelPickerCatalogResourceInput): ModelPickerCatalogResource => {
  if (!isAvailable) {
    return unavailableModelPickerCatalogResource(unavailableReason);
  }
  if (isFetching) {
    const retryAction = requiredRetry(retry);
    return catalog
      ? { status: "refreshing", catalog, retry: retryAction }
      : { status: "loading", catalog: null, retry: retryAction };
  }
  if (error) {
    return { status: "failed", catalog, error, retry: requiredRetry(retry) };
  }
  if (!catalog) {
    return unavailableModelPickerCatalogResource(unavailableReason);
  }
  return { status: "ready", catalog };
};

export type ModelPickerRuntime = {
  descriptor: RuntimeDescriptor;
  resource: ModelPickerCatalogResource;
  disabledReason?: string | null;
};

export type ModelPickerItem = {
  value: ModelPickerValue;
  runtime: RuntimeDescriptor;
  model: AgentModelCatalog["models"][number];
  isFavorite: boolean;
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
  const favoriteKeys = new Set((favorites ?? []).map(modelPickerValueKey));
  const items = runtimes.flatMap((runtime, runtimeIndex) => {
    if (
      runtime.resource.status !== "ready" ||
      (lockedRuntimeKind && runtime.descriptor.kind !== lockedRuntimeKind)
    ) {
      return [];
    }
    return (runtime.resource.catalog?.models ?? []).map((model, catalogIndex) => {
      const value = {
        runtimeKind: runtime.descriptor.kind,
        providerId: model.providerId,
        modelId: model.modelId,
      };
      return {
        value,
        runtime: runtime.descriptor,
        model,
        isFavorite: favoriteKeys.has(modelPickerValueKey(value)),
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
    return items.filter((item) => item.isFavorite).toSorted(compareStableCatalogOrder);
  }
  return items
    .filter((item) => item.runtime.kind === activeView)
    .toSorted(
      (left, right) =>
        Number(right.isFavorite) - Number(left.isFavorite) ||
        compareStableCatalogOrder(left, right),
    );
};
