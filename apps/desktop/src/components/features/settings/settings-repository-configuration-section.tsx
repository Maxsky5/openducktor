import type { GitBranch, RepoConfig } from "@openducktor/contracts";
import { ChevronDown, ChevronUp, CircleAlert, FolderOpen, Plus, Trash2 } from "lucide-react";
import type { ReactElement } from "react";
import { BranchSelector } from "@/components/features/repository/branch-selector";
import { toBranchSelectorOptions } from "@/components/features/repository/branch-selector-model";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { canonicalTargetBranch, targetBranchFromSelection } from "@/lib/target-branch";
import {
  buildDevServerDraftValidationMap,
  hasConfiguredRepoScriptCommands,
  parseHookLines,
} from "./settings-model";

type RepositoryConfigurationSectionProps = {
  selectedRepoConfig: RepoConfig | null;
  selectedRepoDevServerValidationErrors?: Record<string, { name?: string; command?: string }>;
  showDevServerValidationErrors?: boolean;
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

type UpdateSelectedRepoConfig = RepositoryConfigurationSectionProps["onUpdateSelectedRepoConfig"];

export function RepositoryConfigurationSection({
  selectedRepoConfig,
  selectedRepoDevServerValidationErrors,
  showDevServerValidationErrors = false,
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
  const updateScriptDraft = (updater: (repoConfig: RepoConfig) => RepoConfig): void => {
    onUpdateSelectedRepoConfig((repoConfig) => {
      const nextRepoConfig = updater(repoConfig);
      const trustedHooks = hasConfiguredRepoScriptCommands({
        hooks: nextRepoConfig.hooks,
        devServers: nextRepoConfig.devServers,
      });

      return {
        ...nextRepoConfig,
        trustedHooks,
        trustedHooksFingerprint: trustedHooks ? nextRepoConfig.trustedHooksFingerprint : undefined,
      };
    });
  };
  const updateHookDraft = (key: "preStart" | "postComplete", value: string): void => {
    const nextHookLines = parseHookLines(value);
    updateScriptDraft((repoConfig) => ({
      ...repoConfig,
      hooks: {
        ...repoConfig.hooks,
        [key]: nextHookLines,
      },
    }));
  };
  const devServerValidationErrors = showDevServerValidationErrors
    ? (selectedRepoDevServerValidationErrors ??
      buildDevServerDraftValidationMap(selectedRepoConfig.devServers ?? []))
    : {};

  return (
    <div className="grid gap-4 p-4">
      <RepositoryWorktreeBasePathSection
        isDisabled={isLoadingSettings || isSaving || isPickingWorktreeBasePath}
        selectedRepoConfig={selectedRepoConfig}
        selectedRepoEffectiveWorktreeBasePath={selectedRepoEffectiveWorktreeBasePath}
        onPickWorktreeBasePath={onPickWorktreeBasePath}
        onUpdateSelectedRepoConfig={onUpdateSelectedRepoConfig}
      />

      <RepositoryBranchSettingsSection
        branchPrefix={selectedRepoConfig.branchPrefix}
        defaultTargetBranchOptions={defaultTargetBranchOptions}
        defaultTargetBranchPlaceholder={defaultTargetBranchPlaceholder}
        isBranchPrefixDisabled={isLoadingSettings || isSaving}
        isDefaultTargetBranchPickerDisabled={isDefaultTargetBranchPickerDisabled}
        isLoadingSelectedRepoBranches={isLoadingSelectedRepoBranches}
        isSaving={isSaving}
        selectedRepoBranchesError={selectedRepoBranchesError}
        targetBranchSelectorValue={targetBranchSelectorValue}
        onRetrySelectedRepoBranchesLoad={onRetrySelectedRepoBranchesLoad}
        onUpdateSelectedRepoConfig={onUpdateSelectedRepoConfig}
      />

      <RepositoryHookScriptsSection
        isDisabled={isLoadingSettings || isSaving}
        postCompleteHooks={selectedRepoConfig.hooks.postComplete}
        preStartHooks={selectedRepoConfig.hooks.preStart}
        updateHookDraft={updateHookDraft}
      />

      <RepositoryDevServersSection
        devServerValidationErrors={devServerValidationErrors}
        devServers={selectedRepoConfig.devServers}
        isDisabled={isLoadingSettings || isSaving}
        updateScriptDraft={updateScriptDraft}
      />

      <RepositoryScriptFingerprintNotice />

      <RepositoryWorktreeFileCopiesSection
        isDisabled={isLoadingSettings || isSaving}
        worktreeFileCopies={selectedRepoConfig.worktreeFileCopies}
        onUpdateSelectedRepoConfig={onUpdateSelectedRepoConfig}
      />
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
  onPickWorktreeBasePath: () => Promise<void>;
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
  isBranchPrefixDisabled,
  isDefaultTargetBranchPickerDisabled,
  isLoadingSelectedRepoBranches,
  isSaving,
  selectedRepoBranchesError,
  targetBranchSelectorValue,
  onRetrySelectedRepoBranchesLoad,
  onUpdateSelectedRepoConfig,
}: {
  branchPrefix: string;
  defaultTargetBranchOptions: ReturnType<typeof toBranchSelectorOptions>;
  defaultTargetBranchPlaceholder: string;
  isBranchPrefixDisabled: boolean;
  isDefaultTargetBranchPickerDisabled: boolean;
  isLoadingSelectedRepoBranches: boolean;
  isSaving: boolean;
  selectedRepoBranchesError: string | null;
  targetBranchSelectorValue: string;
  onRetrySelectedRepoBranchesLoad: () => void;
  onUpdateSelectedRepoConfig: UpdateSelectedRepoConfig;
}): ReactElement {
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
  );
}

function RepositoryHookScriptsSection({
  isDisabled,
  postCompleteHooks,
  preStartHooks,
  updateHookDraft,
}: {
  isDisabled: boolean;
  postCompleteHooks: string[];
  preStartHooks: string[];
  updateHookDraft: (key: "preStart" | "postComplete", value: string) => void;
}): ReactElement {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="grid gap-2">
        <Label htmlFor="repo-pre-start-hooks">Worktree setup script (one command per line)</Label>
        <Textarea
          id="repo-pre-start-hooks"
          rows={4}
          value={preStartHooks.join("\n")}
          disabled={isDisabled}
          onChange={(event) => updateHookDraft("preStart", event.currentTarget.value)}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="repo-post-complete-hooks">
          Worktree cleanup script (one command per line)
        </Label>
        <Textarea
          id="repo-post-complete-hooks"
          rows={4}
          value={postCompleteHooks.join("\n")}
          disabled={isDisabled}
          onChange={(event) => updateHookDraft("postComplete", event.currentTarget.value)}
        />
      </div>
    </div>
  );
}

