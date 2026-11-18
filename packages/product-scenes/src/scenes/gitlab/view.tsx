// The Git settings of a repository with GitLab. The Settings dialog shows the Repositories section,
// cropped to the repository menu and the Git tab of the Fieldnotes repository. The visitor selects
// GitLab, Detect from origin fills the project, and the visitor signs in with GitLab. Sources:
// settings-modal-sidebars.tsx, settings-repository-git-section.tsx, git-provider-selector.tsx,
// provider-setup-card.tsx, gitlab-editor-card.tsx, gitlab-provider-fields.tsx, and
// gitlab-account-panel.tsx in packages/frontend/src/components/features/settings. The markup holds
// the last frame: the account is linked, and the card is Ready.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import {
  GITLAB_PROJECT_PATH_ERROR,
  GitlabSetupCard,
} from "../../replicas/settings/GitlabSetupCard";
import { GitProviderSelector } from "../../replicas/settings/GitProviderSelector";
import { RepositorySidebar } from "../../replicas/settings/RepositorySidebar";
import { SettingsPane } from "../../replicas/settings/SettingsPane";
import { Pointer } from "../../replicas/shell/Pointer";
import { WORKSPACE } from "../../sample/workspace";
import { ACCOUNT, INSTANCE_LABEL, INSTANCE_URL, PROJECT_PATH, SIGN_IN_CODE } from "./sample";
import "./view.css";

export function GitlabView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="gitlab"
      alt={`The Git tab of the ${WORKSPACE} repository in Settings. The Git provider choice shows No provider, GitHub, GitLab, and Azure DevOps, with No provider selected. The visitor selects GitLab, and the GitLab setup card shows the status Link project and the instance URL ${INSTANCE_URL}. The empty Project path shows ${GITLAB_PROJECT_PATH_ERROR} The visitor selects Detect from origin, and the project path ${PROJECT_PATH} fills in. The status changes to Connect account. The visitor selects Sign in with GitLab. The card shows Approve the sign-in in GitLab with a one-time code while the browser asks for the approval. Then the card shows Connected as @${ACCOUNT.username} on ${INSTANCE_LABEL}, checks the connection, and the status changes to Ready.`}
    >
      <SettingsPane className="gl-pane">
        <RepositorySidebar repository={WORKSPACE} section="Git" />
        <div className="gl-content" data-tab="">
          <div className="gl-sections">
            <GitProviderSelector selected="gitlab" />
            <GitlabSetupCard
              readiness="ready"
              instanceUrl={INSTANCE_URL}
              projectPath={PROJECT_PATH}
              account={{
                step: "linked",
                account: ACCOUNT,
                instance: INSTANCE_LABEL,
                code: SIGN_IN_CODE,
              }}
            />
          </div>
        </div>
        <Pointer />
      </SettingsPane>
    </SceneFrame>
  );
}
