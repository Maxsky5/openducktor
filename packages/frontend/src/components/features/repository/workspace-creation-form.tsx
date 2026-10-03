import { ArrowLeft, ArrowRight, FolderOpen } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { ensureDraftAgentDefault } from "@/components/features/repository/model-defaults/model-defaults-model";
import { RepositoryModelDefaultsFields } from "@/components/features/repository/model-defaults/repository-model-defaults-fields";
import { WorkspaceIdentityFields } from "@/components/features/workspace-identity/workspace-identity-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Stepper, type StepperStep } from "@/components/ui/stepper";
import type { WorkspaceCreationController, WorkspaceCreationStage } from "./use-workspace-creation";
import type { WorkspaceCreationModelSurface } from "./use-workspace-creation-models";
import { WorkspaceProviderFields } from "./workspace-provider-fields";

const STAGES: readonly StepperStep<WorkspaceCreationStage>[] = [
  { id: "repository", title: "Repository", shortTitle: "Repo", description: "Choose a Git folder" },
  {
    id: "provider",
    title: "Git provider",
    shortTitle: "Provider",
    description: "Connect an integration",
  },
  {
    id: "information",
    title: "Workspace details",
    shortTitle: "Details",
    description: "Name and color",
  },
  { id: "models", title: "Models", description: "Set your defaults" },
];

type WorkspaceCreationFieldsProps = {
  controller: WorkspaceCreationController;
  picker?: ReactNode;
  modelSurface?: WorkspaceCreationModelSurface | undefined;
};

export function WorkspaceCreationFields({
  controller,
  picker,
  modelSurface,
}: WorkspaceCreationFieldsProps): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Stepper steps={STAGES} step={controller.stage} label="Workspace setup stages" fill />
      <fieldset disabled={controller.busy} className="flex min-w-0 flex-col gap-5">
        <WorkspaceCreationStageFields
          controller={controller}
          picker={picker}
          modelSurface={modelSurface}
        />
      </fieldset>
      {controller.stage === "provider" && controller.provider.isStartingSignIn ? (
        <Button
          type="button"
          variant="outline"
          disabled={!controller.canAbandon}
          onClick={() => void controller.abandon()}
        >
          {controller.provider.isCancelling
            ? "Cancelling provider setup..."
            : "Cancel provider setup"}
        </Button>
      ) : null}
      {controller.error || (controller.stage === "information" && controller.validationError) ? (
        <p className="text-sm text-destructive" role="alert">
          {controller.error ?? controller.validationError}
        </p>
      ) : null}
      {controller.stage === "models" && controller.error ? (
        <Button
          type="button"
          variant="outline"
          disabled={controller.busy}
          onClick={() => void controller.recoverCreation()}
        >
          Read saved creation progress
        </Button>
      ) : null}
      {controller.stage !== "provider" && controller.provider.error ? (
        <p role="alert" className="text-sm text-destructive">
          {controller.provider.error} Retry the action.
        </p>
      ) : null}
    </div>
  );
}

export function WorkspaceCreationBackAction({
  controller,
}: {
  controller: WorkspaceCreationController;
}): ReactElement | null {
  if (controller.stage === "repository") return null;
  return (
    <Button type="button" variant="outline" disabled={controller.busy} onClick={controller.back}>
      <ArrowLeft data-icon="inline-start" /> Back
    </Button>
  );
}

export function WorkspaceCreationSubmitAction({
  controller,
  modelSurface,
}: {
  controller: WorkspaceCreationController;
  modelSurface?: WorkspaceCreationModelSurface | undefined;
}): ReactElement | null {
  if (controller.stage === "repository") {
    return controller.repoPath && !controller.pickerOpen ? (
      <Button type="button" disabled={controller.busy} onClick={controller.reviewRepo}>
        Continue to Git provider <ArrowRight data-icon="inline-end" />
      </Button>
    ) : null;
  }
  if (controller.stage === "provider")
    return (
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={controller.busy}
          onClick={() => void controller.skipProvider()}
        >
          Skip Git provider setup
        </Button>
        <Button
          type="button"
          disabled={controller.busy}
          onClick={() => void controller.continueProvider()}
        >
          Continue to workspace information <ArrowRight data-icon="inline-end" />
        </Button>
      </div>
    );
  if (controller.stage === "information") {
    return (
      <Button
        type="button"
        disabled={controller.busy || controller.validationError !== null}
        onClick={controller.next}
      >
        Continue to models <ArrowRight data-icon="inline-end" />
      </Button>
    );
  }
  let progressLabel = "Open repository";
  if (controller.progress === "creating") progressLabel = "Creating workspace...";
  else if (controller.progress === "saving") progressLabel = "Saving model defaults...";
  else if (controller.progress === "finishing") progressLabel = "Opening repository...";
  return (
    <Button
      type="button"
      disabled={controller.busy || controller.validationError !== null}
      onClick={() => void controller.submit(modelSurface)}
    >
      {progressLabel}
    </Button>
  );
}

function WorkspaceRepositoryChooser({
  controller,
}: {
  controller: WorkspaceCreationController;
}): ReactElement {
  return (
    <div className="mx-auto flex min-h-56 w-full max-w-2xl flex-col items-start justify-center gap-4 rounded-xl border border-border bg-card p-6 sm:p-8">
      <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <FolderOpen className="size-6" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">Choose a repository</h3>
        <p className="text-sm text-muted-foreground">
          Select the local Git folder you want to use for this workspace.
        </p>
      </div>
      {controller.repoPath ? (
        <div className="grid w-full gap-1">
          <Label htmlFor="workspace-selected-repo-path">Selected repository path</Label>
          <Input id="workspace-selected-repo-path" value={controller.repoPath} readOnly />
        </div>
      ) : null}
      <Button type="button" size="lg" className="w-full" onClick={controller.openPicker}>
        <FolderOpen data-icon="inline-start" />
        {controller.repoPath ? "Choose different repository" : "Choose repository folder"}
      </Button>
    </div>
  );
}

