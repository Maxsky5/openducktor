import type { ReactElement } from "react";
import { ModelPicker } from "@/components/features/agents/model-picker";
import { Label } from "@/components/ui/label";
import type { useWorkspaceSessionCreateModelPicker } from "./use-workspace-session-model-picker";

export function WorkspaceSessionModelFields({
  model,
  disabled,
}: {
  model: ReturnType<typeof useWorkspaceSessionCreateModelPicker>;
  disabled: boolean;
}): ReactElement {
  return (
    <div className="grid gap-1.5">
      <Label>Runtime and model</Label>
      <ModelPicker
        {...model.modelPicker}
        triggerVariant="form"
        selectionPolicy={
          disabled
            ? { kind: "read_only", reason: "Creating session." }
            : model.modelPicker.selectionPolicy
        }
        options={{
          effort: {
            options: model.variantOptions,
            value: model.selection?.variant,
            onSelect: model.handleSelectVariant,
          },
          profile: {
            options: model.agentProfileOptions,
            value: model.selection?.profileId,
            onSelect: model.handleSelectAgentProfile,
          },
          speed: {
            control: model.speed
              ? { ...model.speed, disabled: disabled || model.speed.disabled }
              : null,
          },
        }}
        triggerClassName="w-full justify-between"
      />
      {model.speedBlockedReason ? (
        <p role="alert" className="text-sm text-destructive">
          {model.speedBlockedReason}
        </p>
      ) : null}
    </div>
  );
}
