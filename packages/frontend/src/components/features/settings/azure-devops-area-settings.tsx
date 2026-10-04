import { RefreshCcw } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import type { AzureDevOpsGitProviderFormController } from "./use-azure-devops-git-provider-form";

type AzureAreaController = Pick<
  AzureDevOpsGitProviderFormController,
  | "providerEnabled"
  | "connectionInput"
  | "canManageConnection"
  | "hasConnectedAccount"
  | "areaPaths"
  | "selectedAreaPath"
  | "isLoadingAreaPaths"
  | "setAreaPath"
  | "canLoadAreaPaths"
  | "reloadAreaPaths"
  | "areaPathsError"
>;

type AzureDevOpsAreaSettingsProps = {
  controller: AzureAreaController;
  disabled: boolean;
};

const areaPrerequisite = (controller: AzureAreaController): string | null => {
  if (!controller.providerEnabled) return "Enable Azure DevOps to choose an area.";
  if (!controller.connectionInput) return "Link a repository to choose an area.";
  if (!controller.canManageConnection)
    return "Save the repository mapping in Connection before choosing an area.";
  if (!controller.hasConnectedAccount)
    return "Connect your Azure DevOps account above to load its area paths.";
  return null;
};

export function AzureDevOpsAreaSettings(props: AzureDevOpsAreaSettingsProps): ReactElement {
  return (
    <AzureDevOpsAreaSection
      {...props}
      description="Choose the area to import from. Imports include its child areas."
    />
  );
}

export function AzureDevOpsSetupArea({
  controller,
  disabled,
}: AzureDevOpsAreaSettingsProps): ReactElement {
  return (
    <AzureDevOpsAreaSection
      controller={controller}
      disabled={disabled}
      description="Optional for setup. Choose an area to import work items later."
    >
      {controller.selectedAreaPath ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="justify-self-start"
          disabled={disabled}
          onClick={() => controller.setAreaPath("")}
        >
          Clear area
        </Button>
      ) : null}
    </AzureDevOpsAreaSection>
  );
}

function AzureDevOpsAreaSection({
  controller,
  disabled,
  description,
  children,
}: AzureDevOpsAreaSettingsProps & { description: string; children?: ReactNode }): ReactElement {
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
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {prerequisite ? (
        <p className="text-xs text-muted-foreground">{prerequisite}</p>
      ) : (
        <div className="grid min-w-0 gap-3">
          <AreaPathPicker
            controller={controller}
            disabled={disabled}
            selectedArea={availableSelectedArea ?? controller.selectedAreaPath}
          >
            {children}
          </AreaPathPicker>
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
  children,
}: {
  controller: AzureAreaController;
  disabled: boolean;
  selectedArea: string;
  children?: ReactNode;
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
          <span
            className={
              controller.isLoadingAreaPaths
                ? "inline-flex size-4 animate-spin"
                : "inline-flex size-4"
            }
          >
            <RefreshCcw className="size-4" />
          </span>
        </Button>
      </div>
      {children}
    </div>
  );
}

function AreaPathFeedback({
  controller,
  selectedAreaUnavailable,
}: {
  controller: AzureAreaController;
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
