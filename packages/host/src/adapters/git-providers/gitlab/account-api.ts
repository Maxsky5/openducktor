import { GITLAB_MINIMUM_VERSION, type GitlabAuthKind } from "@openducktor/contracts";
import type { GitlabAccountFields } from "../../sqlite/sqlite-gitlab-account-store";
import { Effect } from "effect";
import { z } from "zod";
import {
  type GitlabHttp,
  type GitlabHttpResponse,
  type GitlabRequestError,
  gitlabFailure,
  parseGitlabJson,
  parseJsonText,
} from "./http";

const metadataSchema = z.object({ version: z.string().min(1) });
const userSchema = z.object({
  id: z.number().int().positive(),
  username: z.string().min(1),
  name: z.string(),
});
const tokenSchema = z.object({
  active: z.boolean(),
  revoked: z.boolean().optional(),
  scopes: z.array(z.string()),
  user_id: z.number().int().positive(),
  expires_at: z.string().nullable(),
});
const gitlabProjectSchema = z.object({
  id: z.number().int().positive(),
  path_with_namespace: z.string().min(1),
  web_url: z.url(),
});

export type GitlabProject = z.infer<typeof gitlabProjectSchema>;

const versionOf = (version: string) => {
  const match = /^(\d+)\.(\d+)/u.exec(version);
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : null;
};

/** Compares `major.minor` of a version such as `17.4.1-ee` with the minimum version. */
const isSupportedGitlabVersion = (version: string): boolean => {
  const found = versionOf(version);
  const minimum = versionOf(GITLAB_MINIMUM_VERSION);
  if (!found || !minimum) return false;
  return (
    found.major > minimum.major || (found.major === minimum.major && found.minor >= minimum.minor)
  );
};

const gitlabErrorSchema = z.object({ message: z.json() });

/** GitLab answers an API error with a JSON `message`. Another server does not. */
const isGitlabJson = (response: GitlabHttpResponse): boolean =>
  gitlabErrorSchema.safeParse(parseJsonText(new TextDecoder().decode(response.body))).success;

/** Checks that the URL runs GitLab 17.4 or later, and that it accepts the credential. */
export const checkGitlabInstance = (
  http: GitlabHttp,
  instanceUrl: string,
  authorization: string,
): Effect.Effect<void, GitlabRequestError> =>
  Effect.gen(function* () {
    const operation = "read instance version";
    const response = yield* http.sendAllowingClientErrors({
      operation,
      instanceUrl,
      path: "/api/v4/metadata",
      authorization,
    });
    if (response.status === 401 && isGitlabJson(response))
      return yield* Effect.fail(
        gitlabFailure(
          operation,
          "access_revoked",
          "GitLab rejected the token. It is wrong, expired, or revoked. Create a new token, then retry.",
          { status: 401 },
        ),
      );
    if (response.status === 403 && isGitlabJson(response))
      return yield* Effect.fail(
        gitlabFailure(
          operation,
          "missing_scope",
          "The token lacks the api scope. Create a token with the api scope, then retry.",
          { status: 403 },
        ),
      );
    if (response.status >= 400)
      return yield* Effect.fail(
        gitlabFailure(
          operation,
          "not_gitlab",
          `${instanceUrl} did not answer as a GitLab instance. Check the instance URL, including any sub-path.`,
          { status: response.status },
        ),
      );
    const metadata = yield* parseGitlabJson(operation, response, metadataSchema, "not_gitlab");
    if (!isSupportedGitlabVersion(metadata.version))
      return yield* Effect.fail(
        gitlabFailure(
          operation,
          "version_unsupported",
          `${instanceUrl} runs GitLab ${metadata.version}. OpenDucktor needs GitLab ${GITLAB_MINIMUM_VERSION} or later. Ask the instance administrator to upgrade GitLab.`,
        ),
      );
  });

export const readGitlabUser = (http: GitlabHttp, instanceUrl: string, authorization: string) =>
  http
    .send({ operation: "read user", instanceUrl, path: "/api/v4/user", authorization })
    .pipe(Effect.flatMap((response) => parseGitlabJson("read user", response, userSchema)));

/** Reads a personal, project, or group access token. Never call it with an OAuth token. */
export const readGitlabToken = (http: GitlabHttp, instanceUrl: string, authorization: string) =>
  http
    .send({
      operation: "read token",
      instanceUrl,
      path: "/api/v4/personal_access_tokens/self",
      authorization,
    })
    .pipe(Effect.flatMap((response) => parseGitlabJson("read token", response, tokenSchema)));

export const readGitlabProject = (
  http: GitlabHttp,
  instanceUrl: string,
  authorization: string,
  projectPath: string,
) =>
  http
    .send({
      operation: "read project",
      instanceUrl,
      path: `/api/v4/projects/${encodeURIComponent(projectPath)}`,
      authorization,
    })
    .pipe(
      Effect.mapError((error) =>
        error.details?.problem === "project_unreachable"
          ? gitlabFailure(
              "read project",
              "project_unreachable",
              `The GitLab account cannot reach the project ${projectPath}. Check the project path, or use an account with access to it.`,
              { status: error.details.status },
            )
          : error,
      ),
      Effect.flatMap((response) => parseGitlabJson("read project", response, gitlabProjectSchema)),
    );

/** The saved fields of a GitLab user's account on an instance. */
export const gitlabAccountFields = (
  instanceUrl: string,
  user: z.output<typeof userSchema>,
  authKind: GitlabAuthKind,
  tokenExpiresAt: string | null,
): GitlabAccountFields => ({
  instanceUrl,
  userId: user.id,
  username: user.username,
  displayName: user.name || user.username,
  authKind,
  tokenExpiresAt,
});

/** A GitLab token expiry date ends at midnight UTC of that date. */
export const gitlabTokenExpiry = (expiresAt: string | null): string | null =>
  expiresAt === null ? null : new Date(`${expiresAt.slice(0, 10)}T00:00:00.000Z`).toISOString();