function RepositoryDevServersSection({
  devServerValidationErrors,
  devServers,
  isDisabled,
  updateScriptDraft,
}: {
  devServerValidationErrors: Record<string, { name?: string; command?: string }>;
  devServers: RepoConfig["devServers"];
  isDisabled: boolean;
  updateScriptDraft: (updater: (repoConfig: RepoConfig) => RepoConfig) => void;
}): ReactElement {
  return (
    <div className="grid gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <Label>Dev server</Label>
          <p className="text-xs text-muted-foreground">
            Add one named command per long-running service. OpenDucktor starts these scripts in the
            builder worktree and keeps the saved order for terminal tabs.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isDisabled}
          onClick={() => {
            updateScriptDraft((repoConfig) => {
              const nextIndex = repoConfig.devServers.length + 1;
              return {
                ...repoConfig,
                devServers: [
                  ...repoConfig.devServers,
                  {
                    id: crypto.randomUUID(),
                    name: `Dev server ${nextIndex}`,
                    command: "",
                  },
                ],
              };
            });
          }}
        >
          <Plus className="size-4" />
          Add server
        </Button>
      </div>

      {devServers.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          No dev servers configured yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-card">
          <div className="hidden grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)_auto] gap-3 border-b border-border bg-muted/30 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid">
            <span>Tab label</span>
            <span>Command</span>
            <span className="text-right">Actions</span>
          </div>
          <div className="grid gap-0 divide-y divide-border">
            {devServers.map((devServer, index) => (
              <RepositoryDevServerRow
                key={devServer.id}
                devServer={devServer}
                index={index}
                isDisabled={isDisabled}
                isLastRow={index === devServers.length - 1}
                updateScriptDraft={updateScriptDraft}
                validationErrors={devServerValidationErrors[devServer.id]}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RepositoryDevServerRow({
  devServer,
  index,
  isDisabled,
  isLastRow,
  updateScriptDraft,
  validationErrors,
}: {
  devServer: RepoConfig["devServers"][number];
  index: number;
  isDisabled: boolean;
  isLastRow: boolean;
  updateScriptDraft: (updater: (repoConfig: RepoConfig) => RepoConfig) => void;
  validationErrors: { name?: string; command?: string } | undefined;
}): ReactElement {
  const label = devServer.name || `dev server ${index + 1}`;
  const nameErrorId = `repo-dev-server-name-${devServer.id}-error`;
  const commandErrorId = `repo-dev-server-command-${devServer.id}-error`;

  return (
    <div className="grid gap-3 p-3 md:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)_auto] md:items-center">
      <div className="grid gap-2">
        <Label className="md:sr-only" htmlFor={`repo-dev-server-name-${devServer.id}`}>
          Tab label
        </Label>
        <Input
          id={`repo-dev-server-name-${devServer.id}`}
          value={devServer.name}
          aria-invalid={validationErrors?.name ? true : undefined}
          aria-describedby={validationErrors?.name ? nameErrorId : undefined}
          disabled={isDisabled}
          onChange={(event) => {
            const name = event.currentTarget.value;
            updateScriptDraft((repoConfig) => ({
              ...repoConfig,
              devServers: repoConfig.devServers.map((entry) =>
                entry.id === devServer.id ? { ...entry, name } : entry,
              ),
            }));
          }}
        />
        {validationErrors?.name ? (
          <span
            id={nameErrorId}
            role="alert"
            aria-live="polite"
            className="text-xs text-destructive-muted"
          >
            {validationErrors.name}
          </span>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label className="md:sr-only" htmlFor={`repo-dev-server-command-${devServer.id}`}>
          Command
        </Label>
        <Input
          id={`repo-dev-server-command-${devServer.id}`}
          placeholder="bun run dev"
          value={devServer.command}
          aria-invalid={validationErrors?.command ? true : undefined}
          aria-describedby={validationErrors?.command ? commandErrorId : undefined}
          disabled={isDisabled}
          onChange={(event) => {
            const command = event.currentTarget.value;
            updateScriptDraft((repoConfig) => ({
              ...repoConfig,
              devServers: repoConfig.devServers.map((entry) =>
                entry.id === devServer.id ? { ...entry, command } : entry,
              ),
            }));
          }}
        />
        {validationErrors?.command ? (
          <span
            id={commandErrorId}
            role="alert"
            aria-live="polite"
            className="text-xs text-destructive-muted"
          >
            {validationErrors.command}
          </span>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-1 md:self-center">
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={isDisabled || index === 0}
          onClick={() => {
            updateScriptDraft((repoConfig) => {
              const nextDevServers = [...repoConfig.devServers];
              const [entry] = nextDevServers.splice(index, 1);
              if (!entry) {
                return repoConfig;
              }
              nextDevServers.splice(index - 1, 0, entry);
              return {
                ...repoConfig,
                devServers: nextDevServers,
              };
            });
          }}
          aria-label={`Move ${label} up`}
          title="Move up"
        >
          <ChevronUp className="size-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={isDisabled || isLastRow}
          onClick={() => {
            updateScriptDraft((repoConfig) => {
              const nextDevServers = [...repoConfig.devServers];
              const [entry] = nextDevServers.splice(index, 1);
              if (!entry) {
                return repoConfig;
              }
              nextDevServers.splice(index + 1, 0, entry);
              return {
                ...repoConfig,
                devServers: nextDevServers,
              };
            });
          }}
          aria-label={`Move ${label} down`}
          title="Move down"
        >
          <ChevronDown className="size-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={isDisabled}
          onClick={() => {
            updateScriptDraft((repoConfig) => ({
              ...repoConfig,
              devServers: repoConfig.devServers.filter((entry) => entry.id !== devServer.id),
            }));
          }}
          aria-label={`Delete ${label}`}
          title="Delete dev server"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function RepositoryScriptFingerprintNotice(): ReactElement {
  return (
    <div className="flex items-center gap-3 rounded-md border border-info-border bg-info-surface p-3 text-sm text-info-surface-foreground">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-info-muted" aria-hidden="true" />
      <p className="leading-6">
        OpenDucktor saves a fingerprint of the exact setup, cleanup, and dev server commands you
        approve. This is a security check: if something changes those scripts later without your
        consent, the fingerprint no longer matches and OpenDucktor will ask you to confirm the
        scripts again before they can run. Remove dev server rows and clear every other script
        command to disable trusted scripts for this repository.
      </p>
    </div>
  );
}

function RepositoryWorktreeFileCopiesSection({
  isDisabled,
  worktreeFileCopies,
  onUpdateSelectedRepoConfig,
}: {
  isDisabled: boolean;
  worktreeFileCopies: string[];
  onUpdateSelectedRepoConfig: UpdateSelectedRepoConfig;
}): ReactElement {
  return (
    <div className="grid gap-2">
      <Label htmlFor="repo-worktree-file-copies">Worktree file copies (one path per line)</Label>
      <Textarea
        id="repo-worktree-file-copies"
        rows={4}
        value={worktreeFileCopies.join("\n")}
        disabled={isDisabled}
        onChange={(event) => {
          const worktreeFileCopiesInput = event.currentTarget.value;
          onUpdateSelectedRepoConfig((repoConfig) => ({
            ...repoConfig,
            worktreeFileCopies: parseHookLines(worktreeFileCopiesInput),
          }));
        }}
      />
    </div>
  );
}
