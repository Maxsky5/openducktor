import {
  AZURE_DEVOPS_PROVIDER_DESCRIPTOR,
  GITHUB_PROVIDER_DESCRIPTOR,
  type GitProviderRepository,
  type SettingsRepoConfig,
} from "@openducktor/contracts";
import { Check, CircleOff, Github, LoaderCircle, PencilLine, RefreshCcw } from "lucide-react";
import type { ComponentType, ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  type GithubCliStatus,
  type GithubRepositoryDraft,
  type GitProviderState,
  useRepositoryGitSectionModel,
} from "./use-repository-git-section-model";
import { AzureDevOpsGitProviderForm } from "./azure-devops-git-provider-form";

type RepositoryGitSectionProps = {
  selectedRepoPath: string | null;
  selectedRepoConfig: SettingsRepoConfig | null;
  providerState: GitProviderState;
  disabled: boolean;
  onDetectGithubRepository: () => Promise<GitProviderRepository | null>;
  onSaveSettings?: () => Promise<boolean>;
  onAzureDevOpsValidationChange?: (errorCount: number) => void;
  onUpdateSelectedRepoConfig: (
    updater: (current: SettingsRepoConfig) => SettingsRepoConfig,
  ) => void;
};

const ignoreValidationChange = (): void => undefined;
const ignoreSaveSettings = async (): Promise<boolean> => false;

type GitProviderSelection = "none" | "github" | "azure_devops" | "unsupported";

type GitProviderSelectorProps = {
  disabled: boolean;
  selectedProviderId: GitProviderSelection;
  onSelect: (providerId: Exclude<GitProviderSelection, "unsupported">) => void;
};

function AzureDevOpsIcon({ className }: { className?: string }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M0 8.899l2.247-2.966 8.405-3.416V.045l7.37 5.393L2.966 8.36v8.224L0 15.73zm24-4.45v14.652L18.247 24l-9.303-3.056V24l-5.978-7.416 15.057 1.798V5.438z" />
    </svg>
  );
}

const gitProviderOptions = [
  {
    value: "none",
    label: "No provider",
    icon: CircleOff,
  },
  {
    value: "github",
    label: GITHUB_PROVIDER_DESCRIPTOR.label,
    icon: Github,
  },
  {
    value: "azure_devops",
    label: AZURE_DEVOPS_PROVIDER_DESCRIPTOR.label,
    icon: AzureDevOpsIcon,
  },
] as const satisfies ReadonlyArray<{
  value: Exclude<GitProviderSelection, "unsupported">;
  label: string;
  icon: ComponentType<{ className?: string }>;
}>;

const selectableProvider = (providerId: string | undefined): GitProviderSelection => {
  if (providerId === undefined) return "none";
  if (providerId === "github" || providerId === "azure_devops") return providerId;
  return "unsupported";
};

function GitProviderSelector({
  disabled,
  selectedProviderId,
  onSelect,
}: GitProviderSelectorProps): ReactElement {
  return (
    <fieldset className="grid min-w-0 gap-3 border-b border-border pb-5" disabled={disabled}>
      <legend className="text-sm font-semibold text-foreground">Git provider</legend>
      <p className="mt-1 text-xs text-muted-foreground">
        Optional. Choose which service OpenDucktor uses for pull requests.
      </p>
      <RadioGroup
        aria-label="Git provider"
        value={selectedProviderId}
        disabled={disabled}
        className="grid grid-cols-1 gap-2 md:grid-cols-3"
        onValueChange={(providerId) => {
          if (providerId === "none" || providerId === "github" || providerId === "azure_devops") {
            onSelect(providerId);
          }
        }}
      >
        {gitProviderOptions.map((option) => {
          const Icon = option.icon;
          const selected = selectedProviderId === option.value;
          return (
            <Label
              key={option.value}
              htmlFor={`git-provider-${option.value}`}
              className={cn(
                "relative flex min-h-14 min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-input bg-card p-3 transition-colors hover:bg-accent/50",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/40",
                selected && "border-primary shadow-sm hover:bg-card",
              )}
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground",
                  selected && "border-primary bg-primary text-primary-foreground",
                )}
              >
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1 pr-6">
                <span className="block truncate text-sm font-medium text-foreground">
                  {option.label}
                </span>
              </span>
              <RadioGroupItem
                id={`git-provider-${option.value}`}
                value={option.value}
                className="sr-only"
              />
              {selected ? <Check className="absolute right-3 size-4 text-primary" /> : null}
            </Label>
          );
        })}
      </RadioGroup>
      {selectedProviderId === "unsupported" ? (
        <p className="text-xs text-warning-surface-foreground">
          This repository uses a provider that this settings page cannot edit.
        </p>
      ) : null}
    </fieldset>
  );
}

const cliStatusBadgeVariant = (
  status: Exclude<GithubCliStatus, "hidden">,
): "success" | "danger" | "outline" => {
  if (status === "installed") {
    return "success";
  }
  if (status === "missing" || status === "error") {
    return "danger";
  }
  return "outline";
};

