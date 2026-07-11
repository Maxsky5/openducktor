import type { GitBranch, RepoConfig } from "@openducktor/contracts";
import { FolderOpen } from "lucide-react";
import { type ReactElement, useState } from "react";
import { BranchSelector } from "@/components/features/repository/branch-selector";
import { toBranchSelectorOptions } from "@/components/features/repository/branch-selector-model";
import { FolderPickerDialog } from "@/components/features/repository/folder-picker-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { canonicalTargetBranch, targetBranchFromSelection } from "@/lib/target-branch";
import { resolveFolderPickerInitialPath } from "./settings-repository-configuration-section-model";

type RepositoryConfigurationSectionProps = {
  selectedRepoConfig: RepoConfig | null;
  selectedRepoEffectiveWorktreeBasePath: string | null;
  selectedRepoBranches: GitBranch[];
  selectedRepoBranchesError: string | null;
  loadingState: {
    isLoadingSettings: boolean;
    isSaving: boolean;
    isLoadingSelectedRepoBranches: boolean;
  };
  onRetrySelectedRepoBranchesLoad: () => void;
  onUpdateSelectedRepoConfig: (updater: (current: RepoConfig) => RepoConfig) => void;
};

type UpdateSelectedRepoConfig = RepositoryConfigurationSectionProps["onUpdateSelectedRepoConfig"];

export function RepositoryConfigurationSection({
  selectedRepoConfig,
  selectedRepoEffectiveWorktreeBasePath,
  selectedRepoBranches,
  selectedRepoBranchesError,
  loadingState,
  onRetrySelectedRepoBranchesLoad,
  onUpdateSelectedRepoConfig,
}: RepositoryConfigurationSectionProps): ReactElement {
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);
  const [isRepoPathPickerOpen, setIsRepoPathPickerOpen] = useState(false);
  const { isLoadingSettings, isSaving, isLoadingSelectedRepoBranches } = loadingState;

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
  let defaultTargetBranchPlaceholder = "Select branch...";
  if (isLoadingSelectedRepoBranches) {
    defaultTargetBranchPlaceholder = "Loading branches...";
  } else if (selectedRepoBranchesError) {
    defaultTargetBranchPlaceholder = "Branches unavailable";
  }
  const folderPickerInitialPath = resolveFolderPickerInitialPath(
    selectedRepoConfig,
    selectedRepoEffectiveWorktreeBasePath,
  );

  return (
    <>
      <div className="grid gap-4 p-4">
        <RepositoryWorkspaceIdentitySection
          isDisabled={isLoadingSettings || isSaving}
          selectedRepoConfig={selectedRepoConfig}
          onPickRepoPath={() => setIsRepoPathPickerOpen(true)}
          onUpdateSelectedRepoConfig={onUpdateSelectedRepoConfig}
        />

        <RepositoryWorktreeBasePathSection
          isDisabled={isLoadingSettings || isSaving}
          selectedRepoConfig={selectedRepoConfig}
          selectedRepoEffectiveWorktreeBasePath={selectedRepoEffectiveWorktreeBasePath}
          onPickWorktreeBasePath={() => setIsFolderPickerOpen(true)}
          onUpdateSelectedRepoConfig={onUpdateSelectedRepoConfig}
        />

        <RepositoryBranchSettingsSection
          branchPrefix={selectedRepoConfig.branchPrefix}
          defaultTargetBranchOptions={defaultTargetBranchOptions}
          defaultTargetBranchPlaceholder={defaultTargetBranchPlaceholder}
          controlState={{
            isBranchPrefixDisabled: isLoadingSettings || isSaving,
            isDefaultTargetBranchPickerDisabled,
            isLoadingSelectedRepoBranches,
            isSaving,
          }}
          selectedRepoBranchesError={selectedRepoBranchesError}
          targetBranchSelectorValue={targetBranchSelectorValue}
          onRetrySelectedRepoBranchesLoad={onRetrySelectedRepoBranchesLoad}
          onUpdateSelectedRepoConfig={onUpdateSelectedRepoConfig}
        />
      </div>

      {isFolderPickerOpen ? (
        <FolderPickerDialog
          open={isFolderPickerOpen}
          onOpenChange={setIsFolderPickerOpen}
          title="Select Worktree Base Path"
          description="Choose the directory where OpenDucktor should create managed worktrees for this repository."
          confirmLabel="Use This Path"
          {...(folderPickerInitialPath
            ? {
                initialPath: folderPickerInitialPath,
              }
            : {})}
          onConfirm={async (path) => {
            onUpdateSelectedRepoConfig((repoConfig) => ({
              ...repoConfig,
              worktreeBasePath: path,
            }));
          }}
        />
      ) : null}

      {isRepoPathPickerOpen ? (
        <FolderPickerDialog
          open={isRepoPathPickerOpen}
          onOpenChange={setIsRepoPathPickerOpen}
          title="Rebind Repository Path"
          description="Choose the current repository folder for this workspace. The workspace ID stays the same while the live repository path changes."
          confirmLabel="Use This Repository"
          initialPath={selectedRepoConfig.repoPath}
          requireGitRepo
          onConfirm={async (path) => {
            onUpdateSelectedRepoConfig((repoConfig) => ({
              ...repoConfig,
              repoPath: path,
            }));
          }}
        />
      ) : null}
    </>
  );
}

