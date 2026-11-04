import { randomUUID } from "node:crypto";
import {
  type GitlabAccount,
  type GitlabConnectionStatus,
  type GitlabFixAction,
  type GitlabProblem,
} from "@openducktor/contracts";
import { canonicalGitlabInstanceUrl, gitlabInstanceLabel } from "@openducktor/core";
import { Effect } from "effect";
import { type HostError, HostValidationError } from "../../../effect/host-errors";
import { createSerialGate } from "../../../effect/serial-gate";
import type {
  GitlabAccountFields,
  GitlabAccountStore,
} from "../../sqlite/sqlite-gitlab-account-store";
import type { GitlabConnectionPort } from "../../../ports/gitlab-connection-port";
import {
  checkGitlabInstance,
  gitlabAccountFields,
  gitlabTokenExpiry,
  readGitlabProject,
  readGitlabToken,
  readGitlabUser,
} from "./account-api";
import { configuredGitlabRepository } from "./repository";
import { type GitlabHttp, gitlabFailure, gitlabProblemOf, parseGitlabJson } from "./http";
import { createGitlabDeviceSignIn, oauthSecretOf, oauthTokenSchema } from "./device-sign-in";
import type { GitlabSecret, GitlabSecretStore } from "./secret-store";
import type { GitProviderWorkspace } from "../../../ports/git-provider-workspace";

const REFRESH_MARGIN_MS = 60_000;

/** The fix actions that the UI offers for a problem. */
const gitlabFixActions = (
  problem: GitlabProblem,
  account: GitlabAccount | null,
): GitlabFixAction[] => {
  const renew: GitlabFixAction = account?.authKind === "oauth" ? "sign_in_again" : "replace_token";
  switch (problem) {
    case "token_expired":
    case "access_revoked":
    case "missing_scope":
      return [renew, "use_another_account"];
    case "sign_in_required":
      return ["sign_in_again", "use_another_account"];
    case "project_unreachable":
      return ["use_another_account", renew];
    case "account_missing":
      return ["use_another_account"];
    case "rate_limited":
    case "instance_unreachable":
    case "gitlab_error":
    case "tls_untrusted":
      return ["retry"];
    case "http_consent_required":
      return ["confirm_http"];
    case "not_gitlab":
    case "version_unsupported":
      return [];
  }
};