type RepositoryGitStatusHeaderProps = {
  githubReady: boolean;
  githubReadinessLabel: string;
  githubReadinessMessage: string;
  providerDescription: string;
  providerTitle: string;
};

function RepositoryGitStatusHeader({
  githubReady,
  githubReadinessLabel,
  githubReadinessMessage,
  providerDescription,
  providerTitle,
}: RepositoryGitStatusHeaderProps): ReactElement {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="rounded-md border border-border bg-muted p-2 text-foreground">
          <Github className="size-4" />
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">{providerTitle}</h3>
          <p className="text-xs text-muted-foreground">{providerDescription}</p>
          <p className="text-xs text-muted-foreground">{githubReadinessMessage}</p>
        </div>
      </div>
      <Badge variant={githubReady ? "success" : "warning"}>{githubReadinessLabel}</Badge>
    </div>
  );
}

type RepositoryGitEnableCardProps = {
  disabled: boolean;
  githubEnabled: boolean;
  onCheckedChange: (checked: boolean) => void;
};

function RepositoryGitEnableCard({
  disabled,
  githubEnabled,
  onCheckedChange,
}: RepositoryGitEnableCardProps): ReactElement {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Enable GitHub</p>
        <p className="text-xs text-muted-foreground">
          Allow pull request actions for this repository.
        </p>
      </div>
      <Label className="flex items-center gap-3 text-sm font-medium text-foreground">
        <Switch checked={githubEnabled} disabled={disabled} onCheckedChange={onCheckedChange} />
        {githubEnabled ? "Enabled" : "Disabled"}
      </Label>
    </div>
  );
}

type RepositoryGitMappingCardProps = {
  disabled: boolean;
  githubHost: string;
  isDetecting: boolean;
  isManualConfigOpen: boolean;
  repositorySlug: string | null;
  onDetectFromOrigin: () => void;
  onToggleManualEdit: () => void;
};

function RepositoryGitMappingCard({
  disabled,
  githubHost,
  isDetecting,
  isManualConfigOpen,
  repositorySlug,
  onDetectFromOrigin,
  onToggleManualEdit,
}: RepositoryGitMappingCardProps): ReactElement {
  return (
    <div className="grid gap-3 rounded-md border border-border bg-card p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Repository</p>
          <p className="text-xs text-muted-foreground">
            {repositorySlug
              ? `${repositorySlug} on ${githubHost}`
              : "Detect from origin or enter the repository details."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={disabled || isDetecting}
            onClick={onDetectFromOrigin}
          >
            {isDetecting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <RefreshCcw className="size-4" />
            )}
            Detect from origin
          </Button>
          <Button type="button" variant="ghost" disabled={disabled} onClick={onToggleManualEdit}>
            <PencilLine className="size-4" />
            {isManualConfigOpen ? "Hide manual edit" : "Edit manually"}
          </Button>
        </div>
      </div>
    </div>
  );
}

type RepositoryGitManualConfigFormProps = {
  disabled: boolean;
  repositoryDraft: GithubRepositoryDraft;
  onDraftFieldChange: (field: keyof GithubRepositoryDraft, value: string) => void;
};

