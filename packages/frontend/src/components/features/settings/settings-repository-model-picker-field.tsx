import type { RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import type { ReactElement } from "react";
import {
  ModelPicker,
  type ModelPickerFavoriteState,
  type ModelPickerRuntime,
  type ModelPickerValue,
  toModelPickerCatalogResource,
  unavailableModelPickerCatalogResource,
} from "@/components/features/agents/model-picker";
import { Label } from "@/components/ui/label";
import type { RuntimeModelCatalogQueryResource } from "@/state/queries/use-runtime-model-catalogs";

export const toModelPickerRuntimes = ({
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

type RepositoryModelPickerFieldProps = {
  runtimes: ModelPickerRuntime[];
  value: ModelPickerValue | null;
  favoriteState: ModelPickerFavoriteState;
  isReadOnly: boolean;
  isLoadingCatalog: boolean;
  onSelect: (value: ModelPickerValue, targetCatalog: AgentModelCatalog) => void;
};

export function RepositoryModelPickerField({
  runtimes,
  value,
  favoriteState,
  isReadOnly,
  isLoadingCatalog,
  onSelect,
}: RepositoryModelPickerFieldProps): ReactElement {
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
          if (targetRuntime?.resource.status !== "ready") {
            return;
          }
          onSelect(selectedValue, targetRuntime.resource.catalog);
        }}
      />
    </div>
  );
}
