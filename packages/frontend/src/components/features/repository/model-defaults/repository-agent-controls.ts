import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import { type AgentModelCatalog, resolveSavedModelAlias, STANDARD_SPEED } from "@openducktor/core";
import { toPrimaryAgentOptions } from "@openducktor/frontend-core/sessions/model-selection/catalog-select-options";
import type { ModelPickerValue } from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import type { SpeedControlModel } from "@openducktor/frontend-core/sessions/model-selection/use-speed-control";
import type { ModelPickerOptionsPane } from "@/components/features/agents/model-picker";
import type { ComboboxOption } from "@/components/ui/combobox";

import type { RepoAgentDefaultInput } from "@/types/state-slices";
import {
  findCatalogModel,
  selectedModelKey,
  toVariantOptionsForModelKey,
} from "./model-defaults-model";

type RepositoryAgentControl = {
  options: ComboboxOption[];
  placeholder: string;
  disabled: boolean;
};

export type RepositoryAgentControls = {
  selectedPickerValue: ModelPickerValue | null;
  profile: RepositoryAgentControl;
  variant: RepositoryAgentControl;
  speed: SpeedControlModel | null;
};

const profilePlaceholderFor = ({
  hasSelectedModel,
  isCatalogLoading,
  supportsProfiles,
}: {
  hasSelectedModel: boolean;
  isCatalogLoading: boolean;
  supportsProfiles: boolean;
}): string => {
  if (!supportsProfiles) {
    return "Not supported by runtime";
  }
  if (isCatalogLoading) {
    return "Loading agents…";
  }
  if (!hasSelectedModel) {
    return "Select a model first";
  }
  return "Select agent";
};

const effortPlaceholderFor = ({
  hasSelectedModel,
  isCatalogLoading,
  supportsVariants,
  hasOptions,
}: {
  hasSelectedModel: boolean;
  isCatalogLoading: boolean;
  supportsVariants: boolean;
  hasOptions: boolean;
}): string => {
  if (isCatalogLoading) return "Loading effort…";
  if (!hasSelectedModel) return "Select a model first";
  if (!supportsVariants) return "Runtime sets effort";
  if (!hasOptions) return "No effort options";
  return "Select effort";
};

export const buildRepositoryAgentControls = ({
  value,
  runtimeKind,
  runtimeDescriptor,
  catalog,
  isCatalogLoading,
  isSaving,
  includeSpeed = true,
  onSelectSpeed,
}: {
  value: RepoAgentDefaultInput;
  runtimeKind: RuntimeKind | null;
  runtimeDescriptor: RuntimeDescriptor | null;
  catalog: AgentModelCatalog | null;
  isCatalogLoading: boolean;
  isSaving: boolean;
  includeSpeed?: boolean;
  onSelectSpeed?: (speed: string) => void;
}): RepositoryAgentControls => {
  const current = catalog ? resolveSavedModelAlias(catalog, value) : value;
  const selectedPickerValue: ModelPickerValue | null =
    runtimeKind && current.providerId && current.modelId
      ? {
          runtimeKind,
          providerId: current.providerId,
          modelId: current.modelId,
        }
      : null;
  const supportsProfiles =
    runtimeDescriptor?.capabilities.optionalSurfaces.supportsProfiles === true;
  const supportsVariants =
    runtimeDescriptor?.capabilities.optionalSurfaces.supportsVariants === true;
  const supportsSpeed =
    runtimeDescriptor !== null && runtimeDescriptor.capabilities.speed.support !== "none";
  const modelKey = selectedModelKey(current);
  const catalogModel = findCatalogModel(catalog, modelKey);
  const profileOptions = toPrimaryAgentOptions(catalog);
  const variantOptions = supportsVariants ? toVariantOptionsForModelKey(catalog, modelKey) : [];

  const activeSpeed = value.speed?.trim() || STANDARD_SPEED;
  const speedLevels = supportsSpeed && catalogModel ? (catalogModel.speedLevels ?? []) : [];
  const blockedReason =
    catalog?.speedAvailability?.status === "blocked"
      ? catalog.speedAvailability.reason.message
      : undefined;
  const speed: SpeedControlModel | null =
    includeSpeed &&
    supportsSpeed &&
    selectedPickerValue &&
    (speedLevels.length > 0 || activeSpeed !== STANDARD_SPEED)
      ? {
          key: `${selectedPickerValue.runtimeKind}|${selectedPickerValue.providerId}|${selectedPickerValue.modelId}`,
          choice: activeSpeed,
          levels: speedLevels,
          blockedReason,
          disabled: isCatalogLoading || isSaving,
          pending: false,
          error: null,
          onChange: (nextSpeed: string) => {
            onSelectSpeed?.(nextSpeed === STANDARD_SPEED ? "" : nextSpeed);
          },
        }
      : null;

  return {
    selectedPickerValue,
    profile: {
      options: profileOptions,
      placeholder: profilePlaceholderFor({
        hasSelectedModel: selectedPickerValue !== null,
        isCatalogLoading,
        supportsProfiles,
      }),
      disabled:
        isCatalogLoading ||
        isSaving ||
        !supportsProfiles ||
        !selectedPickerValue ||
        profileOptions.length === 0,
    },
    variant: {
      options: variantOptions,
      placeholder: effortPlaceholderFor({
        hasSelectedModel: selectedPickerValue !== null,
        isCatalogLoading,
        supportsVariants,
        hasOptions: variantOptions.length > 0,
      }),
      disabled:
        isCatalogLoading ||
        isSaving ||
        !selectedPickerValue ||
        !supportsVariants ||
        variantOptions.length === 0,
    },
    speed,
  };
};

export type RepositoryModelOptionScope = "full" | "effort_only";

export const toRepositoryModelPickerOptions = ({
  controls,
  value,
  optionScope,
  onUpdateField,
}: {
  controls: RepositoryAgentControls;
  value: Pick<RepoAgentDefaultInput, "variant" | "profileId">;
  optionScope: RepositoryModelOptionScope;
  onUpdateField: (field: "variant" | "profileId", nextValue: string) => void;
}): ModelPickerOptionsPane => {
  const options: ModelPickerOptionsPane = {
    effort: {
      options: controls.variant.options,
      value: value.variant || undefined,
      onSelect: (variant) => onUpdateField("variant", variant),
    },
  };
  if (optionScope === "full") {
    options.profile = {
      options: controls.profile.options,
      value: value.profileId || undefined,
      onSelect: (profileId) => onUpdateField("profileId", profileId),
    };
    options.speed = {
      control: controls.speed,
    };
  }
  return options;
};