function RepositoryGitManualConfigForm({
  disabled,
  repositoryDraft,
  onDraftFieldChange,
}: RepositoryGitManualConfigFormProps): ReactElement {
  return (
    <div className="grid gap-4 rounded-md border border-border bg-card p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="repo-github-host">Host</Label>
          <Input
            id="repo-github-host"
            value={repositoryDraft.host}
            disabled={disabled}
            onChange={(event) => onDraftFieldChange("host", event.currentTarget.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="repo-github-owner">Owner</Label>
          <Input
            id="repo-github-owner"
            value={repositoryDraft.owner}
            disabled={disabled}
            onChange={(event) => onDraftFieldChange("owner", event.currentTarget.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="repo-github-name">Repository</Label>
          <Input
            id="repo-github-name"
            value={repositoryDraft.name}
            disabled={disabled}
            onChange={(event) => onDraftFieldChange("name", event.currentTarget.value)}
          />
        </div>
      </div>
    </div>
  );
}

type RepositoryGithubProviderCardProps = {
  disabled: boolean;
  model: ReturnType<typeof useRepositoryGitSectionModel>;
};

function RepositoryGithubProviderCard({
  disabled,
  model,
}: RepositoryGithubProviderCardProps): ReactElement {
  const {
    cliStatusLabel,
    cliStatus,
    configuredProviderId,
    detectionMessage,
    githubEnabled,
    githubHost,
    githubReadinessLabel,
    githubReadinessMessage,
    githubReady,
    githubControlsDisabled,
    hasConfiguredNonGithubProvider,
    isDetecting,
    isManualConfigOpen,
    providerStatusLabel,
    providerDescription,
    providerLabel,
    repositoryDraft,
    repositorySlug,
    usesDefaultGithubHost,
    handleDetectFromOrigin,
    handleGithubEnabledChange,
    handleRemoveConfiguredProvider,
    handleRepositoryDraftFieldChange,
    handleToggleManualEdit,
  } = model;

  return (
    <div className="grid gap-4">
      <RepositoryGitStatusHeader
        githubReady={githubReady}
        githubReadinessLabel={githubReadinessLabel}
        githubReadinessMessage={githubReadinessMessage}
        providerDescription={providerDescription}
        providerTitle={providerLabel}
      />
      <div className="grid gap-4">
        {hasConfiguredNonGithubProvider ? (
          <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {configuredProviderId} provider configured
              </p>
              <p className="text-sm text-muted-foreground">
                Remove this provider before configuring GitHub for this repository.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={handleRemoveConfiguredProvider}
            >
              Remove provider
            </Button>
          </div>
        ) : (
          <>
            <RepositoryGitEnableCard
              disabled={githubControlsDisabled}
              githubEnabled={githubEnabled}
              onCheckedChange={handleGithubEnabledChange}
            />

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={githubEnabled ? "success" : "warning"}>{providerStatusLabel}</Badge>
              {cliStatus === "hidden" ? null : (
                <Badge variant={cliStatusBadgeVariant(cliStatus)}>{cliStatusLabel}</Badge>
              )}
              {usesDefaultGithubHost ? null : <Badge variant="outline">{githubHost}</Badge>}
            </div>

            <RepositoryGitMappingCard
              disabled={githubControlsDisabled}
              githubHost={githubHost}
              isDetecting={isDetecting}
              isManualConfigOpen={isManualConfigOpen}
              repositorySlug={repositorySlug}
              onDetectFromOrigin={handleDetectFromOrigin}
              onToggleManualEdit={handleToggleManualEdit}
            />

            {detectionMessage ? (
              <p className="text-sm text-muted-foreground">{detectionMessage}</p>
            ) : null}

            {isManualConfigOpen ? (
              <RepositoryGitManualConfigForm
                disabled={githubControlsDisabled}
                repositoryDraft={repositoryDraft}
                onDraftFieldChange={handleRepositoryDraftFieldChange}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export function RepositoryGitSection({
  selectedRepoPath,
  selectedRepoConfig,
  providerState,
  disabled,
  onDetectGithubRepository,
  onSaveSettings = ignoreSaveSettings,
  onAzureDevOpsValidationChange = ignoreValidationChange,
  onUpdateSelectedRepoConfig,
}: RepositoryGitSectionProps): ReactElement {
  const model = useRepositoryGitSectionModel({
    disabled,
    onDetectGithubRepository,
    onUpdateSelectedRepoConfig,
    providerState,
    selectedRepoConfig,
    selectedRepoPath,
  });

  if (!selectedRepoConfig) {
    return (
      <div className="rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-warning-surface-foreground">
        Select a repository to edit Git provider settings.
      </div>
    );
  }

  const selectedProviderId = selectedRepoConfig.git.provider?.id;
  const selectProvider = (providerId: Exclude<GitProviderSelection, "unsupported">): void => {
    if (providerId !== "azure_devops") {
      onAzureDevOpsValidationChange(0);
    }
    onUpdateSelectedRepoConfig((repoConfig) => {
      if (providerId === "none") {
        if (!repoConfig.git.provider) return repoConfig;
        const { provider: _provider, ...git } = repoConfig.git;
        return { ...repoConfig, git };
      }
      if (repoConfig.git.provider?.id === providerId) return repoConfig;
      return {
        ...repoConfig,
        git: {
          ...repoConfig.git,
          provider: {
            id: providerId,
            enabled: true,
            autoDetected: false,
          },
        },
      };
    });
  };

  const providerSelection = (
    <GitProviderSelector
      disabled={disabled}
      selectedProviderId={selectableProvider(selectedProviderId)}
      onSelect={selectProvider}
    />
  );

  if (selectedProviderId === AZURE_DEVOPS_PROVIDER_DESCRIPTOR.id) {
    return (
      <div className="grid gap-4 p-4">
        {providerSelection}
        <AzureDevOpsGitProviderForm
          key={selectedRepoConfig.workspaceId}
          selectedRepoPath={selectedRepoPath ?? ""}
          selectedRepoConfig={selectedRepoConfig}
          providerState={providerState}
          disabled={disabled}
          onSaveSettings={onSaveSettings}
          onValidationChange={onAzureDevOpsValidationChange}
          onUpdateSelectedRepoConfig={onUpdateSelectedRepoConfig}
        />
      </div>
    );
  }

  if (selectedProviderId === undefined) {
    return <div className="p-4">{providerSelection}</div>;
  }

  return (
    <div className="grid gap-4 p-4">
      {providerSelection}
      <RepositoryGithubProviderCard disabled={disabled} model={model} />
    </div>
  );
}
