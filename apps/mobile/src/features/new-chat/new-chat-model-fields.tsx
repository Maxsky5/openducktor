import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { useWorkspaceSessionCreateDefaults } from "@openducktor/frontend-core/workspace-sessions/create/use-workspace-session-create";
import type { ReactElement } from "react";
import { EffortField, ModelField, SpeedField } from "@/features/model-picker/model-field";
import { effortPlaceholder, modelSummary } from "@/features/model-picker/model-field-model";
import { Button } from "@/ui/button";
import { FormField, MenuSelect } from "@/ui/form-rows";
import { Callout } from "@/ui/callout";
import type { NewChatModel } from "./use-new-chat-model";

type RepoConfigRead = ReturnType<typeof useWorkspaceSessionCreateDefaults>["repoConfig"];

/** The runtime and model with its effort, speed, and runtime profile. */
export function ModelFields({
  model,
  modelError,
  repoConfig,
  disabled,
}: {
  model: NewChatModel;
  modelError: string | null;
  repoConfig: RepoConfigRead;
  disabled: boolean;
}): ReactElement {
  const modelName = modelSummary(model.runtimes, model.selection).title;
  return (
    <>
      <ModelField
        runtimes={model.runtimes}
        favorites={model.favorites}
        selection={model.selection}
        placeholder={model.state.kind === "loading" ? "Loading models…" : "Select a model"}
        disabled={disabled}
        error={modelError}
        onOpen={model.onCatalogSelectorOpen}
        onChoose={model.selectModel}
      />
      {repoConfig.isError ? (
        <Callout
          tone="destructive"
          title="The repository Default Model did not load"
          message={errorMessage(repoConfig.error)}
          action={
            <Button
              label="Try Again"
              variant="gray"
              size="sm"
              onPress={() => void repoConfig.refetch()}
            />
          }
        />
      ) : null}
      <EffortField
        effort={{
          options: model.variantOptions,
          value: model.selection?.variant,
          placeholder: effortPlaceholder({
            loading: model.state.kind === "loading",
            hasModel: model.selection !== null,
          }),
          caption: modelName ?? "Effort",
          disabled,
          onSelect: model.handleSelectVariant,
        }}
      />
      <SpeedField
        key={model.speed?.key}
        control={model.speed}
        caption={modelName ?? "Speed"}
        disabled={disabled}
      />
      {model.supportsProfiles ? (
        <FormField label="Runtime profile">
          <MenuSelect
            title="Runtime profile"
            icon="bot"
            choices={model.agentProfileOptions}
            selected={model.selection?.profileId}
            placeholder="Runtime default"
            disabled={disabled}
            onSelect={model.handleSelectAgentProfile}
          />
        </FormField>
      ) : null}
    </>
  );
}
