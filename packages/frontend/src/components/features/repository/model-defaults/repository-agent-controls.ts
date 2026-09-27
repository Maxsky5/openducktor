import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { toPrimaryAgentOptions } from "@/components/features/agents/catalog-select-options";
import type { ModelPickerValue } from "@/components/features/agents/model-picker";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { RepoAgentDefaultInput } from "@/types/state-slices";
import { selectedModelKey, toVariantOptionsForModelKey } from "./model-defaults-model";

type RepositoryAgentControl = {
  options: ComboboxOption[];
  placeholder: string;
  disabled: boolean;
};

export type RepositoryAgentControls = {
  selectedPickerValue: ModelPickerValue | null;
  profile: RepositoryAgentControl;
  variant: RepositoryAgentControl;
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
}: {
  value: RepoAgentDefaultInput;
  runtimeKind: RuntimeKind | null;
  runtimeDescriptor: RuntimeDescriptor | null;
  catalog: AgentModelCatalog | null;
  isCatalogLoading: boolean;
  isSaving: boolean;
}): RepositoryAgentControls => {
  const selectedPickerValue: ModelPickerValue | null =
    runtimeKind && value.providerId && value.modelId
      ? {
          runtimeKind,
          providerId: value.providerId,
          modelId: value.modelId,
        }
      : null;
  const supportsProfiles =
    runtimeDescriptor?.capabilities.optionalSurfaces.supportsProfiles === true;
  const supportsVariants =
    runtimeDescriptor?.capabilities.optionalSurfaces.supportsVariants === true;
  const profileOptions = toPrimaryAgentOptions(catalog);
  const variantOptions = supportsVariants
    ? toVariantOptionsForModelKey(catalog, selectedModelKey(value))
    : [];

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
  };
};
