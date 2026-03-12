import type { GitProviderRepository, RepoConfig, RuntimeCheck } from "@openducktor/contracts";
import { Github, LoaderCircle, PencilLine, RefreshCcw } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type RepositoryGitSectionProps = {
  selectedRepoPath: string | null;
  selectedRepoConfig: RepoConfig | null;
  runtimeCheck: RuntimeCheck | null;
  disabled: boolean;
  onDetectGithubRepository: () => Promise<GitProviderRepository | null>;
  onUpdateSelectedRepoConfig: (updater: (current: RepoConfig) => RepoConfig) => void;
};

const EMPTY_GITHUB_CONFIG = {
  enabled: false,
  autoDetected: false,
  repository: undefined,
} as const;

type GithubRepositoryDraft = {
  host: string;
  owner: string;
  name: string;
};

export function RepositoryGitSection({
  selectedRepoPath,
  selectedRepoConfig,
  runtimeCheck,
  disabled,
  onDetectGithubRepository,
  onUpdateSelectedRepoConfig,
}: RepositoryGitSectionProps): ReactElement {
  const attemptedAutoDetectByRepoRef = useRef<Set<string>>(new Set());
  const [isManualConfigOpen, setIsManualConfigOpen] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectionMessage, setDetectionMessage] = useState<string | null>(null);
  const [repositoryDraft, setRepositoryDraft] = useState<GithubRepositoryDraft>({
    host: "github.com",
    owner: "",
    name: "",
  });

  const github = selectedRepoConfig?.git.providers.github ?? EMPTY_GITHUB_CONFIG;
  const githubHost = github.repository?.host ?? "github.com";
  const usesDefaultGithubHost = githubHost === "github.com";
  const hasRepositoryCoordinates = Boolean(
    github.repository?.host && github.repository?.owner && github.repository?.name,
  );
  const repositorySlug = hasRepositoryCoordinates
    ? `${github.repository?.owner}/${github.repository?.name}`
    : null;
  const githubReady =
    github.enabled &&
    runtimeCheck?.ghOk &&
    hasRepositoryCoordinates &&
    (usesDefaultGithubHost ? (runtimeCheck?.ghAuthOk ?? false) : true);
  const githubReadinessLabel = githubReady
    ? usesDefaultGithubHost
      ? "Ready"
      : "Configured"
    : "Not ready";
  const githubReadinessMessage = !github.enabled
    ? "Enable GitHub for this repository to offer “Open pull request” during human approval."
    : !runtimeCheck?.ghOk
      ? "Install GitHub CLI (`gh`) to enable provider-backed pull requests."
      : usesDefaultGithubHost && !runtimeCheck.ghAuthOk
        ? runtimeCheck.ghAuthError ?? "Run `gh auth login` to authenticate GitHub."
        : !hasRepositoryCoordinates
          ? "Repository host, owner, and name are still missing."
          : usesDefaultGithubHost
            ? "GitHub pull requests are ready for this repository."
            : `GitHub pull requests are configured for ${githubHost}. Authentication for that host is validated during approval.`;
  const providerStatusLabel = github.enabled ? "Pull requests enabled" : "Pull requests disabled";
  const cliStatusLabel = runtimeCheck?.ghOk ? "CLI installed" : "CLI missing";

  const buildGithubConfig = useCallback(
    (
      repoConfig: RepoConfig,
      overrides: Partial<NonNullable<RepoConfig["git"]["providers"]["github"]>>,
    ): NonNullable<RepoConfig["git"]["providers"]["github"]> => ({
      enabled: repoConfig.git.providers.github?.enabled ?? false,
      autoDetected: repoConfig.git.providers.github?.autoDetected ?? false,
      repository: repoConfig.git.providers.github?.repository,
      ...overrides,
    }),
    [],
  );

  const commitGithubRepositoryDraft = useCallback(
    (nextDraft: GithubRepositoryDraft): void => {
      const trimmedDraft = {
        host: nextDraft.host.trim(),
        owner: nextDraft.owner.trim(),
        name: nextDraft.name.trim(),
      };

      onUpdateSelectedRepoConfig((repoConfig) => ({
        ...repoConfig,
        git: {
          ...repoConfig.git,
          providers: {
            ...repoConfig.git.providers,
            github: buildGithubConfig(repoConfig, {
              repository:
                trimmedDraft.host && trimmedDraft.owner && trimmedDraft.name
                  ? trimmedDraft
                  : undefined,
            }),
          },
        },
      }));
    },
    [buildGithubConfig, onUpdateSelectedRepoConfig],
  );

  const runDetection = useCallback(
    async (manual: boolean): Promise<void> => {
      if (!selectedRepoConfig || isDetecting) {
        return;
      }

      setIsDetecting(true);
      try {
        const detected = await onDetectGithubRepository();
        if (!detected) {
          setDetectionMessage(
            "No GitHub origin was detected for this repository. You can still configure it manually.",
          );
          if (manual) {
            setIsManualConfigOpen(true);
          }
          return;
        }

        setDetectionMessage(
          `Detected ${detected.owner}/${detected.name} from origin. Save settings to keep this mapping.`,
        );
        setRepositoryDraft({
          host: detected.host,
          owner: detected.owner,
          name: detected.name,
        });
        if (manual || !hasRepositoryCoordinates) {
          setIsManualConfigOpen(false);
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Detection failed.";
        setDetectionMessage(reason);
        if (manual) {
          setIsManualConfigOpen(true);
        }
      } finally {
        setIsDetecting(false);
      }
    },
    [hasRepositoryCoordinates, isDetecting, onDetectGithubRepository, selectedRepoConfig],
  );

  useEffect(() => {
    if (!selectedRepoPath) {
      setDetectionMessage(null);
      return;
    }

    setDetectionMessage(null);
    setIsManualConfigOpen(!hasRepositoryCoordinates);
  }, [hasRepositoryCoordinates, selectedRepoPath]);

  useEffect(() => {
    setRepositoryDraft({
      host: github.repository?.host ?? "github.com",
      owner: github.repository?.owner ?? "",
      name: github.repository?.name ?? "",
    });
  }, [github.repository?.host, github.repository?.name, github.repository?.owner, selectedRepoPath]);

  useEffect(() => {
    if (!selectedRepoPath || disabled || hasRepositoryCoordinates || isDetecting) {
      return;
    }
    if (attemptedAutoDetectByRepoRef.current.has(selectedRepoPath)) {
      return;
    }

    attemptedAutoDetectByRepoRef.current.add(selectedRepoPath);
    void runDetection(false);
  }, [disabled, hasRepositoryCoordinates, isDetecting, runDetection, selectedRepoPath]);

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
        <CardContent className="grid gap-5 py-5">
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">Enable provider for approvals</p>
              <p className="text-sm text-muted-foreground">
                When enabled, approved tasks can be delivered as GitHub pull requests.
              </p>
            </div>
            <Label className="flex items-center gap-3 text-sm font-medium text-foreground">
              <Switch
                checked={github.enabled}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  onUpdateSelectedRepoConfig((repoConfig) => ({
                    ...repoConfig,
                    git: {
                      ...repoConfig.git,
                      providers: {
                        ...repoConfig.git.providers,
                        github: buildGithubConfig(repoConfig, { enabled: checked }),
                      },
                    },
                  }))
                }
              />
              {github.enabled ? "Enabled" : "Disabled"}
            </Label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={github.enabled ? "success" : "warning"}>{providerStatusLabel}</Badge>
            <Badge variant={runtimeCheck?.ghOk ? "success" : "danger"}>{cliStatusLabel}</Badge>
            {usesDefaultGithubHost ? null : <Badge variant="outline">{githubHost}</Badge>}
          </div>

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
                  onClick={() => void runDetection(true)}
                >
                  {isDetecting ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <RefreshCcw className="size-4" />
                  )}
                  Detect from origin
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => setIsManualConfigOpen((current) => !current)}
                >
                  <PencilLine className="size-4" />
                  {isManualConfigOpen ? "Hide manual edit" : "Edit manually"}
                </Button>
              </div>
            </div>
          </div>

          {detectionMessage ? (
            <p className="text-sm text-muted-foreground">{detectionMessage}</p>
          ) : null}

          {isManualConfigOpen ? (
            <div className="grid gap-4 rounded-xl border border-border bg-card p-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor="repo-github-host">Host</Label>
                  <Input
                    id="repo-github-host"
                    value={repositoryDraft.host}
                    disabled={disabled}
                    onChange={(event) => {
                      const nextDraft = {
                        ...repositoryDraft,
                        host: event.currentTarget.value,
                      };
                      setRepositoryDraft(nextDraft);
                      commitGithubRepositoryDraft(nextDraft);
                    }}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="repo-github-owner">Owner</Label>
                  <Input
                    id="repo-github-owner"
                    value={repositoryDraft.owner}
                    disabled={disabled}
                    onChange={(event) => {
                      const nextDraft = {
                        ...repositoryDraft,
                        owner: event.currentTarget.value,
                      };
                      setRepositoryDraft(nextDraft);
                      commitGithubRepositoryDraft(nextDraft);
                    }}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="repo-github-name">Repository</Label>
                  <Input
                    id="repo-github-name"
                    value={repositoryDraft.name}
                    disabled={disabled}
                    onChange={(event) => {
                      const nextDraft = {
                        ...repositoryDraft,
                        name: event.currentTarget.value,
                      };
                      setRepositoryDraft(nextDraft);
                      commitGithubRepositoryDraft(nextDraft);
                    }}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Manual values override the detected repository mapping for this workspace only.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
