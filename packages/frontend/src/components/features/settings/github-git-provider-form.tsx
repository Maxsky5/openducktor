import { Github, LoaderCircle, PencilLine, RefreshCcw } from "lucide-react";
import { useState, type ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { GithubCliStatus, GithubRepositoryDraft } from "./use-repository-git-section-model";

export type GithubGitProviderFormModel = {
  configuredProviderId: string | undefined;
  detectionMessage: string | null;
  githubHost: string;
  githubControlsDisabled: boolean;
  hasConfiguredNonGithubProvider: boolean;
  isDetecting: boolean;
  isManualConfigOpen: boolean;
  repositoryDraft: GithubRepositoryDraft;
  repositorySlug: string | null;
  cliStatusLabel: string;
  cliStatus: GithubCliStatus;
  githubEnabled: boolean;
  githubReadinessLabel: string;
  githubReadinessMessage: string;
  githubReady: boolean;
  providerLabel: string;
  providerDescription: string;
  providerStatusLabel: string;
  handleDetectFromOrigin: () => void;
  handleRemoveConfiguredProvider: () => void;
  handleRepositoryDraftFieldChange: (field: keyof GithubRepositoryDraft, value: string) => void;
  handleToggleManualEdit: () => void;
  handleGithubEnabledChange: (enabled: boolean) => void;
};

type GithubGitProviderFormProps = {
  disabled: boolean;
  model: GithubGitProviderFormModel;
  repositoryErrors?: Partial<Record<keyof GithubRepositoryDraft, string | undefined>>;
  showErrors?: boolean;
};

export function GithubGitProviderForm({
  disabled,
  model,
  repositoryErrors,
  showErrors = false,
}: GithubGitProviderFormProps): ReactElement {
  const {
    configuredProviderId,
    detectionMessage,
    githubHost,
    githubControlsDisabled,
    hasConfiguredNonGithubProvider,
    isDetecting,
    isManualConfigOpen,
    repositoryDraft,
    repositorySlug,
    handleDetectFromOrigin,
    handleRemoveConfiguredProvider,
    handleRepositoryDraftFieldChange,
    handleToggleManualEdit,
  } = model;

  return (
    <div className="grid min-w-0 gap-3">
      <GithubProviderHeader model={model} />
      <div className="grid min-w-0 gap-3">
        {hasConfiguredNonGithubProvider ? (
          <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
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
                errors={repositoryErrors}
                showErrors={showErrors}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function GithubProviderHeader({ model }: Pick<GithubGitProviderFormProps, "model">): ReactElement {
  const {
    cliStatusLabel,
    cliStatus,
    githubEnabled,
    githubReadinessLabel,
    githubReadinessMessage,
    githubReady,
    githubControlsDisabled,
    hasConfiguredNonGithubProvider,
    providerLabel,
    providerDescription,
    providerStatusLabel,
    handleGithubEnabledChange,
  } = model;
  let readinessVariant: "success" | "warning" | "outline" = "outline";
  if (githubReady) readinessVariant = "success";
  else if (githubEnabled) readinessVariant = "warning";
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
      <div className="flex min-w-0 items-start gap-3">
        <div className="rounded-md border border-border bg-muted p-2 text-foreground">
          <Github className="size-4" />
        </div>
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-semibold text-foreground">{providerLabel}</h3>
          {hasConfiguredNonGithubProvider ? (
            <p className="text-xs text-muted-foreground">{providerDescription}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">{githubReadinessMessage}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={readinessVariant}>
          {githubEnabled ? githubReadinessLabel : providerStatusLabel}
        </Badge>
        {cliStatus !== "hidden" ? (
          <Badge variant={cliStatusBadgeVariant(cliStatus)}>{cliStatusLabel}</Badge>
        ) : null}
        {!hasConfiguredNonGithubProvider ? (
          <Label className="flex items-center gap-2 text-xs font-medium">
            <Switch
              aria-label="Enable GitHub"
              checked={githubEnabled}
              disabled={githubControlsDisabled}
              onCheckedChange={handleGithubEnabledChange}
            />
            {githubEnabled ? "Enabled" : "Disabled"}
          </Label>
        ) : null}
      </div>
    </div>
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
    <div className="grid min-w-0 gap-3 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-foreground">Repository</p>
          <p className="break-words text-xs text-muted-foreground">
            {repositorySlug
              ? `${repositorySlug} on ${githubHost}`
              : "Detect from origin or enter the repository details."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || isDetecting}
            onClick={onDetectFromOrigin}
          >
            {isDetecting ? (
              <span className="inline-flex size-4 shrink-0 animate-spin">
                <LoaderCircle className="size-4" />
              </span>
            ) : (
              <RefreshCcw className="size-4" />
            )}
            Detect from origin
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={onToggleManualEdit}
          >
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
  errors?: Partial<Record<keyof GithubRepositoryDraft, string | undefined>> | undefined;
  showErrors: boolean;
};

function RepositoryGitManualConfigForm({
  disabled,
  repositoryDraft,
  onDraftFieldChange,
  errors,
  showErrors,
}: RepositoryGitManualConfigFormProps): ReactElement {
  const [touched, setTouched] = useState<Set<keyof GithubRepositoryDraft>>(() => new Set());
  return (
    <div className="grid gap-4 rounded-md border border-border bg-card p-4">
      <div className="grid gap-3 md:grid-cols-3">
        {(
          [
            ["host", "Host"],
            ["owner", "Owner"],
            ["name", "Repository"],
          ] as const
        ).map(([field, label]) => {
          const error = showErrors || touched.has(field) ? errors?.[field] : undefined;
          return (
            <div className="grid min-w-0 gap-2" key={field}>
              <Label htmlFor={`repo-github-${field}`}>{label}</Label>
              <Input
                id={`repo-github-${field}`}
                value={repositoryDraft[field]}
                disabled={disabled}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `repo-github-${field}-error` : undefined}
                onBlur={() => setTouched((current) => new Set(current).add(field))}
                onChange={(event) => onDraftFieldChange(field, event.currentTarget.value)}
              />
              {error ? (
                <p
                  id={`repo-github-${field}-error`}
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {error}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
