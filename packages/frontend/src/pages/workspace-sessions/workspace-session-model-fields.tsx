import { ModelPicker } from "@/components/features/agents/model-picker";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import type { useWorkspaceSessionModelPicker } from "./use-workspace-session-model-picker";

export function WorkspaceSessionModelFields({
  model,
  disabled,
}: {
  model: ReturnType<typeof useWorkspaceSessionModelPicker>;
  disabled: boolean;
}) {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label>Runtime and model</Label>
          <ModelPicker
            {...model.modelPicker}
            selectionPolicy={
              disabled
                ? { kind: "read_only", reason: "Creating chat." }
                : model.modelPicker.selectionPolicy
            }
            triggerClassName="w-full justify-between"
          />
        </div>
        <div className="grid gap-1.5">
          <Label id="workspace-session-effort">Effort</Label>
          <Combobox
            triggerAriaLabelledBy="workspace-session-effort"
            value={model.selection?.variant ?? ""}
            onValueChange={model.handleSelectVariant}
            onOpenChange={model.onCatalogSelectorOpen}
            options={model.variantOptions}
            disabled={disabled || model.variantOptions.length === 0}
            placeholder="Not supported"
          />
        </div>
      </div>
      {model.supportsProfiles && (
        <div className="grid gap-1.5">
          <Label id="workspace-session-profile">Runtime profile</Label>
          <Combobox
            triggerAriaLabelledBy="workspace-session-profile"
            value={model.selection?.profileId ?? ""}
            onValueChange={model.handleSelectAgentProfile}
            onOpenChange={model.onCatalogSelectorOpen}
            options={model.agentProfileOptions}
            disabled={disabled}
            placeholder="Runtime default"
          />
        </div>
      )}
    </>
  );
}
