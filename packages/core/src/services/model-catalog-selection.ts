import type { AgentSpeedLevel } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "../types/agent-orchestrator";

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
  catalog: AgentModelCatalog | null | undefined,
  selection: Pick<AgentModelSelection, "providerId" | "modelId"> | null | undefined,
): CatalogModel | null => {
  if (!catalog || !selection) return null;
  return (
    catalog.models.find(
      (model) => model.providerId === selection.providerId && model.modelId === selection.modelId,
    ) ?? null
  );
};

export const resolveSavedModelAlias = <
  Selection extends Pick<AgentModelSelection, "providerId" | "modelId">,
>(
  catalog: AgentModelCatalog,
  selection: Selection,
): Selection => {
  if (findCatalogModel(catalog, selection)) return selection;
  const model = catalog.models.find(
    (entry) =>
      entry.providerId === selection.providerId && entry.aliases?.includes(selection.modelId),
  );
  return model ? { ...selection, modelId: model.modelId } : selection;
};

export const pickCatalogDefaultModel = (catalog: AgentModelCatalog): CatalogModel | null => {
  for (const model of catalog.models) {
    if (catalog.defaultModelsByProvider[model.providerId] === model.modelId) {
      return model;
    }
  }

  return catalog.models[0] ?? null;
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

/** A selection without `speed` uses standard speed. */
export const STANDARD_SPEED = "standard";

export const normalizeCatalogSpeed = (
  model: Pick<CatalogModel, "speedLevels">,
  speed: string | undefined,
): string | undefined =>
  speed && model.speedLevels?.some((level) => level.id === speed) ? speed : undefined;

/** A speed to keep. The label is absent when the catalog of the speed is unknown. */
export type SpeedPreference = { id: string; label?: string | undefined };

/**
 * Finds the speed level of `model` with the ID of `speed`, or else with its label.
 * Runtimes can give one level different IDs: Codex calls "Fast" `priority` and Claude calls it `fast`.
 */
export const findMatchingCatalogSpeed = (
  model: Pick<CatalogModel, "speedLevels">,
  speed: SpeedPreference | undefined,
): AgentSpeedLevel | undefined => {
  if (!speed) return undefined;
  const levels = model.speedLevels ?? [];
  return (
    levels.find((level) => level.id === speed.id) ??
    levels.find((level) => level.label === speed.label)
  );
};

/** Returns the speed of `selection` with its label from `catalog`, or undefined at standard speed. */
export const selectionSpeedPreference = (
  catalog: AgentModelCatalog | null,
  selection: AgentModelSelection | null,
): SpeedPreference | undefined => {
  const speed = selection?.speed;
  if (!speed) return undefined;
  const level = findCatalogModel(catalog, selection)?.speedLevels?.find(
    (entry) => entry.id === speed,
  );
  return level ?? { id: speed };
};

export const withSpeed = (selection: AgentModelSelection, speed: string): AgentModelSelection => {
  const { speed: _speed, ...rest } = selection;
  return speed === STANDARD_SPEED ? rest : { ...rest, speed };
};

export const listSelectableCatalogProfiles = (
  catalog: AgentModelCatalog | null | undefined,
): CatalogProfile[] => {
  if (!catalog) {
    return [];
  }
  const profiles = catalogProfilesFor(catalog);
  const primaryProfiles = profiles.filter(
    (profile) => !profile.hidden && (profile.mode === "primary" || profile.mode === "all"),
  );
  if (primaryProfiles.length > 0) {
    return primaryProfiles;
  }
  return profiles.filter((profile) => !profile.hidden && profile.mode !== "subagent");
};

export const isSelectableCatalogProfileId = (
  catalog: AgentModelCatalog,
  profileId: string,
): boolean => {
  // Catalogs that omit `profiles` do not restrict selectable profile IDs; an explicit empty list
  // (`profiles: []`) means no profile is selectable.
  if (catalog.profiles === undefined) {
    return true;
  }
  return listSelectableCatalogProfiles(catalog).some(
    (profile) => (profile.id ?? profile.name ?? profile.label) === profileId,
  );
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