export const createGitlabConnectionAdapter = ({
  http,
  accounts,
  secrets,
  clientId,
  now = Date.now,
}: {
  http: GitlabHttp;
  accounts: GitlabAccountStore;
  secrets: GitlabSecretStore;
  clientId: string | undefined;
  now?: () => number;
}): GitlabConnectionPort => {
  const refreshLanes = createSerialGate();

  const requireTransport = (instanceUrl: string, consentUrl: string | undefined) => {
    if (!instanceUrl.startsWith("http://")) return Effect.void;
    if (consentUrl !== undefined && canonicalGitlabInstanceUrl(consentUrl) === instanceUrl)
      return Effect.void;
    return Effect.fail(
      gitlabFailure(
        "check transport",
        "http_consent_required",
        `${instanceUrl} uses HTTP, so the token travels without encryption. Use an HTTPS URL, or confirm HTTP for this instance.`,
      ),
    );
  };

  const expired = (expiresAt: string | null) =>
    expiresAt !== null && Date.parse(expiresAt) <= now();

  const tokenExpiredFailure = (account: GitlabAccount) =>
    gitlabFailure(
      "authorize",
      "token_expired",
      `The GitLab token of @${account.username} expired. Replace the token.`,
    );

  const refresh = (account: GitlabAccount) =>
    refreshLanes.run(
      account.accountId,
      Effect.gen(function* () {
        // Another host can have rotated the tokens while this request waited for the lane.
        const secret = yield* secrets.read(account.accountId);
        if (secret?.kind !== "oauth")
          return yield* Effect.fail(signInRequired(account, "The saved sign-in is missing."));
        if (Date.parse(secret.accessTokenExpiresAt) - now() > REFRESH_MARGIN_MS)
          return secret.accessToken;
        if (!clientId)
          return yield* Effect.fail(
            signInRequired(account, "This build cannot renew GitLab sign-ins."),
          );
        const response = yield* http.sendAllowingClientErrors({
          operation: "renew sign-in",
          instanceUrl: account.instanceUrl,
          path: "/oauth/token",
          method: "POST",
          form: {
            grant_type: "refresh_token",
            refresh_token: secret.refreshToken,
            client_id: clientId,
          },
        });
        if (response.status >= 400)
          return yield* Effect.fail(signInRequired(account, "GitLab ended the sign-in."));
        const tokens = yield* parseGitlabJson("renew sign-in", response, oauthTokenSchema);
        // GitLab revokes the old tokens, so the new ones must be saved before any use.
        yield* secrets.save(account.accountId, oauthSecretOf(tokens, now()));
        return tokens.access_token;
      }),
    );

  const signInRequired = (account: GitlabAccount, reason: string) =>
    gitlabFailure(
      "renew sign-in",
      "sign_in_required",
      `${reason} Sign in to GitLab again as @${account.username}.`,
    );

  const headerFor = (account: GitlabAccount) =>
    Effect.gen(function* () {
      if (account.authKind === "token" && expired(account.tokenExpiresAt))
        return yield* Effect.fail(tokenExpiredFailure(account));
      const secret = yield* secrets.read(account.accountId);
      if (secret === null)
        return yield* Effect.fail(
          account.authKind === "oauth"
            ? signInRequired(account, "The saved sign-in is missing.")
            : gitlabFailure(
                "authorize",
                "access_revoked",
                `The saved GitLab token of @${account.username} is missing. Replace the token.`,
              ),
        );
      if (secret.kind === "token") return `Bearer ${secret.token}`;
      if (Date.parse(secret.accessTokenExpiresAt) - now() > REFRESH_MARGIN_MS)
        return `Bearer ${secret.accessToken}`;
      return `Bearer ${yield* refresh(account)}`;
    });

  const requireAccount = (accountId: string, instanceUrl: string) =>
    Effect.gen(function* () {
      const account = yield* accounts.get(accountId);
      if (!account || account.instanceUrl !== instanceUrl)
        return yield* Effect.fail(
          gitlabFailure(
            "authorize",
            "account_missing",
            `The linked GitLab account is not saved for ${gitlabInstanceLabel(instanceUrl)}. Connect a GitLab account in the repository Git settings.`,
          ),
        );
      return account;
    });

  // Repositories read the metadata and the secret together, so a failed write must keep the
  // prior pair. The secret goes first. A failed write puts the prior secret back, or deletes the
  // new one. That includes a failed secret write, because the OS store can change the secret and
  // then fail on its marker file.
  const saveAccount = (fields: GitlabAccountFields, secret: GitlabSecret) =>
    Effect.gen(function* () {
      const existing = yield* accounts.findByUser(fields.instanceUrl, fields.userId);
      const accountId = existing?.accountId ?? randomUUID();
      // The raw text, so a credential that no longer decodes can still be replaced.
      const previous = existing ? yield* secrets.snapshot(accountId) : null;
      return yield* secrets.save(accountId, secret).pipe(
        Effect.andThen(accounts.upsert(fields, accountId)),
        Effect.tapError(() =>
          secrets
            .restore(accountId, previous)
            .pipe(
              Effect.catch((error) =>
                Effect.logWarning(
                  `Failed to restore the GitLab credential of account ${accountId}: ${error.message}`,
                ),
              ),
            ),
        ),
      );
    });

  const release = (candidates?: readonly string[]) =>
    Effect.gen(function* () {
      const unreferenced = yield* accounts.listUnreferenced(candidates);
      yield* Effect.forEach(
        unreferenced,
        (accountId) =>
          Effect.gen(function* () {
            yield* secrets.delete(accountId);
            yield* accounts.delete(accountId);
          }).pipe(
            Effect.catch((error) =>
              Effect.logWarning(
                `Failed to delete the unused GitLab account ${accountId}: ${error.message}. The next host start retries.`,
              ),
            ),
          ),
        { discard: true },
      );
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning(`Failed to find unused GitLab accounts: ${error.message}`),
      ),
    );

  const signIn = createGitlabDeviceSignIn({ http, clientId, now, saveAccount });

  /** Turns an expected GitLab failure into a status with fix actions. */
  const needsAttention = (error: HostError, account: GitlabAccount | null) => {
    const failure = gitlabProblemOf(error);
    if (!failure) return Effect.fail(error);
    const { problem } = failure;
    // The HTTP layer does not know the account, so a 401 names only a generic fix.
    let message = error.message;
    if (problem === "access_revoked" && failure.status === 401 && account !== null)
      message =
        account.authKind === "oauth"
          ? `GitLab no longer accepts the sign-in of @${account.username}. Sign in again.`
          : `GitLab no longer accepts the token of @${account.username}. Replace the token.`;
    return Effect.succeed({
      status: "needs_attention",
      account,
      problem,
      message,
      actions: gitlabFixActions(problem, account),
      retryAfter: failure.retryAfter,
    } satisfies GitlabConnectionStatus);
  };

  return {
    listAccounts: (instanceUrl) => accounts.listByInstance(canonicalGitlabInstanceUrl(instanceUrl)),

    addToken: (input) =>
      Effect.gen(function* () {
        const instanceUrl = canonicalGitlabInstanceUrl(input.instanceUrl);
        yield* requireTransport(instanceUrl, input.httpConsentInstanceUrl);
        const authorization = `Bearer ${input.token.trim()}`;
        yield* checkGitlabInstance(http, instanceUrl, authorization);
        const token = yield* readGitlabToken(http, instanceUrl, authorization);
        if (!token.active || token.revoked === true)
          return yield* Effect.fail(
            gitlabFailure(
              "read token",
              "access_revoked",
              "The token is expired or revoked. Create a new token, then retry.",
            ),
          );
        if (!token.scopes.includes("api"))
          return yield* Effect.fail(
            gitlabFailure(
              "read token",
              "missing_scope",
              `The token has the scopes ${token.scopes.join(", ") || "none"}, but OpenDucktor needs the api scope. Create a token with the api scope.`,
            ),
          );
        const user = yield* readGitlabUser(http, instanceUrl, authorization);
        if (input.projectPath !== undefined)
          yield* readGitlabProject(http, instanceUrl, authorization, input.projectPath);
        if (input.replaceAccountId !== undefined) {
          const current = yield* accounts.get(input.replaceAccountId);
          if (current && (current.instanceUrl !== instanceUrl || current.userId !== user.id))
            return yield* Effect.fail(
              new HostValidationError({
                field: "token",
                message: `This token belongs to @${user.username}, not @${current.username}. To connect @${user.username}, choose Use another account.`,
              }),
            );
        }
        return yield* saveAccount(
          gitlabAccountFields(instanceUrl, user, "token", gitlabTokenExpiry(token.expires_at)),
          { kind: "token", token: input.token.trim() },
        );
      }),

    startSignIn: () => signIn.start(),
    pollSignIn: (attemptId) => signIn.poll(attemptId),

    status: (input) =>
      Effect.gen(function* () {
        const instanceUrl = canonicalGitlabInstanceUrl(input.instanceUrl);
        const accountResult = yield* Effect.result(
          requireTransport(instanceUrl, input.httpConsentInstanceUrl).pipe(
            Effect.andThen(requireAccount(input.accountId, instanceUrl)),
          ),
        );
        if (accountResult._tag === "Failure")
          return yield* needsAttention(accountResult.failure, null);
        const account = accountResult.success;
        const projectResult = yield* Effect.result(
          headerFor(account).pipe(
            Effect.flatMap((authorization) =>
              readGitlabProject(http, instanceUrl, authorization, input.projectPath),
            ),
          ),
        );
        if (projectResult._tag === "Failure")
          return yield* needsAttention(projectResult.failure, account);
        return {
          status: "ready",
          account,
          projectId: projectResult.success.id,
          projectWebUrl: projectResult.success.web_url,
        } satisfies GitlabConnectionStatus;
      }),

    authorization: (repoConfig: GitProviderWorkspace) =>
      Effect.gen(function* () {
        const repository = yield* configuredGitlabRepository(repoConfig);
        const settings = repoConfig.git.provider?.settings;
        const instanceUrl = repository.instanceUrl;
        yield* requireTransport(instanceUrl, settings?.httpConsentInstanceUrl);
        const accountId = settings?.accountId;
        if (!accountId)
          return yield* Effect.fail(
            gitlabFailure(
              "authorize",
              "account_missing",
              "No GitLab account is linked to this repository. Connect a GitLab account in the repository Git settings.",
            ),
          );
        const account = yield* requireAccount(accountId, instanceUrl);
        return {
          repository,
          account,
          headerValue: yield* headerFor(account),
        };
      }),

    release: (accountIds) => (accountIds.length === 0 ? Effect.void : release(accountIds)),
    sweep: () => release(),
    knownInstances: () => accounts.listKnownInstances(),
  };
};
