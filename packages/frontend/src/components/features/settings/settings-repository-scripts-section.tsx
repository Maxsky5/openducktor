import type { RepoConfig } from "@openducktor/contracts";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { type ReactElement, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  buildDevServerDraftValidationMap,
  parseHookLines,
} from "@/state/read-models/settings-read-model";
import type { SettingsContentFocusRequest } from "./settings-deep-link";

type RepositoryScriptsSectionProps = {
  selectedRepoConfig: RepoConfig | null;
  selectedRepoDevServerValidationErrors?: Record<string, { name?: string; command?: string }>;
  validationState?: {
    showDevServerValidationErrors?: boolean;
  };
  loadingState: {
    isLoadingSettings: boolean;
    isSaving: boolean;
  };
  focusRequest?: SettingsContentFocusRequest | null | undefined;
  onFocusRequestHandled?: ((request: SettingsContentFocusRequest) => void) | undefined;
  onUpdateSelectedRepoConfig: (updater: (current: RepoConfig) => RepoConfig) => void;
};

type UpdateSelectedRepoConfig = RepositoryScriptsSectionProps["onUpdateSelectedRepoConfig"];

export function RepositoryScriptsSection({
  selectedRepoConfig,
  selectedRepoDevServerValidationErrors,
  validationState,
  loadingState,
  focusRequest = null,
  onFocusRequestHandled,
  onUpdateSelectedRepoConfig,
}: RepositoryScriptsSectionProps): ReactElement {
  const devServersRef = useRef<HTMLDivElement>(null);
  const handledFocusRequestRef = useRef<SettingsContentFocusRequest | null>(null);
  const hasSelectedRepoConfig = selectedRepoConfig !== null;

  useEffect(() => {
    if (
      !hasSelectedRepoConfig ||
      focusRequest?.kind !== "repository-dev-servers" ||
      focusRequest === handledFocusRequestRef.current ||
      !devServersRef.current
    ) {
      return;
    }

    devServersRef.current.scrollIntoView({ block: "start" });
    handledFocusRequestRef.current = focusRequest;
    onFocusRequestHandled?.(focusRequest);
  }, [focusRequest, hasSelectedRepoConfig, onFocusRequestHandled]);

  if (!selectedRepoConfig) {
    return (
      <div className="rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-warning-surface-foreground">
        Select a repository to edit repository scripts.
      </div>
    );
  }

  const isDisabled = loadingState.isLoadingSettings || loadingState.isSaving;
  const devServerValidationErrors =
    validationState?.showDevServerValidationErrors === true
      ? (selectedRepoDevServerValidationErrors ??
        buildDevServerDraftValidationMap(selectedRepoConfig.devServers ?? []))
      : {};
  const updateHookDraft = (key: "preStart" | "postComplete", value: string): void => {
    const nextHookLines = parseHookLines(value);
    onUpdateSelectedRepoConfig((repoConfig) => ({
      ...repoConfig,
      hooks: {
        ...repoConfig.hooks,
        [key]: nextHookLines,
      },
    }));
  };

  return (
    <div className="grid gap-4 p-4">
      <RepositoryHookScriptsSection
        isDisabled={isDisabled}
        postCompleteHooks={selectedRepoConfig.hooks.postComplete}
        preStartHooks={selectedRepoConfig.hooks.preStart}
        updateHookDraft={updateHookDraft}
      />

      <div ref={devServersRef} id="repository-dev-servers">
        <RepositoryDevServersSection
          devServerValidationErrors={devServerValidationErrors}
          devServers={selectedRepoConfig.devServers}
          isDisabled={isDisabled}
          onUpdateSelectedRepoConfig={onUpdateSelectedRepoConfig}
        />
      </div>

      <RepositoryWorktreeCopyPathsSection
        isDisabled={isDisabled}
        worktreeCopyPaths={selectedRepoConfig.worktreeCopyPaths}
        onUpdateSelectedRepoConfig={onUpdateSelectedRepoConfig}
      />
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
  onUpdateSelectedRepoConfig,
}: {
  devServerValidationErrors: Record<string, { name?: string; command?: string }>;
  devServers: RepoConfig["devServers"];
  isDisabled: boolean;
  onUpdateSelectedRepoConfig: UpdateSelectedRepoConfig;
}): ReactElement {
  return (
    <div className="grid gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <Label>Dev servers</Label>
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
            onUpdateSelectedRepoConfig((repoConfig) => {
              const nextIndex = repoConfig.devServers.length + 1;
              let nextIdIndex = nextIndex;
              const existingIds = new Set(repoConfig.devServers.map((server) => server.id));
              while (existingIds.has(`draft-dev-server-${nextIdIndex}`)) {
                nextIdIndex += 1;
              }
              return {
                ...repoConfig,
                devServers: [
                  ...repoConfig.devServers,
                  {
                    id: `draft-dev-server-${nextIdIndex}`,
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
                onUpdateSelectedRepoConfig={onUpdateSelectedRepoConfig}
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
  onUpdateSelectedRepoConfig,
  validationErrors,
}: {
  devServer: RepoConfig["devServers"][number];
  index: number;
  isDisabled: boolean;
  isLastRow: boolean;
  onUpdateSelectedRepoConfig: UpdateSelectedRepoConfig;
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
            onUpdateSelectedRepoConfig((repoConfig) => ({
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
            onUpdateSelectedRepoConfig((repoConfig) => ({
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
            onUpdateSelectedRepoConfig((repoConfig) => {
              const nextDevServers = [...repoConfig.devServers];
              const [entry] = nextDevServers.splice(index, 1);
              if (!entry) {
                return repoConfig;
              }
              nextDevServers.splice(index - 1, 0, entry);
              return { ...repoConfig, devServers: nextDevServers };
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
            onUpdateSelectedRepoConfig((repoConfig) => {
              const nextDevServers = [...repoConfig.devServers];
              const [entry] = nextDevServers.splice(index, 1);
              if (!entry) {
                return repoConfig;
              }
              nextDevServers.splice(index + 1, 0, entry);
              return { ...repoConfig, devServers: nextDevServers };
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
            onUpdateSelectedRepoConfig((repoConfig) => ({
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

function RepositoryWorktreeCopyPathsSection({
  isDisabled,
  worktreeCopyPaths,
  onUpdateSelectedRepoConfig,
}: {
  isDisabled: boolean;
  worktreeCopyPaths: string[];
  onUpdateSelectedRepoConfig: UpdateSelectedRepoConfig;
}): ReactElement {
  return (
    <div className="grid gap-2">
      <Label htmlFor="repo-worktree-copy-paths">
        Files copied to worktrees (one path per line)
      </Label>
      <Textarea
        id="repo-worktree-copy-paths"
        rows={4}
        value={worktreeCopyPaths.join("\n")}
        disabled={isDisabled}
        onChange={(event) => {
          const worktreeCopyPathsInput = event.currentTarget.value;
          onUpdateSelectedRepoConfig((repoConfig) => ({
            ...repoConfig,
            worktreeCopyPaths: parseHookLines(worktreeCopyPathsInput),
          }));
        }}
      />
    </div>
  );
}
