import { useState, type ComponentProps, type ReactElement } from "react";
import { GithubGitProviderForm } from "../settings/github-git-provider-form";
import type { FieldProps } from "./workspace-provider-fields";

export function GithubSetupFields({ provider, disabled }: FieldProps): ReactElement {
  const [manualOpen, setManualOpen] = useState(
    () => !provider.draft.github.owner || !provider.draft.github.name,
  );
  return (
    <GithubGitProviderForm
      disabled={disabled}
      repositoryErrors={githubErrors(provider)}
      showErrors={provider.error !== null}
      model={githubModel(provider, disabled, manualOpen, () => setManualOpen((open) => !open))}
    />
  );
}

function githubModel(
  provider: FieldProps["provider"],
  disabled: boolean,
  manualOpen: boolean,
  toggleManual: () => void,
): ComponentProps<typeof GithubGitProviderForm>["model"] {
  const { draft, status } = provider;
  const health = status?.health;
  const repositorySlug =
    draft.github.owner && draft.github.name ? `${draft.github.owner}/${draft.github.name}` : null;
  const ready = health?.available === true;
  let cliStatus: ComponentProps<typeof GithubGitProviderForm>["model"]["cliStatus"] = "hidden";
  if (draft.enabled && health) cliStatus = health.executablePath ? "installed" : "missing";
  let readinessLabel = "Disabled";
  if (draft.enabled) {
    readinessLabel = "Not checked";
    if (health) readinessLabel = ready ? "Ready" : "Not ready";
  }
  return {
    cliStatus,
    cliStatusLabel: health?.executablePath ? "gh installed" : "gh not found",
    configuredProviderId: "github",
    detectionMessage: null,
    githubEnabled: draft.enabled,
    githubHost: draft.github.host,
    githubReadinessLabel: readinessLabel,
    githubReadinessMessage: ready
      ? "Provider connection and repository mapping are ready."
      : (health?.reason ?? "Continue checks sign-in and repository access."),
    githubReady: ready,
    githubControlsDisabled: disabled,
    hasConfiguredNonGithubProvider: false,
    isDetecting: provider.detecting,
    isManualConfigOpen: manualOpen || repositorySlug === null,
    providerLabel: "GitHub",
    providerDescription: "GitHub repository hosting.",
    providerStatusLabel: "Pull requests disabled",
    repositoryDraft: draft.github,
    repositorySlug,
    handleDetectFromOrigin: () => void provider.retryDetection(),
    handleGithubEnabledChange: (enabled) => provider.update((current) => ({ ...current, enabled })),
    handleRemoveConfiguredProvider: () =>
      provider.update((current) => ({ ...current, providerId: null })),
    handleRepositoryDraftFieldChange: (field, value) =>
      provider.update((current) => ({
        ...current,
        github: { ...current.github, [field]: value },
      })),
    handleToggleManualEdit: toggleManual,
  };
}

function githubErrors(provider: FieldProps["provider"]) {
  return {
    host: provider.errors["repository.host"] ? "Enter a valid GitHub host." : undefined,
    owner: provider.errors["repository.owner"]
      ? "Enter the repository owner or organization."
      : undefined,
    name: provider.errors["repository.name"] ? "Enter the repository name." : undefined,
  };
}
