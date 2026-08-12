import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import {
  findCatalogModel,
  normalizeCatalogVariant,
  normalizeVisibleCatalogProfileId,
  pickCatalogDefaultModel,
  pickVisibleCatalogDefaultProfileId,
} from "@/lib/model-catalog-selection";

export const pickDefaultVisibleSelectionForCatalog = (
  catalog: AgentModelCatalog | null,
): AgentModelSelection | null => {
  if (!catalog) {
    return null;
  }

  const defaultModel = pickCatalogDefaultModel(catalog);
  if (!defaultModel) {
    return null;
  }
  const profileId = pickVisibleCatalogDefaultProfileId(catalog);
  const variant = normalizeCatalogVariant(defaultModel, undefined);
  const runtimeKind = catalog.runtime?.kind;
  if (!runtimeKind) {
    return null;
  }

  return {
    runtimeKind,
    providerId: defaultModel.providerId,
    modelId: defaultModel.modelId,
    ...(variant ? { variant } : {}),
    ...(profileId ? { profileId } : {}),
  };
};

export const coerceVisibleSelectionToCatalog = (
  catalog: AgentModelCatalog | null,
  selection: AgentModelSelection | null,
): AgentModelSelection | null => {
  if (!catalog || !selection) {
    return selection;
  }
  if (
    catalog.runtime?.kind &&
    selection.runtimeKind &&
    catalog.runtime.kind !== selection.runtimeKind
  ) {
    return null;
  }

  const model = findCatalogModel(catalog, selection);
  if (!model) {
    return null;
  }

  const variant = normalizeCatalogVariant(model, selection.variant);
  const profileId = normalizeVisibleCatalogProfileId(catalog, selection.profileId);
  const runtimeKind = selection.runtimeKind ?? catalog.runtime?.kind;
  if (!runtimeKind) {
    return null;
  }

  return {
    runtimeKind,
    providerId: model.providerId,
    modelId: model.modelId,
    ...(variant ? { variant } : {}),
    ...(profileId ? { profileId } : {}),
  };
};

export const isSameSelection = (
  a: AgentModelSelection | null | undefined,
  b: AgentModelSelection | null | undefined,
): boolean => {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return (
    a.providerId === b.providerId &&
    a.modelId === b.modelId &&
    a.runtimeKind === b.runtimeKind &&
    (a.variant ?? "") === (b.variant ?? "") &&
    (a.profileId ?? "") === (b.profileId ?? "")
  );
};

export const resolvePreferredModelSelection = ({
  catalog,
  preferredSelection,
  fallbackSelection,
}: {
  catalog: AgentModelCatalog | null;
  preferredSelection: AgentModelSelection | null;
  fallbackSelection: AgentModelSelection | null;
}): AgentModelSelection | null => {
  return (
    coerceVisibleSelectionToCatalog(catalog, preferredSelection) ??
    coerceVisibleSelectionToCatalog(catalog, fallbackSelection) ??
    pickDefaultVisibleSelectionForCatalog(catalog)
  );
};

export const resolveInitialModelSelection = ({
  catalog,
  defaultSelection,
  runtimeKind,
  selectedModel,
}: {
  catalog: AgentModelCatalog | null;
  defaultSelection: AgentModelSelection | null;
  runtimeKind: RuntimeKind | null;
  selectedModel: AgentModelSelection | null;
}): AgentModelSelection | null => {
  if (!runtimeKind) {
    return null;
  }

  const runtimeCatalog = catalog?.runtime?.kind === runtimeKind ? catalog : null;
  const requestedSelection =
    selectedModel && (!selectedModel.runtimeKind || selectedModel.runtimeKind === runtimeKind)
      ? { ...selectedModel, runtimeKind }
      : null;
  const runtimeDefault =
    defaultSelection &&
    (!defaultSelection.runtimeKind || defaultSelection.runtimeKind === runtimeKind)
      ? { ...defaultSelection, runtimeKind }
      : null;
  const normalizedRequested = runtimeCatalog
    ? coerceVisibleSelectionToCatalog(runtimeCatalog, requestedSelection)
    : requestedSelection;
  const normalizedDefault = runtimeCatalog
    ? coerceVisibleSelectionToCatalog(runtimeCatalog, runtimeDefault)
    : runtimeDefault;

  return (
    normalizedRequested ??
    normalizedDefault ??
    pickDefaultVisibleSelectionForCatalog(runtimeCatalog)
  );
};

