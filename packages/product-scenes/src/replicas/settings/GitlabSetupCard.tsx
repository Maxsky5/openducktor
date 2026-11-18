// The GitLab setup card of the Git settings of a repository: ProviderSetupCard of
// provider-setup-card.tsx with the content of gitlab-editor-card.tsx and
// gitlab-provider-fields.tsx in packages/frontend/src/components/features/settings. The header has
// the readiness badge and the Enabled switch, the Project part has Detect from origin and the two
// fields, and GitlabAccount.tsx is the Account part. A scene changes the readiness with
// `data-variant` and the text of `data-readiness`, shows the spinner of Detect from origin with
// `data-detecting`, and fills the fields. An empty Project path shows its error under the field.
import { LoaderCircle, Search } from "lucide-react";
import type { ReactElement } from "react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Switch } from "../ui/Switch";
import { GitlabAccount } from "./GitlabAccount";
import { GitlabIcon } from "./GitProviderIcons";
import "./GitlabSetupCard.css";

/** The readiness states of gitlabReadiness that the scenes show, in their order. */
export const GITLAB_READINESS = {
  link: { label: "Link project", variant: "warning" },
  connect: { label: "Connect account", variant: "warning" },
  checking: { label: "Checking", variant: "outline" },
  ready: { label: "Ready", variant: "success" },
} as const satisfies Record<string, { label: string; variant: "warning" | "outline" | "success" }>;

export type GitlabReadiness = keyof typeof GITLAB_READINESS;

/** The words of provider-setup-card.tsx, gitlab-editor-card.tsx, and gitlab-provider-fields.tsx. */
export const GITLAB_CARD_TEXT = {
  title: "GitLab setup",
  description: "Link the project and connect your GitLab account. GitLab needs no CLI.",
  enabled: "Enabled",
  project: "Project",
  projectHint: "Use https://gitlab.com or the URL of your self-managed GitLab, with any sub-path.",
  detect: "Detect from origin",
  instanceUrl: "Instance URL",
  instancePlaceholder: "https://gitlab.com",
  projectPath: "Project path",
  projectPlaceholder: "group/subgroup/project",
} as const;

/** The error of gitlabDraftErrors for an empty project path. */
export const GITLAB_PROJECT_PATH_ERROR = "Enter the GitLab project path.";

type GitlabSetupCardProps = {
  readiness: GitlabReadiness;
  instanceUrl: string;
  /** The project path. An empty path shows the placeholder. */
  projectPath: string;
  account: Parameters<typeof GitlabAccount>[0];
};

/**
 * A Field of gitlab-provider-fields.tsx: the label over the input. A field with `emptyError` shows
 * that error under the input while the input is empty.
 */
function Field({
  id,
  label,
  value,
  placeholder,
  emptyError,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  emptyError?: string;
}): ReactElement {
  return (
    <div className="glc-field">
      <b>{label}</b>
      <Input placeholder={placeholder} value={value} data-field={id} />
      {emptyError ? <p className="glc-error">{emptyError}</p> : null}
    </div>
  );
}

export function GitlabSetupCard({
  readiness,
  instanceUrl,
  projectPath,
  account,
}: GitlabSetupCardProps): ReactElement {
  const text = GITLAB_CARD_TEXT;
  const status = GITLAB_READINESS[readiness];
  return (
    <div className="glc" data-gitlab-card="">
      <div className="glc-head" data-card-head="">
        <div className="glc-id">
          <span className="glc-tile">
            <GitlabIcon className="i16" />
          </span>
          <div className="glc-title">
            <b>{text.title}</b>
            <p>{text.description}</p>
          </div>
        </div>
        <div className="glc-status">
          <Badge variant={status.variant} className="glc-badge" data-readiness>
            {status.label}
          </Badge>
          <span className="glc-switch">
            <Switch checked />
            {text.enabled}
          </span>
        </div>
      </div>
      <div className="glc-body">
        <section className="glc-project">
          <div className="glc-project-head">
            <div className="glc-title glc-section">
              <b>{text.project}</b>
              <p>{text.projectHint}</p>
            </div>
            <Button variant="outline" size="sm" className="glc-detect" data-detect>
              <Search className="glc-idle-icon" />
              <LoaderCircle className="spin glc-busy-icon" />
              {text.detect}
            </Button>
          </div>
          <div className="glc-grid">
            <Field
              id="instance-url"
              label={text.instanceUrl}
              value={instanceUrl}
              placeholder={text.instancePlaceholder}
            />
            <Field
              id="project-path"
              label={text.projectPath}
              value={projectPath}
              placeholder={text.projectPlaceholder}
              emptyError={GITLAB_PROJECT_PATH_ERROR}
            />
          </div>
        </section>
        <GitlabAccount {...account} />
      </div>
    </div>
  );
}
