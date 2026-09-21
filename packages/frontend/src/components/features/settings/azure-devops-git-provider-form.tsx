import type { SettingsRepoConfig } from "@openducktor/contracts";
import { Check, Cloud, Link2 } from "lucide-react";
import { type ReactElement, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
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

type AzureSetupStep = "repository" | "connection";

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
  const [activeStep, setActiveStep] = useState<AzureSetupStep>(() =>
    controller.canManageConnection && controller.connectionInput ? "connection" : "repository",
  );
  const repositoryReady = controller.connectionInput !== null;
  let readinessLabel = "Setup required";
  let readinessVariant: "success" | "outline" | "warning" = "warning";
  if (controller.isReady) {
    readinessLabel = "Ready";
    readinessVariant = "success";
  } else if (repositoryReady) {
    readinessLabel = "Repository found";
    readinessVariant = "outline";
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
              Link this repository, then connect the Azure DevOps account that can access it.
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

      <CardContent className="grid min-w-0 gap-5">
        <SetupSteps
          activeStep={activeStep}
          connectionAvailable={repositoryReady}
          onStepChange={setActiveStep}
        />

        {activeStep === "repository" ? (
          <AzureDevOpsRepositorySettings
            controller={controller}
            disabled={disabled}
            repoPath={selectedRepoPath}
            workspaceName={selectedRepoConfig.workspaceName}
            onContinue={() => setActiveStep("connection")}
          />
        ) : (
          <AzureDevOpsConnectionSettings
            controller={controller}
            disabled={disabled}
            onBack={() => setActiveStep("repository")}
            onSaveSettings={onSaveSettings}
          />
        )}
      </CardContent>
    </Card>
  );
}

type SetupStepsProps = {
  activeStep: AzureSetupStep;
  connectionAvailable: boolean;
  onStepChange: (step: AzureSetupStep) => void;
};

function SetupSteps({
  activeStep,
  connectionAvailable,
  onStepChange,
}: SetupStepsProps): ReactElement {
  return (
    <nav aria-label="Azure DevOps setup" className="grid min-w-0 grid-cols-2 gap-2">
      <SetupStep
        active={activeStep === "repository"}
        complete={connectionAvailable}
        icon={connectionAvailable ? Check : Link2}
        label="Repository"
        number={1}
        onClick={() => onStepChange("repository")}
      />
      <SetupStep
        active={activeStep === "connection"}
        complete={false}
        disabled={!connectionAvailable}
        icon={Cloud}
        label="Connection"
        number={2}
        onClick={() => onStepChange("connection")}
      />
    </nav>
  );
}

type SetupStepProps = {
  active: boolean;
  complete: boolean;
  disabled?: boolean;
  icon: typeof Link2;
  label: string;
  number: number;
  onClick: () => void;
};

function SetupStep({
  active,
  complete,
  disabled = false,
  icon: Icon,
  label,
  number,
  onClick,
}: SetupStepProps): ReactElement {
  let description = "Sign in or add a PAT";
  if (label === "Repository") {
    description = complete ? "Details ready" : "Detect or enter details";
  }

  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        "h-auto min-w-0 justify-start gap-3 border border-border px-3 py-2.5 text-left hover:bg-accent/50",
        active && "border-selected-accent bg-selected-surface hover:bg-selected-surface",
      )}
      disabled={disabled}
      aria-current={active ? "step" : undefined}
      onClick={onClick}
    >
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-xs text-muted-foreground",
          active && "border-selected-accent bg-selected-control text-selected-control-foreground",
          complete &&
            !active &&
            "border-success-border bg-success-surface text-success-surface-foreground",
        )}
      >
        {complete ? <Icon className="size-3.5" /> : number}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">{label}</span>
        <span
          className={cn(
            "block truncate text-xs font-normal",
            active ? "text-foreground/80" : "text-muted-foreground",
          )}
        >
          {description}
        </span>
      </span>
    </Button>
  );
}
