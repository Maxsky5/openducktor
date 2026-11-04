import type { SettingsRepoConfig } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactElement, useRef, useState } from "react";
import { connectionHost } from "@openducktor/frontend-core/connection/client-connection";
import { GitlabEditorCard } from "./gitlab-editor-card";
import {
  gitlabDraftErrors,
  gitlabDraftFromConfig,
  gitlabProviderConfig,
} from "./gitlab-provider-model";
import { type GitlabDraftState, useGitlabDraftEditor } from "./use-gitlab-draft-editor";
import type { GitProviderState } from "./use-repository-git-section-model";

type GitlabGitProviderFormProps = {
  selectedRepoPath: string;
  selectedRepoConfig: SettingsRepoConfig;
  providerState: GitProviderState;
  disabled: boolean;
  onValidationChange: (errorCount: number) => void;
  onUpdateSelectedRepoConfig: (
    updater: (current: SettingsRepoConfig) => SettingsRepoConfig,
  ) => void;
};

export function GitlabGitProviderForm({
  selectedRepoPath,
  selectedRepoConfig,
  providerState,
  disabled,
  onValidationChange,
  onUpdateSelectedRepoConfig,
}: GitlabGitProviderFormProps): ReactElement {
  const queryClient = useQueryClient();
  const [state, setState] = useState<GitlabDraftState>(() => ({
    draft: gitlabDraftFromConfig(selectedRepoConfig.git.provider),
    enabled: selectedRepoConfig.git.provider?.enabled ?? true,
  }));
  // Late replies read the latest state, so it lives in a ref beside the rendered state.
  const stateRef = useRef(state);
  const editor = useGitlabDraftEditor({
    state,
    fromSavedSettings: true,
    owner: {
      read: () => stateRef.current,
      write: (next) => {
        stateRef.current = next;
        setState(next);
        onValidationChange(next.enabled ? Object.keys(gitlabDraftErrors(next.draft)).length : 0);
        // The form unmounts when the user picks another provider. This guard keeps a write that
        // races that change from bringing GitLab back.
        onUpdateSelectedRepoConfig((repoConfig) =>
          repoConfig.git.provider?.id === "gitlab"
            ? {
                ...repoConfig,
                git: {
                  ...repoConfig.git,
                  provider: gitlabProviderConfig(next.draft, {
                    enabled: next.enabled,
                    autoDetected: false,
                  }),
                },
              }
            : repoConfig,
        );
      },
    },
    detectOrigin: () =>
      connectionHost(queryClient).workspaceDetectGitlabRepository({
        workspaceId: selectedRepoConfig.workspaceId,
        repoPath: selectedRepoPath,
      }),
  });

  const health = providerState.status === "loaded" ? providerState.context?.health : undefined;
  return (
    <GitlabEditorCard
      editor={editor}
      state={state}
      disabled={disabled}
      showRemoteField={health?.repositoryMappingValid === false}
    />
  );
}
