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

  return {
    runtimeKind,
    providerId: model.providerId,
    modelId: model.modelId,
    ...(() => {
      if (variant) {
        return { variant };
      }
      return {};
    })(),
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
  const runtimeKind = selection.runtimeKind ?? catalog.runtime?.kind;
  if (!runtimeKind) {
    return null;
  }

  return {
    runtimeKind,
    providerId: model.providerId,
    modelId: model.modelId,
    ...(() => {
      if (variant) {
        return { variant };
      }
      return {};
    })(),
    ...(() => {
      if (profileId) {
        return { profileId };
      }
      return {};
    })(),
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
    ...(() => {
      if (selection.variant) {
        return { variant: selection.variant };
      }
      return {};
    })(),
    ...(() => {
      if (selection.profileId) {
        return { profileId: selection.profileId };
      }
      return {};
    })(),
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

  const runtimeKind = override.runtimeKind ?? base.runtimeKind;
  const variant = override.variant ?? base.variant;
  const profileId = override.profileId ?? base.profileId;
  return {
    ...(() => {
      if (runtimeKind) {
        return { runtimeKind };
      }
      return {};
    })(),
    providerId: override.providerId,
    modelId: override.modelId,
    ...(() => {
      if (variant) {
        return { variant };
      }
      return {};
    })(),
    ...(() => {
      if (profileId) {
        return { profileId };
      }
      return {};
    })(),
  };
};
