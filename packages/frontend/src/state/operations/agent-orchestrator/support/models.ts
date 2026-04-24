import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import {
  findCatalogModel,
  normalizeCatalogVariant,
  normalizeKnownCatalogProfileId,
  pickCatalogDefaultModel,
  runtimeKindForCatalog,
} from "@/lib/model-catalog-selection";

export const pickDefaultSessionSelectionForCatalog = (
  catalog: AgentModelCatalog,
): AgentModelSelection | null => {
  const model = pickCatalogDefaultModel(catalog);
  if (!model) {
    return null;
  }
  const variant = normalizeCatalogVariant(model, undefined);

  return {
    runtimeKind: runtimeKindForCatalog(catalog),
    providerId: model.providerId,
    modelId: model.modelId,
    ...(variant ? { variant } : {}),
  };
};

export const coerceSessionSelectionToCatalog = (
  catalog: AgentModelCatalog,
  selection: AgentModelSelection | null,
): AgentModelSelection | null => {
  if (!selection) {
    return null;
  }

  const model = findCatalogModel(catalog, selection);
  if (!model) {
    return null;
  }

  const variant = normalizeCatalogVariant(model, selection.variant);
  const profileId = normalizeKnownCatalogProfileId(catalog, selection.profileId);

  return {
    runtimeKind: selection.runtimeKind ?? runtimeKindForCatalog(catalog),
    providerId: model.providerId,
    modelId: model.modelId,
    ...(variant ? { variant } : {}),
    ...(profileId ? { profileId } : {}),
  };
};

export const normalizePersistedSelection = (
  selection: AgentSessionRecord["selectedModel"] | undefined,
): AgentModelSelection | null => {
  if (!selection) {
    return null;
  }
  return {
    runtimeKind: selection.runtimeKind,
    providerId: selection.providerId,
    modelId: selection.modelId,
    ...(selection.variant ? { variant: selection.variant } : {}),
    ...(selection.profileId ? { profileId: selection.profileId } : {}),
  };
};

export const mergeModelSelection = (
  base: AgentModelSelection | null,
  override: AgentModelSelection | undefined,
): AgentModelSelection | null => {
  if (!base) {
    return override ?? null;
  }
  if (!override) {
    return base;
  }

  return {
    ...((override.runtimeKind ?? base.runtimeKind)
      ? { runtimeKind: override.runtimeKind ?? base.runtimeKind }
      : {}),
    providerId: override.providerId,
    modelId: override.modelId,
    ...((override.variant ?? base.variant) ? { variant: override.variant ?? base.variant } : {}),
    ...((override.profileId ?? base.profileId)
      ? { profileId: override.profileId ?? base.profileId }
      : {}),
  };
};
