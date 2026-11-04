import type { ReactElement } from "react";
import { GITLAB_PROVIDER_DESCRIPTOR } from "@openducktor/contracts";
import { GitlabIcon } from "./git-provider-icons";
import { GitlabProviderFields } from "./gitlab-provider-fields";
import { gitlabReadiness } from "./gitlab-provider-model";
import { ProviderSetupCard } from "./provider-setup-card";
import type { GitlabDraftState, useGitlabDraftEditor } from "./use-gitlab-draft-editor";

/** The GitLab setup card that Settings and workspace setup show for one draft. */
export function GitlabEditorCard({
  editor,
  state,
  disabled,
  showRemoteField,
}: {
  editor: ReturnType<typeof useGitlabDraftEditor>;
  state: GitlabDraftState;
  disabled: boolean;
  showRemoteField: boolean;
}): ReactElement {
  const readiness = gitlabReadiness({ ...state, status: editor.account.status });
  return (
    <ProviderSetupCard
      providerLabel={GITLAB_PROVIDER_DESCRIPTOR.label}
      headingId="gitlab-heading"
      icon={GitlabIcon}
      description="Link the project and connect your GitLab account. GitLab needs no CLI."
      enabled={state.enabled}
      disabled={disabled}
      onEnabledChange={editor.setEnabled}
      readiness={readiness}
    >
      {readiness.warning ? (
        <p role="status" className="text-xs text-warning-surface-foreground">
          {readiness.warning}
        </p>
      ) : null}
      <GitlabProviderFields
        draft={state.draft}
        onChange={editor.edit}
        account={editor.account}
        disabled={disabled || !state.enabled}
        onDetectFromOrigin={editor.detectFromOrigin}
        detecting={editor.detecting}
        detectError={editor.detectError}
        showRemoteField={showRemoteField}
      />
    </ProviderSetupCard>
  );
}
