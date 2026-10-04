import { FolderGit2, RefreshCcw } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { GitProviderSelector } from "../settings/git-provider-selector";
import type { WorkspaceProviderSetupController } from "./use-workspace-provider-setup";
import { AzureSetupFields } from "./workspace-provider-azure-fields";
import { GithubSetupFields } from "./workspace-provider-github-fields";

export type FieldProps = { provider: WorkspaceProviderSetupController; disabled: boolean };
export function WorkspaceProviderFields({ provider, disabled }: FieldProps): ReactElement {
  const locked = disabled || provider.pending !== null;
  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
        <FolderGit2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Selected repository</p>
          <output
            aria-label="Selected repository path"
            className="block truncate font-mono text-xs text-foreground"
            title={provider.session?.repoPath}
          >
            {provider.session?.repoPath}
          </output>
        </div>
      </div>
      <DetectionFeedback provider={provider} disabled={locked} />
      <GitProviderSelector
        disabled={locked}
        selectedProviderId={provider.draft.providerId ?? "none"}
        onSelect={(providerId) =>
          provider.update((current) => ({
            ...current,
            providerId: providerId === "none" ? null : providerId,
          }))
        }
      />
      {provider.draft.providerId === "github" ? (
        <GithubSetupFields provider={provider} disabled={locked} />
      ) : null}
      {provider.draft.providerId === "azure_devops" ? (
        <AzureSetupFields provider={provider} disabled={locked} />
      ) : null}
      {provider.error ? (
        <div className="grid min-w-0 gap-3 rounded-lg border border-destructive-border bg-destructive-surface p-3">
          <p
            role="alert"
            className="break-words text-xs leading-5 text-destructive-surface-foreground"
          >
            {provider.error} Correct the input, read setup state, or retry the action.
          </p>
          {provider.session ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="justify-self-start"
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

function DetectionFeedback({ provider, disabled }: FieldProps): ReactElement | null {
  const message = detectionMessage(provider);
  if (!message) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
      <p
        role={provider.detectionError ? "alert" : "status"}
        className="min-w-0 flex-1 break-words text-xs leading-5 text-muted-foreground"
      >
        {message}
      </p>
      {provider.detectionProposal ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || provider.detecting}
          onClick={() => void provider.acceptDetection()}
        >
          Use detected repository
        </Button>
      ) : null}
      {!provider.draft.providerId ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled || provider.detecting}
          onClick={() => void provider.retryDetection()}
        >
          <span
            className={
              provider.detecting ? "inline-flex size-3.5 animate-spin" : "inline-flex size-3.5"
            }
          >
            <RefreshCcw className="size-3.5" />
          </span>
          Retry detection
        </Button>
      ) : null}
    </div>
  );
}

function detectionMessage(provider: FieldProps["provider"]): string | null {
  const repository = provider.detection?.candidates[0]?.config.repository;
  let identity: string | null = null;
  if (repository) {
    identity =
      "deployment" in repository
        ? `${repository.organization}/${repository.project}/${repository.name}`
        : `${repository.host}/${repository.owner}/${repository.name}`;
  }
  let message: string | null = null;
  if (provider.detecting) message = "Detecting Git provider…";
  else if (provider.detectionError)
    message = `${provider.detectionError} Retry detection or enter details manually.`;
  else if (provider.detection?.outcome === "none")
    message = "No supported remote found. Choose a provider below or skip setup.";
  else if (provider.detection?.outcome === "ambiguous")
    message =
      "Remotes point to different repositories. Choose the provider and enter the intended repository.";
  else if (provider.detectionProposal)
    message = `Detected ${identity}. Your edits remain in the form.`;
  return message;
}
