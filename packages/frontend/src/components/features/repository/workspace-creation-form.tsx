import { ArrowLeft, ArrowRight, FolderOpen } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { ensureDraftAgentDefault } from "@/components/features/repository/model-defaults/model-defaults-model";
import { RepositoryModelDefaultsFields } from "@/components/features/repository/model-defaults/repository-model-defaults-fields";
import { WorkspaceIdentityFields } from "@/components/features/workspace-identity/workspace-identity-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WorkspaceCreationController, WorkspaceCreationStage } from "./use-workspace-creation";
import type { WorkspaceCreationModelSurface } from "./use-workspace-creation-models";

const STAGES: ReadonlyArray<{ id: WorkspaceCreationStage; label: string }> = [
  { id: "repository", label: "Repository folder" },
  { id: "information", label: "Workspace information" },
  { id: "models", label: "Models" },
];

function WorkspaceRepositoryChooser({
  controller,
}: {
  controller: WorkspaceCreationController;
}): ReactElement {
  return (
    <div className="grid gap-3">
      {controller.repoPath ? (
        <div className="grid gap-1">
          <Label htmlFor="workspace-selected-repo-path">Selected repository path</Label>
          <Input id="workspace-selected-repo-path" value={controller.repoPath} readOnly />
        </div>
      ) : null}
      <Button type="button" size="lg" className="w-fit" onClick={controller.openPicker}>
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
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="workspace-repo-path">Repository path</Label>
        <Input id="workspace-repo-path" value={controller.repoPath} readOnly />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="workspace-id">Workspace ID</Label>
        <Input
          id="workspace-id"
          value={controller.workspaceId}
          aria-invalid={invalidWorkspaceId}
          onChange={(event) => controller.updateWorkspaceId(event.currentTarget.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="workspace-name">Workspace name</Label>
        <Input
          id="workspace-name"
          value={controller.workspaceName}
          onChange={(event) => controller.updateWorkspaceName(event.currentTarget.value)}
        />
      </div>
      <WorkspaceIdentityFields
        idPrefix="workspace-create"
        workspaceName={controller.workspaceName}
        abbreviation={controller.abbreviation || null}
        tileColor={controller.tileColor}
        isDisabled={controller.busy}
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
    <div className="space-y-3">
      <div className="grid gap-1">
        <Label htmlFor="workspace-models-repo-path">Repository path</Label>
        <Input id="workspace-models-repo-path" value={controller.repoPath} readOnly />
      </div>
      <p className="text-sm text-muted-foreground">
        Choose defaults for this workspace. You can leave every choice blank.
      </p>
      <RepositoryModelDefaultsFields
        selectedRepoConfig={controller.modelDraft}
        availableRuntimeDefinitions={surface.availableRuntimeDefinitions}
        catalogResources={surface.catalogResources}
        favoriteState={surface.favoriteState}
        loadingState={{
          isLoadingRuntimeDefinitions: surface.isLoadingRuntimeDefinitions,
          isLoadingCatalog: surface.isLoadingCatalog,
          isLoadingSettings: false,
          isSaving: controller.busy,
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

export function WorkspaceCreationFields({
  controller,
  picker,
  modelSurface,
}: {
  controller: WorkspaceCreationController;
  picker?: ReactNode;
  modelSurface?: WorkspaceCreationModelSurface | undefined;
}): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ol className="grid grid-cols-3 gap-2" aria-label="Workspace setup stages">
        {STAGES.map((step, index) => (
          <li
            key={step.id}
            aria-current={controller.stage === step.id ? "step" : undefined}
            className={`rounded-md border px-2 py-2 text-xs sm:text-sm ${controller.stage === step.id ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground"}`}
          >
            {index + 1}. {step.label}
          </li>
        ))}
      </ol>
      <fieldset disabled={controller.busy} className="flex min-w-0 flex-col gap-4">
        {controller.stage === "repository" ? (
          picker !== undefined && controller.pickerOpen ? (
            picker
          ) : (
            <WorkspaceRepositoryChooser controller={controller} />
          )
        ) : null}
        {controller.stage === "information" ? (
          <WorkspaceRepositoryFields controller={controller} />
        ) : null}
        {controller.stage === "models" ? (
          <WorkspaceModelsFields controller={controller} surface={modelSurface} />
        ) : null}
      </fieldset>
      {controller.error || (controller.stage === "information" && controller.validationError) ? (
        <p className="text-sm text-destructive" role="alert">
          {controller.error ?? controller.validationError}
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
  if (controller.stage === "repository" || controller.createdWorkspaceId) return null;
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
        Continue to workspace information <ArrowRight data-icon="inline-end" />
      </Button>
    ) : null;
  }
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
  const progressLabel =
    controller.progress === "creating"
      ? "Creating workspace..."
      : controller.progress === "saving"
        ? "Saving model defaults..."
        : controller.progress === "finishing"
          ? "Opening repository..."
          : "Open repository";
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
