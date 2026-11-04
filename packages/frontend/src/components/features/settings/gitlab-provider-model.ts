import {
  GITLAB_COM_INSTANCE_URL,
  type GitProviderConfig,
  type GitlabConnectionStatus,
  type GitlabConnectionStatusInput,
  type GitlabRepository,
  gitlabInstanceUrlSchema,
  gitlabProjectPathSchema,
} from "@openducktor/contracts";
import { canonicalGitlabInstanceUrl, isGitlabRepository } from "@openducktor/core";

/** The editable GitLab fields of one repository. */
export type GitlabDraft = {
  instanceUrl: string;
  projectPath: string;
  accountId: string | null;
  remoteName: string;
  httpConsentInstanceUrl: string | null;
};

export type GitlabDraftErrors = {
  instanceUrl?: string;
  projectPath?: string;
};

export const gitlabDraftFromConfig = (config: GitProviderConfig | undefined): GitlabDraft => {
  const repository =
    config?.repository && isGitlabRepository(config.repository) ? config.repository : undefined;
  return {
    instanceUrl: repository?.instanceUrl ?? GITLAB_COM_INSTANCE_URL,
    projectPath: repository?.projectPath ?? "",
    accountId: config?.settings?.accountId ?? null,
    remoteName: config?.settings?.remoteName ?? "",
    httpConsentInstanceUrl: config?.settings?.httpConsentInstanceUrl ?? null,
  };
};

/** Adds `https://` when the user types a host name without a scheme. */
const withScheme = (value: string): string => {
  const trimmed = value.trim();
  return trimmed === "" || /^[a-z][a-z\d+.-]*:\/\//iu.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
};

/** The canonical instance URL of the draft, or null while it is invalid. */
export const gitlabDraftInstanceUrl = (draft: GitlabDraft): string | null => {
  const parsed = gitlabInstanceUrlSchema.safeParse(withScheme(draft.instanceUrl));
  return parsed.success ? canonicalGitlabInstanceUrl(parsed.data) : null;
};

const projectPathOf = (value: string): string =>
  value
    .trim()
    .replace(/^\/+|\/+$/gu, "")
    .replace(/\.git$/u, "");

export const gitlabDraftErrors = (draft: GitlabDraft): GitlabDraftErrors => {
  const errors: GitlabDraftErrors = {};
  const instance = gitlabInstanceUrlSchema.safeParse(withScheme(draft.instanceUrl));
  if (!instance.success)
    errors.instanceUrl = instance.error.issues[0]?.message ?? "Enter the GitLab instance URL.";
  const project = gitlabProjectPathSchema.safeParse(projectPathOf(draft.projectPath));
  if (!project.success)
    errors.projectPath = project.error.issues[0]?.message ?? "Enter the GitLab project path.";
  return errors;
};

export const parseGitlabDraft = (draft: GitlabDraft): GitlabRepository | null => {
  const instanceUrl = gitlabDraftInstanceUrl(draft);
  const projectPath = gitlabProjectPathSchema.safeParse(projectPathOf(draft.projectPath));
  return instanceUrl && projectPath.success
    ? { providerId: "gitlab", instanceUrl, projectPath: projectPath.data }
    : null;
};

/** An HTTP instance needs consent for its exact URL. */
export const gitlabHttpInstanceUrl = (draft: GitlabDraft): string | null => {
  const instanceUrl = gitlabDraftInstanceUrl(draft);
  return instanceUrl?.startsWith("http://") ? instanceUrl : null;
};

/** A new instance URL drops a link to an account and a consent of the old instance. */
export const changeGitlabInstance = (draft: GitlabDraft, instanceUrl: string): GitlabDraft => {
  const next = { ...draft, instanceUrl };
  if (gitlabDraftInstanceUrl(next) === gitlabDraftInstanceUrl(draft)) return next;
  return { ...next, accountId: null, httpConsentInstanceUrl: null };
};

/** Fills the instance and project from the origin remote. The rest of the draft stays. */
export const applyGitlabOrigin = (draft: GitlabDraft, origin: GitlabRepository): GitlabDraft => ({
  ...changeGitlabInstance(draft, origin.instanceUrl),
  projectPath: origin.projectPath,
});

/** The provider config of the draft. An invalid project stays out of the config. */
export const gitlabProviderConfig = (
  draft: GitlabDraft,
  { enabled, autoDetected }: { enabled: boolean; autoDetected: boolean },
): GitProviderConfig => {
  const repository = parseGitlabDraft(draft);
  const settings: NonNullable<GitProviderConfig["settings"]> = {};
  if (repository && draft.accountId) settings.accountId = draft.accountId;
  if (draft.remoteName.trim()) settings.remoteName = draft.remoteName.trim();
  if (draft.httpConsentInstanceUrl) settings.httpConsentInstanceUrl = draft.httpConsentInstanceUrl;
  const config: GitProviderConfig = { id: "gitlab", enabled, autoDetected };
  if (repository) config.repository = repository;
  if (Object.keys(settings).length) config.settings = settings;
  return config;
};

export const gitlabStatusInput = (draft: GitlabDraft): GitlabConnectionStatusInput | null => {
  const repository = parseGitlabDraft(draft);
  if (!repository || !draft.accountId) return null;
  const input: GitlabConnectionStatusInput = {
    instanceUrl: repository.instanceUrl,
    projectPath: repository.projectPath,
    accountId: draft.accountId,
  };
  if (draft.httpConsentInstanceUrl) input.httpConsentInstanceUrl = draft.httpConsentInstanceUrl;
  return input;
};

export type GitlabReadiness = {
  label: "Disabled" | "Link project" | "Connect account" | "Checking" | "Ready" | "Needs attention";
  variant: "success" | "outline" | "warning";
  /** A warning to show beside a Ready state, such as a token that expires soon. */
  warning: string | null;
};

const EXPIRY_WARNING_MS = 7 * 24 * 60 * 60 * 1_000;

/** One readiness state at a time, from the draft and the connection status. */
export const gitlabReadiness = ({
  enabled,
  draft,
  status,
  now = Date.now(),
}: {
  enabled: boolean;
  draft: GitlabDraft;
  status: GitlabConnectionStatus | null;
  now?: number;
}): GitlabReadiness => {
  if (!enabled) return { label: "Disabled", variant: "outline", warning: null };
  if (!parseGitlabDraft(draft)) return { label: "Link project", variant: "warning", warning: null };
  if (!draft.accountId) return { label: "Connect account", variant: "warning", warning: null };
  if (status === null) return { label: "Checking", variant: "outline", warning: null };
  if (status.status === "needs_attention")
    return { label: "Needs attention", variant: "warning", warning: null };
  const expiresAt = status.account.tokenExpiresAt;
  const remaining = expiresAt === null ? null : Date.parse(expiresAt) - now;
  return {
    label: "Ready",
    variant: "success",
    warning:
      remaining !== null && remaining <= EXPIRY_WARNING_MS
        ? `The token expires on ${new Date(expiresAt!).toLocaleDateString()}. Replace it before then.`
        : null,
  };
};
