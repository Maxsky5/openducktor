import type { GitBranch, RepoConfig } from "@openducktor/contracts";
import { FolderOpen } from "lucide-react";
import type { ReactElement } from "react";
import { BranchSelector } from "@/components/features/repository/branch-selector";
import { toBranchSelectorOptions } from "@/components/features/repository/branch-selector-model";
import { hasConfiguredHookCommands, parseHookLines } from "@/components/features/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { canonicalTargetBranch, targetBranchFromSelection } from "@/lib/target-branch";

type RepositoryConfigurationSectionProps = {
  selectedRepoConfig: RepoConfig | null;
  selectedRepoEffectiveWorktreeBasePath: string | null;
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
  selectedRepoEffectiveWorktreeBasePath,
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
        <Label htmlFor="repo-worktree-path">Worktree base path override (optional)</Label>
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
        <p className="text-xs text-muted-foreground">
          Leave this blank to use the default worktree location for this repository.
        </p>
        <div className="rounded-md border border-border bg-muted/50 p-3">
          <p className="text-xs font-medium text-foreground">Effective worktree path</p>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
            {selectedRepoEffectiveWorktreeBasePath ?? "Not available"}
          </p>
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
              const preStart = parseHookLines(preStartHooksInput);
              onUpdateSelectedRepoConfig((repoConfig) => {
                const hooks = {
                  ...repoConfig.hooks,
                  preStart,
                };

                return {
                  ...repoConfig,
                  trustedHooks: hasConfiguredHookCommands(hooks),
                  hooks,
                };
              });
            }}
          />
          <p className="text-xs text-muted-foreground">
            Saving configured scripts asks for confirmation automatically. Clear both script fields
            to disable scripts for this repository.
          </p>
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
              const postComplete = parseHookLines(postCompleteHooksInput);
              onUpdateSelectedRepoConfig((repoConfig) => {
                const hooks = {
                  ...repoConfig.hooks,
                  postComplete,
                };

                return {
                  ...repoConfig,
                  trustedHooks: hasConfiguredHookCommands(hooks),
                  hooks,
                };
              });
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
