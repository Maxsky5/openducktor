import type { RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { type ReactElement, useMemo } from "react";
import {
  ModelPicker,
  type ModelPickerFavoriteState,
  type ModelPickerRuntime,
  type ModelPickerValue,
  selectableModelPickerCatalog,
  toModelPickerCatalogResource,
  unavailableModelPickerCatalogResource,
} from "@/components/features/agents/model-picker";
import { Label } from "@/components/ui/label";
import type { RuntimeModelCatalogQueryResource } from "@/state/queries/use-runtime-model-catalogs";

type RepositoryModelPickerFieldProps = {
  runtimeDefinitions: RuntimeDescriptor[];
  catalogResources: RuntimeModelCatalogQueryResource[];
  value: ModelPickerValue | null;
  favoriteState: ModelPickerFavoriteState;
  isReadOnly: boolean;
  isLoadingCatalog: boolean;
  onSelect: (value: ModelPickerValue, targetCatalog: AgentModelCatalog) => void;
};

export function RepositoryModelPickerField({
  runtimeDefinitions,
  catalogResources,
  value,
  favoriteState,
  isReadOnly,
  isLoadingCatalog,
  onSelect,
}: RepositoryModelPickerFieldProps): ReactElement {
  const runtimes = useMemo(
    () => toModelPickerRuntimes({ runtimeDefinitions, catalogResources }),
    [catalogResources, runtimeDefinitions],
  );

  return (
    <div className="grid min-w-0 gap-1">
      <Label className="text-xs">Runtime and Model</Label>
      <ModelPicker
        runtimes={runtimes}
        value={value}
        favoriteState={favoriteState}
        selectionPolicy={
          isReadOnly
            ? { kind: "read_only", reason: "Settings are being saved or loaded." }
            : { kind: "editable" }
        }
        placeholder={isLoadingCatalog ? "Loading models…" : "Select a model"}
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
    </div>
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
      resource: resource
        ? toModelPickerCatalogResource({
            catalog: resource.catalog,
            isFetching: resource.isFetching,
            error: resource.error,
            isAvailable: resource.isEnabled,
            unavailableReason: "This runtime catalog is not available yet.",
            retry: resource.retry,
          })
        : unavailableModelPickerCatalogResource("This runtime catalog is not available yet."),
    };
  });
