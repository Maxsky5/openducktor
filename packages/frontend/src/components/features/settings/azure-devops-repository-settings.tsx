import { Check, LoaderCircle, PencilLine, RefreshCcw } from "lucide-react";
import { type ReactElement, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import type { AzureRepositoryDraftField } from "./azure-devops-git-provider-form-model";
import { AzureDevOpsRemoteMappings } from "./azure-devops-remote-mappings";
import type { AzureDevOpsGitProviderFormController } from "./use-azure-devops-git-provider-form";

type AzureDevOpsRepositorySettingsProps = {
  controller: AzureDevOpsGitProviderFormController;
  disabled: boolean;
  repoPath: string;
  workspaceName: string;
};

const fieldLabels = {
  deployment: "Deployment",
  serviceUrl: "Server address",
  organization: "Organization",
  project: "Project",
  name: "Repository",
} satisfies Partial<Record<AzureRepositoryDraftField, string>>;

const fieldPlaceholders = {
  serviceUrl: "https://azure.example.com",
  organization: "my-organization",
  project: "My project",
  name: "my-repository",
} satisfies Partial<Record<AzureRepositoryDraftField, string>>;

const fieldErrorMessage = (
  field: AzureRepositoryDraftField,
  error: string | null,
): string | null => {
  if (!error) return null;
  if (field === "serviceUrl") return "Enter a valid HTTP or HTTPS server address.";
  return `${fieldLabels[field] ?? "This field"} is required.`;
};

export function AzureDevOpsRepositorySettings({
  controller,
  disabled,
  repoPath,
  workspaceName,
}: AzureDevOpsRepositorySettingsProps): ReactElement {
  const { detectRepository, draft, isDetecting, repositoryActionError, updateDraft } = controller;
  const [manualOpen, setManualOpen] = useState(false);
  const [touchedFields, setTouchedFields] = useState<Set<AzureRepositoryDraftField>>(
    () => new Set(),
  );
  const repositoryReady = controller.connectionInput !== null;

  const markFieldTouched = (field: AzureRepositoryDraftField): void => {
    setTouchedFields((current) => new Set(current).add(field));
  };

  const updateField = (field: AzureRepositoryDraftField, value: string): void => {
    updateDraft({ ...draft, [field]: value });
  };

  const handleDetection = async (): Promise<void> => {
    const detected = await detectRepository();
    if (detected) setManualOpen(false);
  };

  return (
    <section className="grid min-w-0 gap-4" aria-labelledby="azure-repository-heading">
      <div className="space-y-1">
        <h3 id="azure-repository-heading" className="text-sm font-semibold text-foreground">
          1. Repository
        </h3>
        <p className="text-xs text-muted-foreground">
          Detect the Azure Repos remote from the selected workspace, or enter its address.
        </p>
      </div>

      <div className="grid min-w-0 gap-3 rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-0.5">
            <p className="truncate text-sm font-medium text-foreground" title={workspaceName}>
              {workspaceName}
            </p>
            <p className="truncate font-mono text-xs text-muted-foreground" title={repoPath}>
              {repoPath}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled || isDetecting}
              onClick={() => void handleDetection()}
            >
              {isDetecting ? (
                <LoaderCircle data-icon="inline-start" className="animate-spin" />
              ) : (
                <RefreshCcw data-icon="inline-start" />
              )}
              Detect remote
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => setManualOpen((open) => !open)}
            >
              <PencilLine data-icon="inline-start" />
              {manualOpen ? "Hide manual entry" : "Enter manually"}
            </Button>
          </div>
        </div>

        {repositoryActionError ? (
          <p
            role="alert"
            className="min-w-0 break-words rounded-md border border-destructive-border bg-destructive-surface p-3 text-xs leading-5 text-destructive-surface-foreground"
          >
            {repositoryActionError}
          </p>
        ) : null}
      </div>

      {repositoryReady && !manualOpen ? (
        <div className="grid min-w-0 gap-3 rounded-lg border border-success-border bg-success-surface p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 items-center gap-2">
              <Check className="size-4 shrink-0 text-success-surface-foreground" />
              <p className="truncate text-sm font-medium text-success-surface-foreground">
                {draft.project} / {draft.name}
              </p>
            </div>
            <p className="truncate pl-6 text-xs text-success-muted" title={draft.serviceUrl}>
              {draft.deployment === "services"
                ? `dev.azure.com/${draft.organization}`
                : draft.serviceUrl}
            </p>
          </div>
          <Badge variant="success">Repository ready</Badge>
        </div>
      ) : null}

      {manualOpen ? (
        <ManualRepositoryForm
          controller={controller}
          disabled={disabled}
          touchedFields={touchedFields}
          markFieldTouched={markFieldTouched}
          updateField={updateField}
        />
      ) : null}
    </section>
  );
}

