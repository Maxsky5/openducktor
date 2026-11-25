import type { RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { type ReactElement, useMemo } from "react";
import {
  ModelPicker,
  type ModelPickerOptionsPane,
} from "@/components/features/agents/model-picker";
import {
  type ModelPickerFavoriteState,
  modelPickerResourceFromCatalogQuery,
  type ModelPickerRuntime,
  type ModelPickerValue,
  selectableModelPickerCatalog,
} from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import type { RuntimeModelCatalogQueryResource } from "@openducktor/frontend-core/queries/use-runtime-model-catalogs";

type RepositoryModelPickerFieldProps = {
  runtimeDefinitions: RuntimeDescriptor[];
  catalogResources: RuntimeModelCatalogQueryResource[];
  value: ModelPickerValue | null;
  favoriteState: ModelPickerFavoriteState;
  options: ModelPickerOptionsPane;
  isReadOnly: boolean;
  isLoadingCatalog: boolean;
  placeholder?: string;
  onSelect: (value: ModelPickerValue, targetCatalog: AgentModelCatalog) => void;
};

export function RepositoryModelPickerField({
  runtimeDefinitions,
  catalogResources,
  value,
  favoriteState,
  options,
  isReadOnly,
  isLoadingCatalog,
  placeholder = "Select a model",
  onSelect,
}: RepositoryModelPickerFieldProps): ReactElement {
  const runtimes = useMemo(
    () => toModelPickerRuntimes({ runtimeDefinitions, catalogResources }),
    [catalogResources, runtimeDefinitions],
  );

  return (
    <ModelPicker
      triggerVariant="form"
      runtimes={runtimes}
      value={value}
      favoriteState={favoriteState}
      options={options}
      selectionPolicy={
        isReadOnly
          ? { kind: "read_only", reason: "Settings are being saved or loaded." }
          : { kind: "editable" }
      }
      placeholder={isLoadingCatalog ? "Loading models…" : placeholder}
      onValueChange={(selectedValue) => {
        const targetRuntime = runtimes.find(
          (candidate) => candidate.descriptor.kind === selectedValue.runtimeKind,
        );
        const catalog = selectableModelPickerCatalog(targetRuntime?.resource);
        if (!catalog) {
          return;
        }
        onSelect(selectedValue, catalog);
      }}
    />
  );
}

const toModelPickerRuntimes = ({
  runtimeDefinitions,
  catalogResources,
}: {
  runtimeDefinitions: RuntimeDescriptor[];
  catalogResources: RuntimeModelCatalogQueryResource[];
}): ModelPickerRuntime[] =>
  runtimeDefinitions.map((descriptor) => {
    const resource = catalogResources.find(
      (candidate) => candidate.runtimeKind === descriptor.kind,
    );
    return {
      descriptor,
      isEnabledForFavorites: true,
      resource: modelPickerResourceFromCatalogQuery(resource),
    };
  });
