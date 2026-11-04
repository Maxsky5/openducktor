import { z } from "zod";
import { isoTimestampSchema } from "./string-schemas";

/** The canonical GitLab.com instance URL. */
export const GITLAB_COM_INSTANCE_URL = "https://gitlab.com";

/** Self-managed instances must run this GitLab version or later. */
export const GITLAB_MINIMUM_VERSION = "17.4";

const instanceUrlIssue = (value: string): string | null => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Enter the GitLab instance URL, for example https://gitlab.example.com.";
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    return "The GitLab instance URL must use HTTPS or HTTP.";
  }
  if (url.username || url.password || url.search || url.hash || value.includes("\\")) {
    return "The GitLab instance URL must not contain credentials, a query, or a fragment.";
  }
  for (const segment of url.pathname.split("/")) {
    if (segment === "." || segment === ".." || segment.includes("%")) {
      return "The GitLab instance URL contains an unsafe path.";
    }
  }
  return null;
};

/** A GitLab instance URL: HTTPS or HTTP, with an optional sub-path. */
export const gitlabInstanceUrlSchema = z
  .string()
  .trim()
  .min(1, "Enter the GitLab instance URL.")
  .superRefine((value, context) => {
    const issue = instanceUrlIssue(value);
    if (issue) context.addIssue({ code: "custom", message: issue });
  });

/** A full GitLab project path, such as `group/subgroup/project`, without `.git`. */
export const gitlabProjectPathSchema = z
  .string()
  .trim()
  .min(1, "Enter the GitLab project path.")
  .refine(
    (value) => {
      const segments = value.split("/");
      return (
        segments.length >= 2 &&
        !value.endsWith(".git") &&
        segments.every(
          (segment) =>
            segment.length > 0 &&
            segment !== "." &&
            segment !== ".." &&
            !/[\s?#%\\]/u.test(segment),
        )
      );
    },
    { message: "Enter the full project path, for example group/project." },
  );

export const gitlabRepositorySchema = z.strictObject({
  providerId: z.literal("gitlab"),
  instanceUrl: gitlabInstanceUrlSchema,
  projectPath: gitlabProjectPathSchema,
});
export type GitlabRepository = z.infer<typeof gitlabRepositorySchema>;

/** The GitLab fields of `git.provider.settings`. Only the `gitlab` provider can use them. */
export const gitlabProviderSettingsSchema = z.strictObject({
  /** The saved GitLab account that this repository uses. */
  accountId: z.uuid().optional(),
  /** A named Git remote to use when its URL uses an SSH host alias. */
  remoteName: z.string().trim().min(1).optional(),
  /** The HTTP instance URL that the user allowed. */
  httpConsentInstanceUrl: z.url().optional(),
});

export const gitlabAuthKindSchema = z.enum(["oauth", "token"]);
export type GitlabAuthKind = z.infer<typeof gitlabAuthKindSchema>;

export const gitlabAccountSchema = z.strictObject({
  accountId: z.uuid(),
  instanceUrl: z.url(),
  userId: z.number().int().positive(),
  username: z.string().min(1),
  displayName: z.string().min(1),
  authKind: gitlabAuthKindSchema,
  /** The expiry of an access token. It is null for browser sign-in. */
  tokenExpiresAt: isoTimestampSchema.nullable(),
});
export type GitlabAccount = z.infer<typeof gitlabAccountSchema>;

export const gitlabProblemSchema = z.enum([
  "account_missing",
  "token_expired",
  "sign_in_required",
  "access_revoked",
  "missing_scope",
  "project_unreachable",
  "instance_unreachable",
  "tls_untrusted",
  "not_gitlab",
  "version_unsupported",
  "rate_limited",
  "http_consent_required",
  /** GitLab answered with a server error or a response that OpenDucktor cannot read. */
  "gitlab_error",
]);
export type GitlabProblem = z.infer<typeof gitlabProblemSchema>;

export const gitlabFixActionSchema = z.enum([
  "replace_token",
  "sign_in_again",
  "use_another_account",
  "retry",
  "confirm_http",
]);
export type GitlabFixAction = z.infer<typeof gitlabFixActionSchema>;

export const gitlabConnectionStatusSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ready"),
    account: gitlabAccountSchema,
    projectId: z.number().int().positive(),
    projectWebUrl: z.url(),
  }),
  z.strictObject({
    status: z.literal("needs_attention"),
    account: gitlabAccountSchema.nullable(),
    problem: gitlabProblemSchema,
    message: z.string().min(1),
    actions: z.array(gitlabFixActionSchema),
    retryAfter: isoTimestampSchema.nullable(),
  }),
]);
export type GitlabConnectionStatus = z.infer<typeof gitlabConnectionStatusSchema>;

export const gitlabDeviceCodeSchema = z.strictObject({
  attemptId: z.uuid(),
  verificationUri: z.url(),
  verificationUriComplete: z.url(),
  userCode: z.string().min(1),
  expiresAt: isoTimestampSchema,
  nextPollAt: isoTimestampSchema,
});
export type GitlabDeviceCode = z.infer<typeof gitlabDeviceCodeSchema>;

export const gitlabSignInPollResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("pending"), nextPollAt: isoTimestampSchema }),
  z.strictObject({ status: z.literal("connected"), account: gitlabAccountSchema }),
  z.strictObject({ status: z.literal("failed"), reason: z.string().min(1) }),
]);
export type GitlabSignInPollResult = z.infer<typeof gitlabSignInPollResultSchema>;

export const gitlabAccountsListInputSchema = z.strictObject({
  instanceUrl: gitlabInstanceUrlSchema,
});
export type GitlabAccountsListInput = z.infer<typeof gitlabAccountsListInputSchema>;
export const gitlabAccountsListResultSchema = z.array(gitlabAccountSchema);

export const gitlabConnectionStatusInputSchema = z.strictObject({
  instanceUrl: gitlabInstanceUrlSchema,
  projectPath: gitlabProjectPathSchema,
  accountId: z.uuid(),
  httpConsentInstanceUrl: z.url().optional(),
});
export type GitlabConnectionStatusInput = z.infer<typeof gitlabConnectionStatusInputSchema>;

export const gitlabAccountAddTokenInputSchema = z.strictObject({
  instanceUrl: gitlabInstanceUrlSchema,
  token: z.string().trim().min(1, "Enter the access token."),
  projectPath: gitlabProjectPathSchema.optional(),
  httpConsentInstanceUrl: z.url().optional(),
  replaceAccountId: z.uuid().optional(),
});
export type GitlabAccountAddTokenInput = z.infer<typeof gitlabAccountAddTokenInputSchema>;

export const gitlabSignInPollInputSchema = z.strictObject({
  attemptId: z.uuid(),
});
export type GitlabSignInPollInput = z.infer<typeof gitlabSignInPollInputSchema>;
