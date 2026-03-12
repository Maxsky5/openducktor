import type { GitBranch, RepoConfig } from "@openducktor/contracts";
import { FolderOpen } from "lucide-react";
import type { ReactElement } from "react";
import { BranchSelector } from "@/components/features/repository/branch-selector";
import { toBranchSelectorOptions } from "@/components/features/repository/branch-selector-model";
import { parseHookLines } from "@/components/features/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { canonicalTargetBranch, targetBranchFromSelection } from "@/lib/target-branch";

type RepositoryConfigurationSectionProps = {
  selectedRepoConfig: RepoConfig | null;
  selectedRepoBranches: GitBranch[];
  selectedRepoBranchesError: string | null;
  isLoadingSettings: boolean;
  isSaving: boolean;
  isPickingWorktreeBasePath: boolean;
  isLoadingSelectedRepoBranches: boolean;
  onRetrySelectedRepoBranchesLoad: () => void;
  onPickWorktreeBasePath: () => Promise<void>;
  onUpdateSelectedRepoConfig: (updater: (current: RepoConfig) => RepoConfig) => void;
};

export function RepositoryConfigurationSection({
  selectedRepoConfig,
  selectedRepoBranches,
  selectedRepoBranchesError,
  isLoadingSettings,
  isSaving,
  isPickingWorktreeBasePath,
  isLoadingSelectedRepoBranches,
  onRetrySelectedRepoBranchesLoad,
  onPickWorktreeBasePath,
  onUpdateSelectedRepoConfig,
}: RepositoryConfigurationSectionProps): ReactElement {
  if (!selectedRepoConfig) {
    return (
      <div className="rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-warning-surface-foreground">
        Select a repository to edit repository settings.
      </div>
    );
  }

  const defaultTargetBranchValue = canonicalTargetBranch(selectedRepoConfig.defaultTargetBranch);
  const targetBranchSelectorValue =
    selectedRepoConfig.defaultTargetBranch.branch === "@{upstream}"
      ? selectedRepoConfig.defaultTargetBranch.branch
      : selectedRepoConfig.defaultTargetBranch.remote
        ? `refs/remotes/${selectedRepoConfig.defaultTargetBranch.remote}/${selectedRepoConfig.defaultTargetBranch.branch}`
        : `refs/heads/${selectedRepoConfig.defaultTargetBranch.branch}`;
  const defaultTargetBranchOptions = toBranchSelectorOptions(selectedRepoBranches, {
    valueFormat: "full_ref",
    includeOptions: [
      {
        value: targetBranchSelectorValue,
        label: defaultTargetBranchValue,
        secondaryLabel: "configured",
        searchKeywords: defaultTargetBranchValue.split("/").filter(Boolean),
      },
    ],
  });
  const isDefaultTargetBranchPickerDisabled =
    isLoadingSettings ||
    isSaving ||
    isLoadingSelectedRepoBranches ||
    defaultTargetBranchOptions.length === 0;
  const defaultTargetBranchPlaceholder = isLoadingSelectedRepoBranches
    ? "Loading branches..."
    : selectedRepoBranchesError
      ? "Branches unavailable"
      : "Select branch...";

  return (
    <div className="grid gap-4 p-4">
      <div className="grid gap-2">
        <Label htmlFor="repo-worktree-path">Worktree base path</Label>
        <div className="flex items-center gap-2">
          <Input
            id="repo-worktree-path"
            className="flex-1"
            placeholder="/absolute/path/outside/repo"
            value={selectedRepoConfig.worktreeBasePath ?? ""}
            disabled={isLoadingSettings || isSaving || isPickingWorktreeBasePath}
            onChange={(event) => {
              const worktreeBasePath = event.currentTarget.value;
              onUpdateSelectedRepoConfig((repoConfig) => ({
                ...repoConfig,
                worktreeBasePath,
              }));
            }}
          />
          <Button
            type="button"
            size="icon"
            className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
            disabled={isLoadingSettings || isSaving || isPickingWorktreeBasePath}
            onClick={() => void onPickWorktreeBasePath()}
            aria-label="Pick worktree base path"
            title="Pick worktree base path"
          >
            <FolderOpen className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="repo-branch-prefix">Branch prefix</Label>
          <Input
            id="repo-branch-prefix"
            value={selectedRepoConfig.branchPrefix}
            disabled={isLoadingSettings || isSaving}
            onChange={(event) => {
              const branchPrefix = event.currentTarget.value;
              onUpdateSelectedRepoConfig((repoConfig) => ({
                ...repoConfig,
                branchPrefix,
              }));
            }}
          />
        </div>

        <div className="grid gap-2">
          <Label>Default target branch</Label>
          <BranchSelector
            value={targetBranchSelectorValue}
            options={defaultTargetBranchOptions}
            disabled={isDefaultTargetBranchPickerDisabled}
            placeholder={defaultTargetBranchPlaceholder}
            searchPlaceholder="Search branch..."
            onValueChange={(nextBranch) =>
              onUpdateSelectedRepoConfig((repoConfig) => ({
                ...repoConfig,
                defaultTargetBranch: targetBranchFromSelection(nextBranch),
              }))
            }
          />
          {selectedRepoBranchesError ? (
            <div className="flex items-center gap-2">
              <p className="text-xs text-warning-muted">
                Failed to load branches for repository: {selectedRepoBranchesError}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                disabled={isLoadingSelectedRepoBranches || isSaving}
                onClick={onRetrySelectedRepoBranchesLoad}
              >
                Retry
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <Label
        htmlFor="repo-trusted-hooks"
        className="flex items-center gap-2 text-sm text-foreground"
      >
        <Switch
          id="repo-trusted-hooks"
          checked={selectedRepoConfig.trustedHooks}
          disabled={isLoadingSettings || isSaving}
          onCheckedChange={(checked) =>
            onUpdateSelectedRepoConfig((repoConfig) => ({
              ...repoConfig,
              trustedHooks: checked,
            }))
          }
        />
        Trust scripts for this repository
      </Label>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="repo-pre-start-hooks">Worktree setup script (one command per line)</Label>
          <Textarea
            id="repo-pre-start-hooks"
            rows={4}
            value={selectedRepoConfig.hooks.preStart.join("\n")}
            disabled={isLoadingSettings || isSaving}
            onChange={(event) => {
              const preStartHooksInput = event.currentTarget.value;
              onUpdateSelectedRepoConfig((repoConfig) => ({
                ...repoConfig,
                hooks: {
                  ...repoConfig.hooks,
                  preStart: parseHookLines(preStartHooksInput),
                },
              }));
            }}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="repo-post-complete-hooks">
            Worktree cleanup script (one command per line)
          </Label>
          <Textarea
            id="repo-post-complete-hooks"
            rows={4}
            value={selectedRepoConfig.hooks.postComplete.join("\n")}
            disabled={isLoadingSettings || isSaving}
            onChange={(event) => {
              const postCompleteHooksInput = event.currentTarget.value;
              onUpdateSelectedRepoConfig((repoConfig) => ({
                ...repoConfig,
                hooks: {
                  ...repoConfig.hooks,
                  postComplete: parseHookLines(postCompleteHooksInput),
                },
              }));
            }}
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="repo-worktree-file-copies">Worktree file copies (one path per line)</Label>
        <Textarea
          id="repo-worktree-file-copies"
          rows={4}
          value={selectedRepoConfig.worktreeFileCopies.join("\n")}
          disabled={isLoadingSettings || isSaving}
          onChange={(event) => {
            const worktreeFileCopiesInput = event.currentTarget.value;
            onUpdateSelectedRepoConfig((repoConfig) => ({
              ...repoConfig,
              worktreeFileCopies: parseHookLines(worktreeFileCopiesInput),
            }));
          }}
        />
      </div>
    </div>
  );
}
