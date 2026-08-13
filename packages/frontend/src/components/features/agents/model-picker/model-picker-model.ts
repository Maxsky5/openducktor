import type { AgentModelFavorite, RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import type { RuntimeModelCatalogResource } from "@/state/queries/use-runtime-model-catalogs";

export type ModelPickerValue = AgentModelFavorite;
export type ModelPickerView = "favorites" | RuntimeKind;

export type ModelPickerRuntime = {
  descriptor: RuntimeDescriptor;
  resource: RuntimeModelCatalogResource;
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
  `${value.runtimeKind}\u0000${value.providerId}\u0000${value.modelId}`;

export const isSameModelPickerValue = (
  left: ModelPickerValue | null,
  right: ModelPickerValue | null,
): boolean =>
  left?.runtimeKind === right?.runtimeKind &&
  left?.providerId === right?.providerId &&
  left?.modelId === right?.modelId;

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
    if (lockedRuntimeKind && runtime.descriptor.kind !== lockedRuntimeKind) {
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
