import type { AgentModelCatalog, AgentModelSelection, AgentRole } from "@openducktor/core";
import {
  findCatalogModel,
  normalizeCatalogVariant,
  normalizeVisibleCatalogProfileId,
  pickCatalogDefaultModel,
  pickVisibleCatalogDefaultProfileId,
  runtimeKindForCatalog,
} from "@/lib/model-catalog-selection";
import { DEFAULT_RUNTIME_KIND } from "@/state/agent-runtime-registry";
import type { RepoSettingsInput } from "@/types/state-slices";

export const roleDefaultSelectionFor = (
  repoSettings: RepoSettingsInput | null,
  role: AgentRole,
): AgentModelSelection | null => {
  const roleDefault = repoSettings?.agentDefaults[role];
  if (!roleDefault?.providerId || !roleDefault.modelId) {
    return null;
  }

  return {
    runtimeKind:
      roleDefault.runtimeKind ?? repoSettings?.defaultRuntimeKind ?? DEFAULT_RUNTIME_KIND,
    providerId: roleDefault.providerId,
    modelId: roleDefault.modelId,
    ...(roleDefault.variant ? { variant: roleDefault.variant } : {}),
    ...(roleDefault.profileId ? { profileId: roleDefault.profileId } : {}),
  };
};

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

  return {
    runtimeKind: runtimeKindForCatalog(catalog),
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

  const model = findCatalogModel(catalog, selection);
  if (!model) {
    return null;
  }

  const variant = normalizeCatalogVariant(model, selection.variant);
  const profileId = normalizeVisibleCatalogProfileId(catalog, selection.profileId);

  return {
    runtimeKind: selection.runtimeKind ?? runtimeKindForCatalog(catalog),
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
