import { RefreshCcw } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import type { AzureDevOpsGitProviderFormController } from "./use-azure-devops-git-provider-form";

type AzureDevOpsAreaSettingsProps = {
  controller: AzureDevOpsGitProviderFormController;
  disabled: boolean;
};

const areaPrerequisite = (controller: AzureDevOpsGitProviderFormController): string | null => {
  if (!controller.providerEnabled) return "Enable Azure DevOps to choose an area.";
  if (!controller.connectionInput) return "Link a repository to choose an area.";
  if (!controller.canManageConnection)
    return "Save the repository mapping in Connection before choosing an area.";
  if (!controller.hasConnectedAccount)
    return "Connect your Azure DevOps account above to load its area paths.";
  return null;
};

export function AzureDevOpsAreaSettings({
  controller,
  disabled,
}: AzureDevOpsAreaSettingsProps): ReactElement {
  const prerequisite = areaPrerequisite(controller);
  const availableSelectedArea = controller.areaPaths.find(
    (path) => path.toLowerCase() === controller.selectedAreaPath.toLowerCase(),
  );

  return (
    <section
      className="grid min-w-0 gap-3 border-t border-border pt-5"
      aria-labelledby="azure-area-heading"
    >
      <div className="space-y-1">
        <h3 id="azure-area-heading" className="text-sm font-semibold text-foreground">
          3. Work item area
        </h3>
        <p className="text-xs text-muted-foreground">
          Choose the area to import from. Imports include its child areas.
        </p>
      </div>
      {prerequisite ? (
        <p className="text-xs text-muted-foreground">{prerequisite}</p>
      ) : (
        <div className="grid min-w-0 gap-3">
          <AreaPathPicker
            controller={controller}
            disabled={disabled}
            selectedArea={availableSelectedArea ?? controller.selectedAreaPath}
          />
          <AreaPathFeedback
            controller={controller}
            selectedAreaUnavailable={
              controller.areaPaths.length > 0 &&
              controller.selectedAreaPath.length > 0 &&
              !availableSelectedArea
            }
          />
        </div>
      )}
    </section>
  );
}

function AreaPathPicker({
  controller,
  disabled,
  selectedArea,
}: {
  controller: AzureDevOpsGitProviderFormController;
  disabled: boolean;
  selectedArea: string;
}): ReactElement {
  return (
    <div className="grid min-w-0 gap-2">
      <Label id="azure-area-path-label">Area path</Label>
      <div className="flex min-w-0 gap-2">
        <Combobox
          value={selectedArea}
          onValueChange={controller.setAreaPath}
          options={controller.areaPaths.map((path) => ({ value: path, label: path }))}
          placeholder={controller.isLoadingAreaPaths ? "Loading areas…" : "Choose an area path"}
          searchPlaceholder="Find an area path…"
          emptyText="No area paths found."
          disabled={disabled || controller.areaPaths.length === 0}
          triggerAriaLabelledBy="azure-area-path-label"
          triggerClassName="w-auto flex-1 bg-card hover:bg-card"
          popoverSide="top"
          wrapLabels
        />
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="shrink-0"
          aria-label="Reload area paths"
          disabled={disabled || controller.isLoadingAreaPaths || !controller.canLoadAreaPaths}
          onClick={controller.reloadAreaPaths}
        >
          <RefreshCcw className={controller.isLoadingAreaPaths ? "animate-spin" : undefined} />
        </Button>
      </div>
    </div>
  );
}

function AreaPathFeedback({
  controller,
  selectedAreaUnavailable,
}: {
  controller: AzureDevOpsGitProviderFormController;
  selectedAreaUnavailable: boolean;
}): ReactElement {
  return (
    <>
      {controller.areaPaths.length === 1 ? (
        <p className="text-xs text-muted-foreground">
          This project has one area path. Add child areas in Azure DevOps to choose a narrower
          scope.
        </p>
      ) : null}
      {controller.areaPathsError ? (
        <p role="alert" className="text-xs text-destructive">
          {controller.areaPathsError}
        </p>
      ) : null}
      {selectedAreaUnavailable ? (
        <p role="alert" className="text-xs text-destructive">
          The saved area is no longer available. Choose an area path and save it.
        </p>
      ) : null}
    </>
  );
}
