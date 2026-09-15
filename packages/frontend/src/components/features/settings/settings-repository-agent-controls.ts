import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { toPrimaryAgentOptions } from "@/components/features/agents/catalog-select-options";
import type { ModelPickerValue } from "@/components/features/agents/model-picker";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { RepoAgentDefaultInput } from "@/types/state-slices";
import { selectedModelKey, toVariantOptionsForModelKey } from "./settings-modal-model";

type RepositoryAgentControl = {
  options: ComboboxOption[];
  placeholder: string;
  disabled: boolean;
};

export type RepositoryAgentControls = {
  selectedPickerValue: ModelPickerValue | null;
  profile: RepositoryAgentControl;
  variant: RepositoryAgentControl & { visible: boolean };
};

const profilePlaceholderFor = ({
  isCatalogLoading,
  supportsProfiles,
}: {
  isCatalogLoading: boolean;
  supportsProfiles: boolean;
}): string => {
  if (!supportsProfiles) {
    return "Runtime does not support agent profiles";
  }
  if (isCatalogLoading) {
    return "Loading agents…";
  }
  return "Select agent";
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
  const profileOptions = toPrimaryAgentOptions(catalog);
  const variantOptions = toVariantOptionsForModelKey(catalog, selectedModelKey(value));

  return {
    selectedPickerValue,
    profile: {
      options: profileOptions,
      placeholder: profilePlaceholderFor({
        isCatalogLoading,
        supportsProfiles,
      }),
      disabled: isCatalogLoading || isSaving || !supportsProfiles || profileOptions.length === 0,
    },
    variant: {
      visible: runtimeDescriptor?.capabilities.optionalSurfaces.supportsVariants === true,
      options: variantOptions,
      placeholder: variantOptions.length > 0 ? "Select variant" : "No variants for model",
      disabled: isCatalogLoading || isSaving || !selectedPickerValue || variantOptions.length === 0,
    },
  };
};
