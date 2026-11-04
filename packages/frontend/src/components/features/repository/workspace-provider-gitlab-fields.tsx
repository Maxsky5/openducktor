import type { ReactElement } from "react";
import { GitlabEditorCard } from "../settings/gitlab-editor-card";
import { useGitlabDraftEditor } from "../settings/use-gitlab-draft-editor";
import type { FieldProps } from "./workspace-provider-fields";

export function GitlabSetupFields({ provider, disabled }: FieldProps): ReactElement {
  const { draft, update } = provider;
  const state = { draft: draft.gitlab, enabled: draft.enabled };
  const editor = useGitlabDraftEditor({
    state,
    fromSavedSettings: false,
    owner: {
      read: () => {
        const current = provider.readDraft();
        return current.providerId === "gitlab"
          ? { draft: current.gitlab, enabled: current.enabled }
          : null;
      },
      write: (next) =>
        update((current) =>
          current.providerId === "gitlab"
            ? { ...current, gitlab: next.draft, enabled: next.enabled }
            : current,
        ),
    },
    detectOrigin: async () => (await provider.retryDetection())?.gitlabOrigin ?? null,
  });
  return (
    <GitlabEditorCard
      editor={editor}
      state={state}
      disabled={disabled}
      showRemoteField={provider.remoteMappingFailed}
    />
  );
}
