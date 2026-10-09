import { toPrimaryAgentOptions } from "@/components/features/agents/catalog-select-options";
import type { WorkspaceModelDefaultsDraft } from "@/types/state-slices";
import type { WorkspaceCreationModelSurface } from "./use-workspace-creation-models";

export const getModelWarnings = (
  draft: WorkspaceModelDefaultsDraft,
  surface: WorkspaceCreationModelSurface | undefined,
): string[] => {
  const warnings: string[] = [];
  const definitionsByKind = new Map(
    surface?.availableRuntimeDefinitions.map((definition) => [definition.kind, definition]) ?? [],
  );
  const resourcesByKind = new Map(
    surface?.catalogResources.map((resource) => [resource.runtimeKind, resource]) ?? [],
  );
  const catalogsByKind = new Map(
    surface?.catalogResources.map((resource) => [
      resource.runtimeKind,
      surface.getCatalogForRuntime(resource.runtimeKind),
    ]) ?? [],
  );
  const modelsByKey = new Map(
    [...catalogsByKind].flatMap(
      ([runtimeKind, catalog]) =>
        catalog?.models.map(
          (model) => [`${runtimeKind}\0${model.providerId}\0${model.modelId}`, model] as const,
        ) ?? [],
    ),
  );
  const entries = [
    ["Default Model", draft.defaultModel],
    ["Specification", draft.agentDefaults.spec],
    ["Planner", draft.agentDefaults.planner],
    ["Builder", draft.agentDefaults.build],
    ["QA", draft.agentDefaults.qa],
  ] as const;
  for (const [label, entry] of entries) {
    if (!entry?.runtimeKind || !entry.providerId.trim() || !entry.modelId.trim()) {
      continue;
    }
    const definition = definitionsByKind.get(entry.runtimeKind);
    const resource = resourcesByKind.get(entry.runtimeKind);
    const catalog = catalogsByKind.get(entry.runtimeKind);
    const model = modelsByKey.get(`${entry.runtimeKind}\0${entry.providerId}\0${entry.modelId}`);
    if (!definition || !resource?.isEnabled || resource.error || !model) {
      warnings.push(
        `${label} is unavailable. You can save this default and choose an available model before starting a session.`,
      );
      continue;
    }
    if (entry.variant && !model.variants.includes(entry.variant)) {
      warnings.push(
        `${label} has an unavailable effort. Choose an available effort before starting a session.`,
      );
    }
    if (
      definition.capabilities.optionalSurfaces.supportsProfiles &&
      entry.profileId?.trim() &&
      !toPrimaryAgentOptions(catalog ?? null).some(
        (option) => option.value === entry.profileId?.trim(),
      )
    ) {
      warnings.push(
        `${label} has an unavailable agent profile. Choose an available profile before starting a session.`,
      );
    }
  }
  return warnings;
};
