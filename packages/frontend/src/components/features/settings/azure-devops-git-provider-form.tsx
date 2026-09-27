import type { SettingsRepoConfig } from "@openducktor/contracts";
import { Cloud } from "lucide-react";
import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AzureDevOpsAreaSettings } from "./azure-devops-area-settings";
import { AzureDevOpsConnectionSettings } from "./azure-devops-connection-settings";
import { AzureDevOpsRepositorySettings } from "./azure-devops-repository-settings";
import {
  useAzureDevOpsGitProviderForm,
  type UseAzureDevOpsGitProviderFormInput,
} from "./use-azure-devops-git-provider-form";
import type { GitProviderState } from "./use-repository-git-section-model";

type AzureDevOpsGitProviderFormProps = {
  selectedRepoPath: string;
  selectedRepoConfig: SettingsRepoConfig;
  providerState: GitProviderState;
  disabled: boolean;
  onSaveSettings: () => Promise<boolean>;
  onValidationChange: UseAzureDevOpsGitProviderFormInput["onValidationChange"];
  onUpdateSelectedRepoConfig: UseAzureDevOpsGitProviderFormInput["onUpdateSelectedRepoConfig"];
};

export function AzureDevOpsGitProviderForm({
  disabled,
  onSaveSettings,
  selectedRepoConfig,
  selectedRepoPath,
  ...input
}: AzureDevOpsGitProviderFormProps): ReactElement {
  const controller = useAzureDevOpsGitProviderForm({
    ...input,
    selectedRepoConfig,
    selectedRepoPath,
  });
  const repositoryReady = controller.connectionInput !== null;
  let readinessLabel = "Link repository";
  let readinessVariant: "success" | "outline" | "warning" = "warning";
  if (!controller.providerEnabled) {
    readinessLabel = "Disabled";
    readinessVariant = "outline";
  } else if (!repositoryReady) {
    readinessLabel = "Link repository";
  } else if (!controller.hasConnectedAccount) {
    readinessLabel = "Connect account";
  } else if (!controller.selectedAreaPath) {
    readinessLabel = "Choose area";
  } else if (controller.isAreaPathDirty) {
    readinessLabel = "Save area";
  } else if (controller.isReady) {
    readinessLabel = "Ready";
    readinessVariant = "success";
  } else {
    readinessLabel = "Check connection";
  }

  return (
    <Card className="min-w-0" role="region" aria-labelledby="azure-devops-heading">
      <CardHeader className="gap-4 border-b border-border pb-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-foreground">
            <Cloud className="size-4" />
          </span>
          <div className="min-w-0 space-y-1">
            <CardTitle id="azure-devops-heading">Azure DevOps setup</CardTitle>
            <CardDescription>
              Link the repository, connect your account, and choose an area for work item imports.
            </CardDescription>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Badge variant={readinessVariant}>{readinessLabel}</Badge>
          <Label className="flex items-center gap-2 text-xs font-medium text-foreground">
            <Switch
              aria-label="Enable Azure DevOps provider"
              checked={controller.providerEnabled}
              disabled={disabled}
              onCheckedChange={controller.setProviderEnabled}
            />
            {controller.providerEnabled ? "Enabled" : "Disabled"}
          </Label>
        </div>
      </CardHeader>

      <CardContent className="grid min-w-0 gap-6">
        <AzureDevOpsRepositorySettings
          controller={controller}
          disabled={disabled}
          repoPath={selectedRepoPath}
          workspaceName={selectedRepoConfig.workspaceName}
        />
        {repositoryReady ? (
          <AzureDevOpsConnectionSettings
            controller={controller}
            disabled={disabled}
            onSaveSettings={onSaveSettings}
          />
        ) : null}
        <AzureDevOpsAreaSettings controller={controller} disabled={disabled} />
      </CardContent>
    </Card>
  );
}
