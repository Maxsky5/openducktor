import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import {
  findCatalogModel,
  normalizeCatalogVariant,
  normalizeKnownCatalogProfileId,
  pickCatalogDefaultModel,
} from "@/lib/model-catalog-selection";

export const pickDefaultSessionSelectionForCatalog = (
  catalog: AgentModelCatalog,
): AgentModelSelection | null => {
  const model = pickCatalogDefaultModel(catalog);
  if (!model) {
    return null;
  }
  const variant = normalizeCatalogVariant(model, undefined);
  const runtimeKind = catalog.runtime?.kind;
  if (!runtimeKind) {
    return null;
  }

  const selection: AgentModelSelection = {
    runtimeKind,
    providerId: model.providerId,
    modelId: model.modelId,
  };
  if (variant) selection.variant = variant;
  return selection;
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
  const runtimeKind = selection.runtimeKind ?? catalog.runtime?.kind;
  if (!runtimeKind) {
    return null;
  }

  const normalizedSelection: AgentModelSelection = {
    runtimeKind,
    providerId: model.providerId,
    modelId: model.modelId,
  };
  if (variant) normalizedSelection.variant = variant;
  if (profileId) normalizedSelection.profileId = profileId;
  return normalizedSelection;
};

export const normalizePersistedSelection = (
  selection: AgentSessionRecord["selectedModel"] | undefined,
): AgentModelSelection | null => {
  if (!selection) {
    return null;
  }
  const normalizedSelection: AgentModelSelection = {
    runtimeKind: selection.runtimeKind,
    providerId: selection.providerId,
    modelId: selection.modelId,
  };
  if (selection.variant) normalizedSelection.variant = selection.variant;
  if (selection.profileId) normalizedSelection.profileId = selection.profileId;
  return normalizedSelection;
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

  const runtimeKind = override.runtimeKind ?? base.runtimeKind;
  const variant = override.variant ?? base.variant;
  const profileId = override.profileId ?? base.profileId;
  const selection: AgentModelSelection = {
    providerId: override.providerId,
    modelId: override.modelId,
  };
  if (runtimeKind) selection.runtimeKind = runtimeKind;
  if (variant) selection.variant = variant;
  if (profileId) selection.profileId = profileId;
  return selection;
};
