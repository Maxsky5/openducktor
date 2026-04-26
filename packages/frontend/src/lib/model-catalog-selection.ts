import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";

type CatalogProfile = NonNullable<AgentModelCatalog["profiles"]>[number];
type CatalogModel = AgentModelCatalog["models"][number];

const catalogProfilesFor = (catalog: AgentModelCatalog): CatalogProfile[] => {
  return catalog.profiles ?? [];
};

const profileIdFor = (profile: Pick<CatalogProfile, "id" | "name">): string | null => {
  return profile.id ?? profile.name ?? null;
};

const findCatalogProfile = (
  catalog: AgentModelCatalog,
  profileId: string,
): CatalogProfile | null => {
  return catalogProfilesFor(catalog).find((profile) => profileIdFor(profile) === profileId) ?? null;
};

export const findCatalogModel = (
  catalog: AgentModelCatalog,
  selection: Pick<AgentModelSelection, "providerId" | "modelId">,
): CatalogModel | null => {
  return (
    catalog.models.find(
      (model) => model.providerId === selection.providerId && model.modelId === selection.modelId,
    ) ?? null
  );
};

export const pickCatalogDefaultModel = (catalog: AgentModelCatalog): CatalogModel | null => {
  for (const model of catalog.models) {
    if (catalog.defaultModelsByProvider[model.providerId] === model.modelId) {
      return model;
    }
  }

  return catalog.models[0] ?? null;
};

export const runtimeKindForCatalog = (catalog: AgentModelCatalog): string | null => {
  return catalog.runtime?.kind ?? null;
};

export const normalizeCatalogVariant = (
  model: Pick<CatalogModel, "variants">,
  variant: string | undefined,
): string | undefined => {
  if (variant && model.variants.includes(variant)) {
    return variant;
  }

  return model.variants[0] || undefined;
};

export const pickVisibleCatalogDefaultProfileId = (
  catalog: AgentModelCatalog,
): string | undefined => {
  const profiles = catalogProfilesFor(catalog);
  const primaryProfile = profiles.find((profile) => !profile.hidden && profile.mode === "primary");
  if (primaryProfile) {
    return profileIdFor(primaryProfile) ?? undefined;
  }

  const firstVisibleProfile = profiles.find(
    (profile) => !profile.hidden && profile.mode !== "subagent",
  );
  return firstVisibleProfile ? (profileIdFor(firstVisibleProfile) ?? undefined) : undefined;
};

export const normalizeVisibleCatalogProfileId = (
  catalog: AgentModelCatalog,
  profileId: string | undefined,
): string | undefined => {
  if (!profileId) {
    return undefined;
  }

  const profiles = catalogProfilesFor(catalog);
  if (profiles.length === 0) {
    return profileId;
  }

  const profile = findCatalogProfile(catalog, profileId);
  if (!profile || profile.hidden || profile.mode === "subagent") {
    return undefined;
  }

  return profileId;
};

export const normalizeKnownCatalogProfileId = (
  catalog: AgentModelCatalog,
  profileId: string | undefined,
): string | undefined => {
  if (!profileId) {
    return undefined;
  }

  const profiles = catalogProfilesFor(catalog);
  if (profiles.length === 0) {
    return profileId;
  }

  return findCatalogProfile(catalog, profileId) ? profileId : undefined;
};
