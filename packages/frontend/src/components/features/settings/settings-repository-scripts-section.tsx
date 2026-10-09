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

      <RepositoryCleanupScriptSection
        isDisabled={isDisabled}
        postCompleteHooks={selectedRepoConfig.hooks.postComplete}
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

function RepositoryCleanupScriptSection({
  isDisabled,
  postCompleteHooks,
  onUpdateSelectedRepoConfig,
}: {
  isDisabled: boolean;
  postCompleteHooks: string[];
  onUpdateSelectedRepoConfig: UpdateSelectedRepoConfig;
}): ReactElement {
  return (
    <div className="grid gap-2">
      <Label htmlFor="repo-post-complete-hooks">
        Worktree cleanup script (one command per line)
      </Label>
      <Textarea
        id="repo-post-complete-hooks"
        rows={4}
        value={postCompleteHooks.join("\n")}
        disabled={isDisabled}
        onChange={(event) => {
          const postComplete = parseHookLines(event.currentTarget.value);
          onUpdateSelectedRepoConfig((repoConfig) => ({
            ...repoConfig,
            hooks: { ...repoConfig.hooks, postComplete },
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
