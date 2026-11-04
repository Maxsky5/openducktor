import { randomUUID } from "node:crypto";
import {
  GITLAB_COM_INSTANCE_URL,
  type GitlabAccount,
  type GitlabDeviceCode,
  type GitlabSignInPollResult,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { z } from "zod";
import { type HostError, HostValidationError } from "../../../effect/host-errors";
import { createSerialGate } from "../../../effect/serial-gate";
import type { GitlabAccountFields } from "../../sqlite/sqlite-gitlab-account-store";
import { gitlabAccountFields, readGitlabUser } from "./account-api";
import { type GitlabHttp, parseGitlabJson } from "./http";
import type { GitlabSecret } from "./secret-store";

const OAUTH_SCOPE = "api";

const deviceCodeSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z.url(),
  verification_uri_complete: z.url().optional(),
  expires_in: z.number().positive(),
  interval: z.number().positive().optional(),
});
export const oauthTokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive().optional(),
});

const oauthErrorSchema = z.object({
  error: z.string().min(1),
  error_description: z.string().optional(),
});

type SignInAttempt = {
  deviceCode: string;
  intervalMs: number;
  expiresAt: number;
  nextPollAt: number;
};

const signInFailureReason = (error: z.output<typeof oauthErrorSchema>): string => {
  switch (error.error) {
    case "access_denied":
      return "GitLab sign-in was denied. Start sign-in again to retry.";
    case "expired_token":
      return "The GitLab sign-in code expired. Start sign-in again.";
    default:
      return `GitLab sign-in failed: ${error.error_description ?? error.error}. Start sign-in again.`;
  }
};

const iso = (time: number) => new Date(time).toISOString();

/** The saved secret of an OAuth token reply. GitLab access tokens last two hours by default. */
export const oauthSecretOf = (
  tokens: z.output<typeof oauthTokenSchema>,
  now: number,
): GitlabSecret => ({
  kind: "oauth",
  accessToken: tokens.access_token,
  refreshToken: tokens.refresh_token,
  accessTokenExpiresAt: iso(now + (tokens.expires_in ?? 7_200) * 1_000),
});

/**
 * GitLab.com device sign-in. The client polls at each `nextPollAt`, and each poll makes at most
 * one token request. The device code never leaves the host.
 */
export const createGitlabDeviceSignIn = ({
  http,
  clientId,
  now,
  saveAccount,
}: {
  http: GitlabHttp;
  clientId: string | undefined;
  now: () => number;
  saveAccount: (
    fields: GitlabAccountFields,
    secret: GitlabSecret,
  ) => Effect.Effect<GitlabAccount, HostError>;
}) => {
  const attempts = new Map<string, SignInAttempt>();
  const attemptLanes = createSerialGate();

  const pollOnce = (attemptId: string, attempt: SignInAttempt) =>
    Effect.gen(function* () {
      const response = yield* http.sendAllowingClientErrors({
        operation: "finish sign-in",
        instanceUrl: GITLAB_COM_INSTANCE_URL,
        path: "/oauth/token",
        method: "POST",
        form: {
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: attempt.deviceCode,
          client_id: clientId ?? "",
        },
      });
      if (response.status >= 400) {
        const error = yield* parseGitlabJson("finish sign-in", response, oauthErrorSchema);
        if (error.error === "authorization_pending" || error.error === "slow_down") {
          if (error.error === "slow_down") attempt.intervalMs += 5_000;
          attempt.nextPollAt = now() + attempt.intervalMs;
          return { status: "pending", nextPollAt: iso(attempt.nextPollAt) } as const;
        }
        attempts.delete(attemptId);
        return { status: "failed", reason: signInFailureReason(error) } as const;
      }
      const tokens = yield* parseGitlabJson("finish sign-in", response, oauthTokenSchema);
      attempts.delete(attemptId);
      const user = yield* readGitlabUser(
        http,
        GITLAB_COM_INSTANCE_URL,
        `Bearer ${tokens.access_token}`,
      );
      const account = yield* saveAccount(
        gitlabAccountFields(GITLAB_COM_INSTANCE_URL, user, "oauth", null),
        oauthSecretOf(tokens, now()),
      );
      return { status: "connected", account } as const;
    });

  return {
    start: () =>
      Effect.gen(function* () {
        if (!clientId)
          return yield* Effect.fail(
            new HostValidationError({
              field: "gitlabSignIn",
              message:
                "GitLab browser sign-in is not available in this build. Use a token instead.",
            }),
          );
        const response = yield* http.send({
          operation: "start sign-in",
          instanceUrl: GITLAB_COM_INSTANCE_URL,
          path: "/oauth/authorize_device",
          method: "POST",
          form: { client_id: clientId, scope: OAUTH_SCOPE },
        });
        const code = yield* parseGitlabJson("start sign-in", response, deviceCodeSchema);
        const attemptId = randomUUID();
        const intervalMs = (code.interval ?? 5) * 1_000;
        const attempt: SignInAttempt = {
          deviceCode: code.device_code,
          intervalMs,
          expiresAt: now() + code.expires_in * 1_000,
          nextPollAt: now() + intervalMs,
        };
        attempts.set(attemptId, attempt);
        return {
          attemptId,
          verificationUri: code.verification_uri,
          verificationUriComplete: code.verification_uri_complete ?? code.verification_uri,
          userCode: code.user_code,
          expiresAt: iso(attempt.expiresAt),
          nextPollAt: iso(attempt.nextPollAt),
        } satisfies GitlabDeviceCode;
      }),

    poll: (attemptId: string) =>
      attemptLanes.run(
        attemptId,
        Effect.gen(function* () {
          const attempt = attempts.get(attemptId);
          if (!attempt || attempt.expiresAt <= now()) {
            attempts.delete(attemptId);
            return {
              status: "failed",
              reason: "The GitLab sign-in expired. Start sign-in again.",
            } satisfies GitlabSignInPollResult;
          }
          if (now() < attempt.nextPollAt)
            return {
              status: "pending",
              nextPollAt: iso(attempt.nextPollAt),
            } satisfies GitlabSignInPollResult;
          return yield* pollOnce(attemptId, attempt);
        }),
      ),
  };
};
