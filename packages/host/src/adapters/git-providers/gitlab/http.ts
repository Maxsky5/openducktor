import { type GitlabProblem, gitlabProblemSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { z } from "zod";
import { type HostError, HostOperationError } from "../../../effect/host-errors";
import type { GitProviderFetch } from "../git-provider-fetch";

const REQUEST_TIMEOUT = "30 seconds";

const gitlabFailureDetailsSchema = z.object({
  provider: z.literal("gitlab"),
  problem: gitlabProblemSchema,
  status: z.number().nullable(),
  retryAfter: z.string().nullable(),
});
type GitlabFailureDetails = z.infer<typeof gitlabFailureDetailsSchema>;

/** Every GitLab request failure. `details.problem` names the cause. */
export type GitlabRequestError = HostOperationError<GitlabFailureDetails>;

export const gitlabFailure = (
  operation: string,
  problem: GitlabProblem,
  message: string,
  extra: { status?: number | null; retryAfter?: string | null; cause?: unknown } = {},
): GitlabRequestError =>
  new HostOperationError<GitlabFailureDetails>({
    operation: `gitlab.${operation}`,
    message,
    cause: extra.cause,
    details: {
      provider: "gitlab",
      problem,
      status: extra.status ?? null,
      retryAfter: extra.retryAfter ?? null,
    },
  });

/** The GitLab problem of a failure, or null for another failure. */
export const gitlabProblemOf = (error: HostError): GitlabFailureDetails | null =>
  error._tag === "HostOperationError"
    ? (gitlabFailureDetailsSchema.safeParse(error.details).data ?? null)
    : null;

export type GitlabHttpRequest = {
  operation: string;
  /** The instance URL, without `/api/v4`. */
  instanceUrl: string;
  /** A path below the instance URL, such as `/api/v4/user` or `/oauth/token`. */
  path: string;
  method?: "GET" | "POST" | "PUT" | undefined;
  query?:
    | Readonly<Record<string, string | number | boolean | readonly string[] | undefined>>
    | undefined;
  authorization?: string | undefined;
  json?: unknown;
  form?: Readonly<Record<string, string>> | undefined;
};

export type GitlabHttpResponse = {
  status: number;
  headers: Headers;
  body: ArrayBuffer;
};

export type GitlabHttp = {
  /** Sends one request. Every status other than 2xx fails. */
  send(request: GitlabHttpRequest): Effect.Effect<GitlabHttpResponse, GitlabRequestError>;
  /** Sends one request and returns the status and body of a 2xx or 4xx response. */
  sendAllowingClientErrors(
    request: GitlabHttpRequest,
  ): Effect.Effect<GitlabHttpResponse, GitlabRequestError>;
};

const TLS_ERROR_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_HAS_EXPIRED",
  "CERT_UNTRUSTED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

// Node fetch puts the TLS error code in `cause`. Electron net.fetch reports Chromium errors
// such as net::ERR_CERT_AUTHORITY_INVALID in the message.
type FetchFailure = {
  code?: string | undefined;
  message?: string | undefined;
  cause?: FetchFailure | undefined;
};
const fetchFailureSchema: z.ZodType<FetchFailure> = z.lazy(() =>
  z.object({
    code: z.string().optional(),
    message: z.string().optional(),
    cause: fetchFailureSchema.optional().catch(undefined),
  }),
);

const isTlsFailure = (failure: FetchFailure | undefined): boolean =>
  failure !== undefined &&
  (TLS_ERROR_CODES.has(failure.code ?? "") ||
    /ERR_CERT_|certificate/iu.test(failure.message ?? "") ||
    isTlsFailure(failure.cause));

const gitlabRequestUrl = (request: GitlabHttpRequest): URL => {
  const url = new URL(`${request.instanceUrl.replace(/\/+$/u, "")}${request.path}`);
  for (const [name, value] of Object.entries(request.query ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) url.searchParams.append(name, item);
    else url.searchParams.set(name, String(value));
  }
  return url;
};

const retryAfterOf = (headers: Headers): string | null => {
  const retryAfter = headers.get("retry-after");
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
  if (Number.isFinite(seconds)) return new Date(Date.now() + seconds * 1_000).toISOString();
  if (retryAfter !== null && !Number.isNaN(Date.parse(retryAfter)))
    return new Date(Date.parse(retryAfter)).toISOString();
  const reset = Number(headers.get("ratelimit-reset"));
  return Number.isFinite(reset) && reset > 0 ? new Date(reset * 1_000).toISOString() : null;
};

const gitlabErrorBodySchema = z.object({
  message: z.json().optional(),
  error_description: z.string().optional(),
  error: z.string().optional(),
});

/** GitLab errors use `message` (a string or field errors) or the OAuth `error` fields. */
const readErrorText = (body: ArrayBuffer): string => {
  const text = new TextDecoder().decode(body).slice(0, 500);
  const json = parseJsonText(text);
  const plainMessage = z.object({ message: z.string() }).safeParse(json);
  if (plainMessage.success) return plainMessage.data.message;
  const parsed = gitlabErrorBodySchema.safeParse(json);
  if (!parsed.success) return text;
  const { message, error_description: description, error } = parsed.data;
  if (message !== undefined) return JSON.stringify(message);
  return description ?? error ?? text;
};

/** The JSON value of a body, or null when it is not JSON. Callers check it with a schema. */
export const parseJsonText = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export const createGitlabHttp = (fetchImplementation: GitProviderFetch = fetch): GitlabHttp => {
  const send = (request: GitlabHttpRequest, allowClientErrors: boolean) =>
    Effect.gen(function* () {
      const url = gitlabRequestUrl(request);
      const headers = new Headers({ Accept: "application/json" });
      if (request.authorization) headers.set("Authorization", request.authorization);
      let body: string | null = null;
      if (request.json !== undefined) {
        headers.set("Content-Type", "application/json");
        body = JSON.stringify(request.json);
      } else if (request.form) {
        headers.set("Content-Type", "application/x-www-form-urlencoded");
        body = new URLSearchParams(request.form).toString();
      }
      const instance = request.instanceUrl;
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetchImplementation(url, {
            method: request.method ?? "GET",
            headers,
            body,
            // A secret goes only to its own instance, so a redirect never runs.
            redirect: "manual",
            signal,
          }),
        catch: (cause) =>
          isTlsFailure(fetchFailureSchema.safeParse(cause).data)
            ? gitlabFailure(
                request.operation,
                "tls_untrusted",
                `The operating system does not trust the TLS certificate of ${instance}. Add the certificate to the OS trust store, then retry.`,
                { cause },
              )
            : gitlabFailure(
                request.operation,
                "instance_unreachable",
                `${instance} could not be reached: ${cause instanceof Error ? cause.message : String(cause)}. Check the instance URL and the network, then retry.`,
                { cause },
              ),
      }).pipe(
        Effect.timeoutOrElse({
          duration: REQUEST_TIMEOUT,
          orElse: () =>
            Effect.fail(
              gitlabFailure(
                request.operation,
                "instance_unreachable",
                `${instance} did not answer within ${REQUEST_TIMEOUT}. Check the instance URL and the network, then retry.`,
              ),
            ),
        }),
      );
      const responseBody = yield* Effect.tryPromise({
        try: () => response.arrayBuffer(),
        catch: (cause) =>
          gitlabFailure(
            request.operation,
            "instance_unreachable",
            `${instance} returned an unreadable response. Retry.`,
            { cause, status: response.status },
          ),
      });
      const status = response.status;
      if (status >= 200 && status < 300)
        return { status, headers: response.headers, body: responseBody };
      if (status === 0 || (status >= 300 && status < 400))
        return yield* Effect.fail(
          gitlabFailure(
            request.operation,
            "not_gitlab",
            `${instance} answered with a redirect, so it did not answer as a GitLab instance. Check the instance URL.`,
            { status },
          ),
        );
      if (status === 429) {
        const retryAfter = retryAfterOf(response.headers);
        return yield* Effect.fail(
          gitlabFailure(
            request.operation,
            "rate_limited",
            `GitLab limited the request rate. Retry ${retryAfter ? `after ${new Date(retryAfter).toLocaleTimeString()}` : "in a minute"}.`,
            { status, retryAfter },
          ),
        );
      }
      if (allowClientErrors && status >= 400 && status < 500)
        return { status, headers: response.headers, body: responseBody };
      const detail = readErrorText(responseBody);
      if (status === 401)
        return yield* Effect.fail(
          gitlabFailure(
            request.operation,
            "access_revoked",
            `GitLab rejected the credential (HTTP 401${detail ? `: ${detail}` : ""}). Replace the token or sign in again.`,
            { status },
          ),
        );
      if (status === 403 && /insufficient_scope/iu.test(detail))
        return yield* Effect.fail(
          gitlabFailure(
            request.operation,
            "missing_scope",
            "The GitLab token lacks the api scope. Create a token with the api scope.",
            { status },
          ),
        );
      if (status === 403 || status === 404)
        return yield* Effect.fail(
          gitlabFailure(
            request.operation,
            "project_unreachable",
            `GitLab denied ${request.operation} (HTTP ${status}${detail ? `: ${detail}` : ""}). Check that the account can reach the project, or use another account.`,
            { status },
          ),
        );
      return yield* Effect.fail(
        gitlabFailure(
          request.operation,
          "gitlab_error",
          `GitLab answered ${request.operation} with HTTP ${status}${detail ? `: ${detail}` : ""}. Retry. If it keeps failing, check the GitLab status or ask the instance administrator.`,
          { status },
        ),
      );
    });
  return {
    send: (request) => send(request, false),
    sendAllowingClientErrors: (request) => send(request, true),
  };
};

/**
 * Parses a JSON response body with a schema. A body that is not JSON did not come from the
 * GitLab API. JSON of another shape gives `mismatchProblem`.
 */
export const parseGitlabJson = <Schema extends z.ZodType>(
  operation: string,
  response: GitlabHttpResponse,
  schema: Schema,
  mismatchProblem: GitlabProblem = "gitlab_error",
): Effect.Effect<z.output<Schema>, GitlabRequestError> =>
  Effect.gen(function* () {
    const text = new TextDecoder().decode(response.body);
    const json = yield* Effect.try({
      try: () => JSON.parse(text),
      catch: (cause) =>
        gitlabFailure(
          operation,
          "not_gitlab",
          `The server did not answer ${operation} as a GitLab instance. Check the instance URL.`,
          { cause, status: response.status },
        ),
    });
    const parsed = schema.safeParse(json);
    if (!parsed.success)
      return yield* Effect.fail(
        gitlabFailure(
          operation,
          mismatchProblem,
          `GitLab returned a ${operation} response that OpenDucktor cannot read: ${parsed.error.issues[0]?.message ?? "unknown shape"}. Retry. If it keeps failing, check that the instance runs a supported GitLab version.`,
          { status: response.status },
        ),
      );
    return parsed.data;
  });
