import { LoaderCircle, Search } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GitlabAccountPanel } from "./gitlab-account-panel";
import {
  changeGitlabInstance,
  type GitlabDraft,
  gitlabDraftErrors,
  gitlabHttpInstanceUrl,
} from "./gitlab-provider-model";
import type { GitlabAccountController } from "./use-gitlab-account-controller";

type GitlabProviderFieldsProps = {
  draft: GitlabDraft;
  onChange: (next: GitlabDraft) => void;
  account: GitlabAccountController;
  disabled: boolean;
  /** Fills the instance URL and project path from the origin remote. */
  onDetectFromOrigin: () => void;
  detecting: boolean;
  detectError: string | null;
  /** Shows "Project remote" when no remote matches, for an SSH host alias. */
  showRemoteField: boolean;
};

/** Instance, project, and account of a GitLab repository, in that order. */
export function GitlabProviderFields({
  draft,
  onChange,
  account,
  disabled,
  onDetectFromOrigin,
  detecting,
  detectError,
  showRemoteField,
}: GitlabProviderFieldsProps): ReactElement {
  const errors = gitlabDraftErrors(draft);
  const httpInstanceUrl = gitlabHttpInstanceUrl(draft);
  const confirmHttp = () => onChange({ ...draft, httpConsentInstanceUrl: httpInstanceUrl });
  return (
    <div className="grid min-w-0 gap-5">
      <section className="grid min-w-0 gap-3" aria-labelledby="gitlab-project-heading">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <h3 id="gitlab-project-heading" className="text-sm font-semibold text-foreground">
              Project
            </h3>
            <p className="text-xs text-muted-foreground">
              Use https://gitlab.com or the URL of your self-managed GitLab, with any sub-path.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || detecting}
            onClick={onDetectFromOrigin}
          >
            {detecting ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            ) : (
              <Search data-icon="inline-start" />
            )}
            Detect from origin
          </Button>
        </div>
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <Field
            id="gitlab-instance-url"
            label="Instance URL"
            value={draft.instanceUrl}
            placeholder="https://gitlab.com"
            error={errors.instanceUrl}
            disabled={disabled}
            onChange={(value) => onChange(changeGitlabInstance(draft, value))}
          />
          <Field
            id="gitlab-project-path"
            label="Project path"
            value={draft.projectPath}
            placeholder="group/subgroup/project"
            error={errors.projectPath}
            disabled={disabled}
            onChange={(projectPath) => onChange({ ...draft, projectPath })}
          />
        </div>
        {detectError ? (
          <p role="alert" className="text-xs text-destructive-surface-foreground">
            {detectError}
          </p>
        ) : null}
        {httpInstanceUrl ? (
          <Label className="flex items-start gap-2 rounded-md border border-warning-border bg-warning-surface p-3 text-xs font-normal text-warning-surface-foreground">
            <Checkbox
              checked={draft.httpConsentInstanceUrl === httpInstanceUrl}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onChange({ ...draft, httpConsentInstanceUrl: checked ? httpInstanceUrl : null })
              }
            />
            Send the GitLab token to {httpInstanceUrl} over HTTP without encryption.
          </Label>
        ) : null}
        {showRemoteField || draft.remoteName ? (
          <Field
            id="gitlab-remote-name"
            label="Project remote"
            value={draft.remoteName}
            placeholder="origin"
            hint="The local Git remote of this project, for example one that uses an SSH host alias."
            disabled={disabled}
            onChange={(remoteName) => onChange({ ...draft, remoteName })}
          />
        ) : null}
      </section>
      <GitlabAccountPanel
        controller={account}
        linkedAccountId={draft.accountId}
        disabled={disabled}
        onConfirmHttp={confirmHttp}
      />
    </div>
  );
}

function Field({
  id,
  label,
  value,
  placeholder,
  error,
  hint,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  error?: string | undefined;
  hint?: string;
  disabled: boolean;
  onChange: (value: string) => void;
}): ReactElement {
  return (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-note` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error || hint ? (
        <p
          id={`${id}-note`}
          className={
            error ? "text-xs text-destructive-surface-foreground" : "text-xs text-muted-foreground"
          }
        >
          {error ?? hint}
        </p>
      ) : null}
    </div>
  );
}
