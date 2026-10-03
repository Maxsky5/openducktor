import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import type { WorkspaceProviderSetupController } from "./use-workspace-provider-setup";
import { AzureSetupFields } from "./workspace-provider-azure-fields";
import { GithubSetupFields } from "./workspace-provider-github-fields";

export type FieldProps = { provider: WorkspaceProviderSetupController; disabled: boolean };
export function WorkspaceProviderFields({
  provider,
  disabled,
  onSkip,
}: FieldProps & { onSkip: () => Promise<void> }): ReactElement {
  const locked = disabled || provider.pending !== null;
  return (
    <div className="grid gap-5 rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="grid gap-1">
        <Label htmlFor="setup-repository-path">Selected repository path</Label>
        <Input id="setup-repository-path" value={provider.session?.repoPath ?? ""} readOnly />
      </div>
      <DetectionFeedback provider={provider} disabled={locked} />
      <fieldset disabled={locked} className="grid gap-3">
        <legend className="mb-2 text-sm font-medium">Git provider</legend>
        <RadioGroup
          value={provider.draft.providerId ?? "none"}
          onValueChange={(value) => {
            if (value === "none") void onSkip();
            else if (value === "github" || value === "azure_devops")
              provider.update((current) => ({ ...current, providerId: value }));
          }}
          className="flex flex-wrap gap-4"
        >
          {(
            [
              ["none", "No provider"],
              ["github", "GitHub"],
              ["azure_devops", "Azure DevOps"],
            ] as const
          ).map(([value, label]) => (
            <Label
              htmlFor={`setup-provider-${value}`}
              key={value}
              className="flex items-center gap-2"
            >
              <RadioGroupItem id={`setup-provider-${value}`} value={value} disabled={locked} />
              {label}
            </Label>
          ))}
        </RadioGroup>
      </fieldset>
      {provider.draft.providerId ? (
        <>
          <Label htmlFor="setup-provider-enabled" className="flex items-center gap-2">
            <Switch
              id="setup-provider-enabled"
              checked={provider.draft.enabled}
              disabled={locked}
              onCheckedChange={(enabled) => provider.update((current) => ({ ...current, enabled }))}
            />
            Enable integration
          </Label>
          {provider.draft.providerId === "github" ? (
            <GithubSetupFields provider={provider} disabled={locked} />
          ) : (
            <AzureSetupFields provider={provider} disabled={locked} />
          )}
          <Button
            type="button"
            variant="outline"
            disabled={locked}
            onClick={() => void provider.check()}
          >
            Check provider readiness
          </Button>
          {provider.status?.health ? (
            <p role="status" className="text-sm">
              {provider.status.health.available
                ? "Provider connection and repository mapping are ready."
                : provider.status.health.reason}
            </p>
          ) : null}
        </>
      ) : null}
      {provider.pending ? (
        <p role="status" className="text-sm text-muted-foreground">
          {provider.pending}...
        </p>
      ) : null}
      {provider.error ? (
        <div className="grid gap-2">
          <p role="alert" className="text-sm text-destructive">
            {provider.error} Correct the input, read setup state, or retry the action.
          </p>
          {provider.session ? (
            <Button
              type="button"
              variant="outline"
              disabled={locked}
              onClick={() => void provider.recover()}
            >
              Read setup state
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DetectionFeedback({ provider, disabled }: FieldProps): ReactElement {
  const repository = provider.detection?.candidates[0]?.config.repository;
  let detectedIdentity: string | null = null;
  if (repository) {
    detectedIdentity =
      "deployment" in repository
        ? `${repository.serviceUrl}/${repository.organization}/${repository.project}/${repository.name}`
        : `${repository.host}/${repository.owner}/${repository.name}`;
  }
  return (
    <div className="grid gap-2">
      {provider.detecting ? (
        <p role="status" className="text-sm text-muted-foreground">
          Detecting Git provider...
        </p>
      ) : null}
      {provider.detectionError ? (
        <p role="alert" className="text-sm text-destructive">
          {provider.detectionError} Retry detection, enter details manually, or skip setup.
        </p>
      ) : null}
      {provider.detection?.outcome === "none" ? (
        <p className="text-sm text-muted-foreground">
          No supported provider was detected. Enter details manually or skip setup.
        </p>
      ) : null}
      {provider.detection?.outcome === "ambiguous" ? (
        <p className="text-sm text-muted-foreground">
          Remotes identify different repositories or providers. Enter the intended repository
          manually or skip setup.
        </p>
      ) : null}
      {provider.draft.autoDetected && !provider.detectionProposal ? (
        <p className="text-sm text-muted-foreground">
          Detected from {provider.detection?.candidates[0]?.remoteNames.join(", ")}. Review the
          details below.
        </p>
      ) : null}
      {provider.detectionProposal ? (
        <div className="grid gap-2">
          <p className="break-all text-xs text-muted-foreground">
            Detection found {detectedIdentity}. Your manual choices remain below.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || provider.detecting}
            onClick={() => void provider.acceptDetection()}
          >
            Use detected repository
          </Button>
        </div>
      ) : null}
      <Button
        type="button"
        variant="outline"
        disabled={disabled || provider.detecting}
        onClick={() => void provider.retryDetection()}
      >
        Retry detection
      </Button>
    </div>
  );
}