type ManualRepositoryFormProps = {
  controller: AzureDevOpsGitProviderFormController;
  disabled: boolean;
  touchedFields: Set<AzureRepositoryDraftField>;
  markFieldTouched: (field: AzureRepositoryDraftField) => void;
  updateField: (field: AzureRepositoryDraftField, value: string) => void;
};

function ManualRepositoryForm({
  controller,
  disabled,
  markFieldTouched,
  touchedFields,
  updateField,
}: ManualRepositoryFormProps): ReactElement {
  const {
    consentGranted,
    draft,
    httpCollectionUrl,
    mappingErrors,
    remoteMappingDrafts,
    repositoryErrors,
    setHttpConsent,
    updateDraft,
    updateRemoteMappings,
  } = controller;

  return (
    <div className="grid min-w-0 gap-5 rounded-lg border border-border p-4">
      <fieldset className="grid gap-3" disabled={disabled}>
        <legend className="text-sm font-medium text-foreground">Azure DevOps product</legend>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose Microsoft-hosted Azure DevOps or your organization's server.
        </p>
        <RadioGroup
          aria-label="Azure DevOps product"
          value={draft.deployment}
          disabled={disabled}
          className="grid gap-2 md:grid-cols-2"
          onValueChange={(deployment) => {
            if (deployment !== "services" && deployment !== "server") return;
            let serviceUrl = draft.serviceUrl;
            if (deployment === "services") {
              serviceUrl = "https://dev.azure.com";
            } else if (draft.deployment === "services") {
              serviceUrl = "";
            }
            updateDraft({
              ...draft,
              deployment,
              serviceUrl,
            });
          }}
        >
          {(
            [
              ["services", "Azure DevOps Services", "Microsoft-hosted at dev.azure.com."],
              ["server", "Azure DevOps Server", "Hosted by your organization."],
            ] as const
          ).map(([deployment, label, description]) => (
            <Label
              key={deployment}
              htmlFor={`repo-azure-deployment-${deployment}`}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border border-input bg-card p-3 transition-colors hover:bg-accent/50",
                draft.deployment === deployment && "border-selected-accent bg-selected-surface",
              )}
            >
              <RadioGroupItem
                id={`repo-azure-deployment-${deployment}`}
                value={deployment}
                className="mt-0.5"
              />
              <span className="min-w-0 space-y-0.5">
                <span className="block text-sm font-medium text-foreground">{label}</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {description}
                </span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </fieldset>

      <div className="grid gap-4 md:grid-cols-2">
        {(
          [
            ...(draft.deployment === "server" ? (["serviceUrl"] as const) : []),
            "organization",
            "project",
            "name",
          ] as const
        ).map((field) => {
          const label =
            field === "organization" && draft.deployment === "server"
              ? "Collection"
              : fieldLabels[field];
          const error = touchedFields.has(field)
            ? fieldErrorMessage(field, repositoryErrors[field])
            : null;
          return (
            <div
              key={field}
              className={cn("grid min-w-0 gap-2", field === "serviceUrl" && "md:col-span-2")}
            >
              <Label htmlFor={`repo-azure-${field}`}>{label}</Label>
              <Input
                id={`repo-azure-${field}`}
                value={draft[field]}
                placeholder={fieldPlaceholders[field]}
                disabled={disabled}
                onBlur={() => markFieldTouched(field)}
                onChange={(event) => updateField(field, event.currentTarget.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `repo-azure-${field}-error` : undefined}
              />
              {field === "serviceUrl" ? (
                <p className="text-xs text-muted-foreground">
                  Include the full path if your server uses one.
                </p>
              ) : null}
              {error ? (
                <p id={`repo-azure-${field}-error`} role="alert" className="text-xs text-danger">
                  {error}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <AzureDevOpsRemoteMappings
        disabled={disabled}
        drafts={remoteMappingDrafts}
        errors={mappingErrors}
        onChange={updateRemoteMappings}
      />

      {httpCollectionUrl ? (
        <Label className="flex min-w-0 items-start gap-3 rounded-md border border-warning-border bg-warning-surface p-3 text-sm">
          <Checkbox
            checked={consentGranted}
            disabled={disabled}
            onCheckedChange={(checked) => setHttpConsent(checked === true)}
          />
          <span className="min-w-0 break-words">
            Allow credentials over unencrypted HTTP to this exact collection: {httpCollectionUrl}
          </span>
        </Label>
      ) : null}
    </div>
  );
}