function WorkspaceRepositoryFields({
  controller,
}: {
  controller: WorkspaceCreationController;
}): ReactElement {
  const invalidWorkspaceId = controller.validationError?.startsWith("Workspace ID") ?? false;
  return (
    <div className="grid gap-5 rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-col gap-1">
        <Label htmlFor="workspace-repo-path">Repository path</Label>
        <Input id="workspace-repo-path" value={controller.repoPath} readOnly />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="workspace-name">Workspace name</Label>
          <Input
            id="workspace-name"
            disabled={controller.createdWorkspaceId !== null}
            value={controller.workspaceName}
            onChange={(event) => controller.updateWorkspaceName(event.currentTarget.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="workspace-id">Workspace ID</Label>
          <Input
            id="workspace-id"
            disabled={controller.createdWorkspaceId !== null}
            value={controller.workspaceId}
            aria-invalid={invalidWorkspaceId}
            onChange={(event) => controller.updateWorkspaceId(event.currentTarget.value)}
          />
        </div>
      </div>
      <WorkspaceIdentityFields
        idPrefix="workspace-create"
        workspaceName={controller.workspaceName}
        abbreviation={controller.abbreviation || null}
        tileColor={controller.tileColor}
        isDisabled={controller.busy || controller.createdWorkspaceId !== null}
        onChangeAbbreviation={controller.updateAbbreviation}
        onChangeTileColor={controller.updateTileColor}
      />
    </div>
  );
}

function WorkspaceModelsFields({
  controller,
  surface,
}: {
  controller: WorkspaceCreationController;
  surface?: WorkspaceCreationModelSurface | undefined;
}): ReactElement {
  if (!surface)
    return (
      <p className="text-sm text-muted-foreground">
        Model choices are unavailable. You can open this repository without defaults.
      </p>
    );
  return (
    <div className="space-y-5">
      <div className="grid gap-1">
        <Label htmlFor="workspace-models-repo-path">Repository path</Label>
        <Input id="workspace-models-repo-path" value={controller.repoPath} readOnly />
      </div>
      <p className="text-sm text-muted-foreground">
        Choose defaults for this workspace. You can leave every choice blank.
      </p>
      <RepositoryModelDefaultsFields
        presentation="creation"
        selectedRepoConfig={controller.modelDraft}
        availableRuntimeDefinitions={surface.availableRuntimeDefinitions}
        catalogResources={surface.catalogResources}
        favoriteState={surface.favoriteState}
        loadingState={{
          isLoadingRuntimeDefinitions: surface.isLoadingRuntimeDefinitions,
          isLoadingCatalog: surface.isLoadingCatalog,
          isLoadingSettings: false,
          isSaving: controller.busy || controller.createdWorkspaceId !== null,
        }}
        runtimeDefinitionsError={null}
        runtimeAvailabilityErrors={surface.errors}
        getCatalogForRuntime={surface.getCatalogForRuntime}
        isCatalogLoadingForRuntime={surface.isCatalogLoadingForRuntime}
        onUpdateSelectedRepoConfig={controller.updateModelDraft}
        onUpdateSelectedRepoAgentDefault={(role, field, value) =>
          controller.updateModelDraft((current) => {
            const roleDefault = current.agentDefaults[role];
            return {
              ...current,
              agentDefaults: {
                ...current.agentDefaults,
                [role]: {
                  ...ensureDraftAgentDefault(roleDefault),
                  runtimeKind: roleDefault?.runtimeKind ?? current.defaultModel?.runtimeKind,
                  [field]: value,
                },
              },
            };
          })
        }
        onClearSelectedRepoAgentDefault={(role) =>
          controller.updateModelDraft((current) => ({
            ...current,
            agentDefaults: { ...current.agentDefaults, [role]: undefined },
          }))
        }
        onUpdateSelectedRepoDefaultModel={(field, value) =>
          controller.updateModelDraft((current) => ({
            ...current,
            defaultModel: current.defaultModel
              ? { ...current.defaultModel, [field]: value }
              : current.defaultModel,
          }))
        }
        onClearSelectedRepoDefaultModel={() =>
          controller.updateModelDraft((current) => ({ ...current, defaultModel: undefined }))
        }
      />
      {surface.errors.length > 0 ? (
        <Button type="button" variant="outline" onClick={() => void surface.retry()}>
          Retry model list
        </Button>
      ) : null}
    </div>
  );
}

function WorkspaceCreationStageFields({
  controller,
  picker,
  modelSurface,
}: WorkspaceCreationFieldsProps): ReactNode {
  switch (controller.stage) {
    case "repository":
      if (picker !== undefined && controller.pickerOpen) return picker;
      return <WorkspaceRepositoryChooser controller={controller} />;
    case "provider":
      return (
        <WorkspaceProviderFields
          provider={controller.provider}
          disabled={controller.busy}
          onSkip={controller.skipProvider}
        />
      );
    case "information":
      return <WorkspaceRepositoryFields controller={controller} />;
    case "models":
      return <WorkspaceModelsFields controller={controller} surface={modelSurface} />;
  }
}
