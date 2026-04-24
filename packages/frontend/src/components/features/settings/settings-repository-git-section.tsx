import type { GitProviderRepository, RepoConfig, RuntimeCheck } from "@openducktor/contracts";
import { Github, LoaderCircle, PencilLine, RefreshCcw } from "lucide-react";
import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  type GithubRepositoryDraft,
  useRepositoryGitSectionModel,
} from "./use-repository-git-section-model";

type RepositoryGitSectionProps = {
  selectedRepoPath: string | null;
  selectedRepoConfig: RepoConfig | null;
  runtimeCheck: RuntimeCheck | null;
  disabled: boolean;
  onDetectGithubRepository: () => Promise<GitProviderRepository | null>;
  onUpdateSelectedRepoConfig: (updater: (current: RepoConfig) => RepoConfig) => void;
};

type RepositoryGitStatusHeaderProps = {
  githubReady: boolean;
  githubReadinessLabel: string;
  githubReadinessMessage: string;
};

function RepositoryGitStatusHeader({
  githubReady,
  githubReadinessLabel,
  githubReadinessMessage,
}: RepositoryGitStatusHeaderProps): ReactElement {
  return (
    <CardHeader className="gap-4 border-b border-border/70 pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="rounded-lg border border-border bg-muted p-2 text-foreground">
          <Github className="size-5" />
        </div>
        <div className="space-y-1">
          <CardTitle>GitHub Pull Requests</CardTitle>
          <CardDescription>{githubReadinessMessage}</CardDescription>
        </div>
      </div>
      <Badge variant={githubReady ? "success" : "warning"}>{githubReadinessLabel}</Badge>
    </CardHeader>
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
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Enable provider for approvals</p>
        <p className="text-sm text-muted-foreground">
          When enabled, approved tasks can be delivered as GitHub pull requests.
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
    <div className="grid gap-3 rounded-xl border border-border p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Repository mapping</p>
        <p className="text-sm text-muted-foreground">
          OpenDucktor needs the GitHub host and repository identity before it can open pull
          requests.
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-border bg-muted/30 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <p className="text-base font-semibold text-foreground">
            {repositorySlug ? repositorySlug : "Repository details missing"}
          </p>
          <p className="text-sm text-muted-foreground">
            {repositorySlug
              ? `Host: ${githubHost}`
              : "Detect the repository from the current origin remote or enter the details manually."}
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
    <div className="grid gap-4 rounded-xl border border-border bg-card p-4">
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
      <p className="text-xs text-muted-foreground">
        Manual values override the detected repository mapping for this workspace only.
      </p>
    </div>
  );
}

export function RepositoryGitSection({
  selectedRepoPath,
  selectedRepoConfig,
  runtimeCheck,
  disabled,
  onDetectGithubRepository,
  onUpdateSelectedRepoConfig,
}: RepositoryGitSectionProps): ReactElement {
  const {
    cliStatusLabel,
    detectionMessage,
    githubEnabled,
    githubHost,
    githubReadinessLabel,
    githubReadinessMessage,
    githubReady,
    hasGithubCli,
    isDetecting,
    isManualConfigOpen,
    providerStatusLabel,
    repositoryDraft,
    repositorySlug,
    usesDefaultGithubHost,
    handleDetectFromOrigin,
    handleGithubEnabledChange,
    handleRepositoryDraftFieldChange,
    handleToggleManualEdit,
  } = useRepositoryGitSectionModel({
    disabled,
    onDetectGithubRepository,
    onUpdateSelectedRepoConfig,
    runtimeCheck,
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

  return (
    <div className="p-5">
      <Card>
        <RepositoryGitStatusHeader
          githubReady={githubReady}
          githubReadinessLabel={githubReadinessLabel}
          githubReadinessMessage={githubReadinessMessage}
        />
        <CardContent className="grid gap-5 py-5">
          <RepositoryGitEnableCard
            disabled={disabled}
            githubEnabled={githubEnabled}
            onCheckedChange={handleGithubEnabledChange}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={githubEnabled ? "success" : "warning"}>{providerStatusLabel}</Badge>
            <Badge variant={hasGithubCli ? "success" : "danger"}>{cliStatusLabel}</Badge>
            {usesDefaultGithubHost ? null : <Badge variant="outline">{githubHost}</Badge>}
          </div>

          <RepositoryGitMappingCard
            disabled={disabled}
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
              disabled={disabled}
              repositoryDraft={repositoryDraft}
              onDraftFieldChange={handleRepositoryDraftFieldChange}
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