function RepositoryWorkspaceIdentitySection({
  isDisabled,
  selectedRepoConfig,
  onPickRepoPath,
  onUpdateSelectedRepoConfig,
}: {
  isDisabled: boolean;
  selectedRepoConfig: RepoConfig;
  onPickRepoPath: () => void;
  onUpdateSelectedRepoConfig: UpdateSelectedRepoConfig;
}): ReactElement {
  return (
    <div className="grid gap-3 rounded-md border border-border bg-muted/30 p-4">
      <div className="grid gap-1">
        <p className="text-sm font-medium text-foreground">Workspace identity</p>
        <p className="text-xs text-muted-foreground">
          The workspace ID is durable and immutable. You can rename the workspace and rebind its
          live repository path here.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="repo-workspace-id">Workspace ID</Label>
          <Input id="repo-workspace-id" value={selectedRepoConfig.workspaceId} readOnly />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="repo-workspace-name">Workspace name</Label>
          <Input
            id="repo-workspace-name"
            value={selectedRepoConfig.workspaceName}
            disabled={isDisabled}
            onChange={(event) => {
              const workspaceName = event.currentTarget.value;
              onUpdateSelectedRepoConfig((repoConfig) => ({
                ...repoConfig,
                workspaceName,
              }));
            }}
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="repo-path">Repository path</Label>
        <div className="flex items-center gap-2">
          <Input id="repo-path" className="flex-1" value={selectedRepoConfig.repoPath} readOnly />
          <Button
            type="button"
            variant="outline"
            disabled={isDisabled}
            onClick={() => void onPickRepoPath()}
          >
            <FolderOpen className="size-4" />
            Rebind
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Use a different Git repository folder if this workspace has moved on disk.
        </p>
      </div>
    </div>
  );
}

function RepositoryWorktreeBasePathSection({
  isDisabled,
  selectedRepoConfig,
  selectedRepoEffectiveWorktreeBasePath,
  onPickWorktreeBasePath,
  onUpdateSelectedRepoConfig,
}: {
  isDisabled: boolean;
  selectedRepoConfig: RepoConfig;
  selectedRepoEffectiveWorktreeBasePath: string | null;
  onPickWorktreeBasePath: () => void;
  onUpdateSelectedRepoConfig: UpdateSelectedRepoConfig;
}): ReactElement {
  return (
    <div className="grid gap-2">
      <Label htmlFor="repo-worktree-path">Worktree base path override (optional)</Label>
      <div className="flex items-center gap-2">
        <Input
          id="repo-worktree-path"
          className="flex-1"
          placeholder="/absolute/path/outside/repo"
          value={selectedRepoConfig.worktreeBasePath ?? ""}
          disabled={isDisabled}
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
          disabled={isDisabled}
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
  );
}

function RepositoryBranchSettingsSection({
  branchPrefix,
  defaultTargetBranchOptions,
  defaultTargetBranchPlaceholder,
  controlState,
  selectedRepoBranchesError,
  targetBranchSelectorValue,
  onRetrySelectedRepoBranchesLoad,
  onUpdateSelectedRepoConfig,
}: {
  branchPrefix: string;
  defaultTargetBranchOptions: ReturnType<typeof toBranchSelectorOptions>;
  defaultTargetBranchPlaceholder: string;
  controlState: {
    isBranchPrefixDisabled: boolean;
    isDefaultTargetBranchPickerDisabled: boolean;
    isLoadingSelectedRepoBranches: boolean;
    isSaving: boolean;
  };
  selectedRepoBranchesError: string | null;
  targetBranchSelectorValue: string;
  onRetrySelectedRepoBranchesLoad: () => void;
  onUpdateSelectedRepoConfig: UpdateSelectedRepoConfig;
}): ReactElement {
  const defaultTargetBranchLabelId = "repo-default-target-branch-label";
  const {
    isBranchPrefixDisabled,
    isDefaultTargetBranchPickerDisabled,
    isLoadingSelectedRepoBranches,
    isSaving,
  } = controlState;

  return (
    <div className="grid gap-2 md:grid-cols-2">
      <div className="grid gap-2">
        <Label htmlFor="repo-branch-prefix">Branch prefix</Label>
        <Input
          id="repo-branch-prefix"
          value={branchPrefix}
          disabled={isBranchPrefixDisabled}
          onChange={(event) => {
            const nextBranchPrefix = event.currentTarget.value;
            onUpdateSelectedRepoConfig((repoConfig) => ({
              ...repoConfig,
              branchPrefix: nextBranchPrefix,
            }));
          }}
        />
      </div>

      <div className="grid gap-2">
        <Label id={defaultTargetBranchLabelId}>Default target branch</Label>
        <BranchSelector
          value={targetBranchSelectorValue}
          options={defaultTargetBranchOptions}
          disabled={isDefaultTargetBranchPickerDisabled}
          placeholder={defaultTargetBranchPlaceholder}
          searchPlaceholder="Search branch..."
          triggerAriaLabelledBy={defaultTargetBranchLabelId}
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
  );
}
