import type { SettingsRepoConfig } from "@openducktor/contracts";
import { type ReactElement, useEffect, useRef } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseHookLines } from "@/state/read-models/settings-read-model";
import type { SettingsContentFocusRequest } from "./settings-deep-link";
import { RepoActionsList } from "./settings-repo-actions-list";

type RepositoryScriptsSectionProps = {
  selectedRepoConfig: SettingsRepoConfig;
  loadingState: {
    isLoadingSettings: boolean;
    isSaving: boolean;
  };
  focusRequest?: SettingsContentFocusRequest | null | undefined;
  onFocusRequestHandled?: ((request: SettingsContentFocusRequest) => void) | undefined;
  onUpdateSelectedRepoConfig: (
    updater: (current: SettingsRepoConfig) => SettingsRepoConfig,
  ) => void;
};

type UpdateSelectedRepoConfig = RepositoryScriptsSectionProps["onUpdateSelectedRepoConfig"];

export function RepositoryScriptsSection({
  selectedRepoConfig,
  loadingState,
  focusRequest = null,
  onFocusRequestHandled,
  onUpdateSelectedRepoConfig,
}: RepositoryScriptsSectionProps): ReactElement {
  const actionsRef = useRef<HTMLDivElement>(null);
  const handledFocusRequestRef = useRef<SettingsContentFocusRequest | null>(null);

  useEffect(() => {
    if (
      focusRequest?.kind !== "repository-actions" ||
      focusRequest === handledFocusRequestRef.current ||
      !actionsRef.current
    ) {
      return;
    }

    actionsRef.current.scrollIntoView({ block: "start" });
    handledFocusRequestRef.current = focusRequest;
    onFocusRequestHandled?.(focusRequest);
  }, [focusRequest, onFocusRequestHandled]);

  const isDisabled = loadingState.isLoadingSettings || loadingState.isSaving;

  return (
    <div className="grid gap-4 p-4">
      <div ref={actionsRef} id="repository-actions">
        <RepoActionsList
          actions={selectedRepoConfig.actions}
          isDisabled={isDisabled}
          onUpdateActions={(updater) =>
            onUpdateSelectedRepoConfig((repoConfig) => ({
              ...repoConfig,
              actions: updater(repoConfig.actions),
            }))
          }
        />
      </div>

      <RepositoryBeforeWorktreeRemovalScriptSection
        isDisabled={isDisabled}
        beforeWorktreeRemovalHooks={selectedRepoConfig.hooks.beforeWorktreeRemoval}
        onUpdateSelectedRepoConfig={onUpdateSelectedRepoConfig}
      />

      <RepositoryWorktreeCopyPathsSection
        isDisabled={isDisabled}
        worktreeCopyPaths={selectedRepoConfig.worktreeCopyPaths}
        onUpdateSelectedRepoConfig={onUpdateSelectedRepoConfig}
      />
    </div>
  );
}

function RepositoryBeforeWorktreeRemovalScriptSection({
  isDisabled,
  beforeWorktreeRemovalHooks,
  onUpdateSelectedRepoConfig,
}: {
  isDisabled: boolean;
  beforeWorktreeRemovalHooks: string[];
  onUpdateSelectedRepoConfig: UpdateSelectedRepoConfig;
}): ReactElement {
  return (
    <div className="grid gap-2">
      <Label htmlFor="repo-before-worktree-removal-hooks">
        Before worktree removal script (one command per line)
      </Label>
      <p id="repo-before-worktree-removal-hooks-help" className="text-xs text-muted-foreground">
        Runs in the task worktree right before OpenDucktor removes it. A failed command stops the
        removal.
      </p>
      <Textarea
        id="repo-before-worktree-removal-hooks"
        aria-describedby="repo-before-worktree-removal-hooks-help"
        rows={4}
        value={beforeWorktreeRemovalHooks.join("\n")}
        disabled={isDisabled}
        onChange={(event) => {
          const beforeWorktreeRemoval = parseHookLines(event.currentTarget.value);
          onUpdateSelectedRepoConfig((repoConfig) => ({
            ...repoConfig,
            hooks: { ...repoConfig.hooks, beforeWorktreeRemoval },
          }));
        }}
      />
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
