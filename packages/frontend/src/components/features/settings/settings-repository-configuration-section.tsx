import type { GitBranch, SettingsRepoConfig } from "@openducktor/contracts";
import { FolderOpen } from "lucide-react";
import { type ReactElement, useState } from "react";
import { DefaultTargetBranchField } from "@/components/features/repository/default-target-branch-field";
import { FolderPickerDialog } from "@/components/features/repository/folder-picker-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkspaceIdentityFields } from "@/components/features/workspace-identity/workspace-identity-fields";
import { resolveFolderPickerInitialPath } from "./settings-repository-configuration-section-model";

type RepositoryConfigurationSectionProps = {
  selectedRepoConfig: SettingsRepoConfig | null;
  selectedRepoEffectiveWorktreeBasePath: string | null;
  selectedRepoBranches: GitBranch[];
  selectedRepoBranchesError: string | null;
  loadingState: {
    isLoadingSettings: boolean;
    isSaving: boolean;
    isLoadingSelectedRepoBranches: boolean;
  };
  onRetrySelectedRepoBranchesLoad: () => void;
  onUpdateSelectedRepoConfig: (
    updater: (current: SettingsRepoConfig) => SettingsRepoConfig,
  ) => void;
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
          selectedRepoConfig={selectedRepoConfig}
          branches={selectedRepoBranches}
          branchesError={selectedRepoBranchesError}
          isLoadingBranches={isLoadingSelectedRepoBranches}
          isDisabled={isLoadingSettings || isSaving}
          onRetryBranchesLoad={onRetrySelectedRepoBranchesLoad}
          onUpdateSelectedRepoConfig={onUpdateSelectedRepoConfig}
        />
      </div>

      {isFolderPickerOpen ? (
        <FolderPickerDialog
          open={isFolderPickerOpen}
          onOpenChange={setIsFolderPickerOpen}
          title="Choose a worktree folder"
          description="Choose the directory where OpenDucktor should create managed worktrees for this repository."
          confirmLabel="Use this folder"
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
          title="Change repository folder"
          description="Choose this workspace's repository folder. Its ID stays the same."
          confirmLabel="Use this repository"
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
  selectedRepoConfig: SettingsRepoConfig;
  onPickRepoPath: () => void;
  onUpdateSelectedRepoConfig: UpdateSelectedRepoConfig;
}): ReactElement {
  return (
    <div className="grid gap-3 rounded-md border border-border bg-muted/30 p-4">
      <div className="grid gap-1">
        <p className="text-sm font-medium text-foreground">Workspace identity</p>
        <p className="text-xs text-muted-foreground">
          The workspace ID stays the same. You can change its name and repository folder.
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

      {/* Remounting on the selected workspace drops hex text and its error message that belong to
          the repository the user just left, which a shared color would otherwise keep on screen. */}
      <WorkspaceIdentityFields
        key={selectedRepoConfig.workspaceId}
        idPrefix="repo-workspace"
        workspaceName={selectedRepoConfig.workspaceName}
        abbreviation={selectedRepoConfig.abbreviation ?? null}
        tileColor={selectedRepoConfig.tileColor ?? null}
        isDisabled={isDisabled}
        onChangeAbbreviation={(abbreviation) => {
          onUpdateSelectedRepoConfig((repoConfig) => ({
            ...repoConfig,
            abbreviation,
          }));
        }}
        onChangeTileColor={(nextTileColor) => {
          onUpdateSelectedRepoConfig((repoConfig) => ({
            ...repoConfig,
            tileColor: nextTileColor ?? undefined,
          }));
        }}
      />

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
            Change folder
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
  selectedRepoConfig: SettingsRepoConfig;
  selectedRepoEffectiveWorktreeBasePath: string | null;
  onPickWorktreeBasePath: () => void;
  onUpdateSelectedRepoConfig: UpdateSelectedRepoConfig;
}): ReactElement {
  return (
    <div className="grid gap-2">
      <Label htmlFor="repo-worktree-path">Custom worktree folder (optional)</Label>
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
        <p className="text-xs font-medium text-foreground">Worktree location</p>
        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
          {selectedRepoEffectiveWorktreeBasePath ?? "Not available"}
        </p>
      </div>
    </div>
  );
}

function RepositoryBranchSettingsSection({
  selectedRepoConfig,
  branches,
  branchesError,
  isLoadingBranches,
  isDisabled,
  onRetryBranchesLoad,
  onUpdateSelectedRepoConfig,
}: {
  selectedRepoConfig: SettingsRepoConfig;
  branches: GitBranch[];
  branchesError: string | null;
  isLoadingBranches: boolean;
  isDisabled: boolean;
  onRetryBranchesLoad: () => void;
  onUpdateSelectedRepoConfig: UpdateSelectedRepoConfig;
}): ReactElement {
  return (
    <div className="grid gap-2 md:grid-cols-2">
      <div className="grid gap-2">
        <Label htmlFor="repo-branch-prefix">Branch prefix</Label>
        <Input
          id="repo-branch-prefix"
          value={selectedRepoConfig.branchPrefix}
          disabled={isDisabled}
          onChange={(event) => {
            const nextBranchPrefix = event.currentTarget.value;
            onUpdateSelectedRepoConfig((repoConfig) => ({
              ...repoConfig,
              branchPrefix: nextBranchPrefix,
            }));
          }}
        />
      </div>

      <DefaultTargetBranchField
        value={selectedRepoConfig.defaultTargetBranch}
        branches={branches}
        isLoading={isLoadingBranches}
        error={branchesError}
        disabled={isDisabled}
        onRetry={onRetryBranchesLoad}
        onChange={(defaultTargetBranch) =>
          onUpdateSelectedRepoConfig((repoConfig) => ({ ...repoConfig, defaultTargetBranch }))
        }
      />
    </div>
  );
}