export const resolveModelSelectionForRuntimeChange = ({
  catalog,
  currentSelection,
  defaultSelection,
  selectedModel,
  runtimeKind,
}: {
  catalog: AgentModelCatalog | null;
  currentSelection: AgentModelSelection | null;
  defaultSelection: AgentModelSelection | null;
  selectedModel: AgentModelSelection | null;
  runtimeKind: RuntimeKind;
}): AgentModelSelection | null => {
  if (currentSelection?.runtimeKind === runtimeKind) {
    return currentSelection;
  }

  return resolveInitialModelSelection({
    catalog,
    defaultSelection,
    runtimeKind,
    selectedModel,
  });
};

export const resolveModelSelectionForProfileChange = ({
  catalog,
  currentSelection,
  profileId,
  runtimeKind,
}: {
  catalog: AgentModelCatalog | null;
  currentSelection: AgentModelSelection | null;
  profileId: string;
  runtimeKind: RuntimeKind;
}): AgentModelSelection | null => {
  const baseSelection = currentSelection ?? pickDefaultVisibleSelectionForCatalog(catalog);
  if (!baseSelection || baseSelection.runtimeKind !== runtimeKind) {
    return null;
  }

  const normalizedProfileId = catalog
    ? normalizeVisibleCatalogProfileId(catalog, profileId)
    : profileId || undefined;
  if (!normalizedProfileId) {
    return baseSelection;
  }

  return { ...baseSelection, profileId: normalizedProfileId };
};

export const resolveModelSelectionForModelChange = ({
  catalog,
  currentSelection,
  modelKey,
  runtimeKind,
}: {
  catalog: AgentModelCatalog | null;
  currentSelection: AgentModelSelection | null;
  modelKey: string;
  runtimeKind: RuntimeKind;
}): AgentModelSelection | null => {
  if (!catalog || (catalog.runtime?.kind && catalog.runtime.kind !== runtimeKind)) {
    return currentSelection;
  }

  const model = catalog.models.find(
    (entry) => entry.id === modelKey || `${entry.providerId}/${entry.modelId}` === modelKey,
  );
  if (!model) {
    return currentSelection;
  }

  const variant = normalizeCatalogVariant(model, undefined);
  const profileId = normalizeVisibleCatalogProfileId(
    catalog,
    currentSelection?.profileId ?? pickVisibleCatalogDefaultProfileId(catalog),
  );
  return {
    runtimeKind,
    providerId: model.providerId,
    modelId: model.modelId,
    ...(variant ? { variant } : {}),
    ...(profileId ? { profileId } : {}),
  };
};

export const resolveModelSelectionForVariantChange = ({
  catalog,
  currentSelection,
  variant,
}: {
  catalog: AgentModelCatalog | null;
  currentSelection: AgentModelSelection | null;
  variant: string;
}): AgentModelSelection | null => {
  if (!currentSelection) {
    return null;
  }
  if (!catalog) {
    return { ...currentSelection, variant };
  }

  const model = findCatalogModel(catalog, currentSelection);
  if (!model) {
    return currentSelection;
  }
  const normalizedVariant = normalizeCatalogVariant(model, variant);
  const { variant: _currentVariant, ...selectionWithoutVariant } = currentSelection;
  return {
    ...selectionWithoutVariant,
    ...(normalizedVariant ? { variant: normalizedVariant } : {}),
  };
};
