import { type AzureDevOpsRepository, type RepoConfig } from "@openducktor/contracts";
import { Effect } from "effect";
import { type HostError, HostOperationError } from "../../../effect/host-errors";
import type { AzureDevOpsConnectionPort } from "../../../ports/azure-devops-connection-port";
import { azureDevOpsJsonListSchema, azureDevOpsJsonSchema, type AzureDevOpsJson } from "./json";
import { azureDevOpsCollectionUrl } from "./repository-identity";

const REQUEST_TIMEOUT = "30 seconds";

export type AzureDevOpsRequest = {
  operation: string;
  path: string;
  apiVersion?: string;
  method?: "GET" | "POST" | "PATCH";
  query?: Readonly<Record<string, string | number | boolean | undefined>>;
  body?: AzureDevOpsJson;
};

export type AzureDevOpsResponse = {
  body: AzureDevOpsJson;
  continuationToken: string | null;
};

export type AzureDevOpsRestClient = {
  request(
    repoConfig: RepoConfig,
    repository: AzureDevOpsRepository,
    request: AzureDevOpsRequest,
  ): Effect.Effect<AzureDevOpsResponse, HostError>;
  readContinuationPages(
    repoConfig: RepoConfig,
    repository: AzureDevOpsRepository,
    request: AzureDevOpsRequest,
  ): Effect.Effect<AzureDevOpsJson[], HostError>;
  readOffsetPages(
    repoConfig: RepoConfig,
    repository: AzureDevOpsRepository,
    request: AzureDevOpsRequest,
  ): Effect.Effect<AzureDevOpsJson[], HostError>;
};

export const createAzureDevOpsRestClient = ({
  connection,
  fetchImplementation = fetch,
}: {
  connection: AzureDevOpsConnectionPort;
  fetchImplementation?: typeof fetch;
}): AzureDevOpsRestClient => {
  const request: AzureDevOpsRestClient["request"] = (repoConfig, repository, input) =>
    Effect.gen(function* () {
      const authorization = yield* connection.getAuthorization(repoConfig, repository);
      const url = buildApiUrl(repository, input);
      const headers = {
        Accept: "application/json",
        Authorization: authorization.headerValue,
      };
      const requestInit: RequestInit = {
        method: input.method ?? "GET",
        redirect: "manual",
        headers,
      };
      if (input.body !== undefined) {
        requestInit.headers = { ...headers, "Content-Type": "application/json" };
        requestInit.body = JSON.stringify(input.body);
      }
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetchImplementation(url, {
            ...requestInit,
            signal,
          }),
        catch: (cause) =>
          new HostOperationError({
            operation: input.operation,
            message: `Azure DevOps ${input.operation} failed before the server returned a response. Check the server address, network, and TLS certificate.`,
            cause,
          }),
      }).pipe(
        Effect.timeoutFail({
          duration: REQUEST_TIMEOUT,
          onTimeout: () =>
            new HostOperationError({
              operation: input.operation,
              message: `Azure DevOps ${input.operation} timed out after ${REQUEST_TIMEOUT}. Check the server address and network.`,
            }),
        }),
      );
      if (response.status >= 300 && response.status < 400) {
        return yield* Effect.fail(
          new HostOperationError({
            operation: input.operation,
            message: `Azure DevOps ${input.operation} returned an unexpected redirect. Check the configured service address.`,
            details: { status: response.status },
          }),
        );
      }
      if (!response.ok) {
        const detail = (yield* readErrorDetail(response)).slice(0, 1_000);
        const guidance = failureGuidance(response.status);
        return yield* Effect.fail(
          new HostOperationError({
            operation: input.operation,
            message: `Azure DevOps ${input.operation} failed with HTTP ${response.status}. ${guidance}${detail ? ` Server response: ${detail}` : ""}`,
            details: { status: response.status },
          }),
        );
      }
      const text = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: (cause) =>
          new HostOperationError({
            operation: input.operation,
            message: `Azure DevOps ${input.operation} returned an unreadable response.`,
            cause,
          }),
      });
      const body: AzureDevOpsJson = text
        ? yield* Effect.try({
            try: () => azureDevOpsJsonSchema.parse(JSON.parse(text)),
            catch: (cause) =>
              new HostOperationError({
                operation: input.operation,
                message: `Azure DevOps ${input.operation} returned invalid JSON.`,
                cause,
              }),
          })
        : null;
      return {
        body,
        continuationToken: response.headers.get("x-ms-continuationtoken"),
      };
    });

  return {
    request,
    readContinuationPages(repoConfig, repository, input) {
      return Effect.gen(function* () {
        const values: AzureDevOpsJson[] = [];
        let continuationToken: string | undefined;
        do {
          const response = yield* request(repoConfig, repository, {
            ...input,
            query: { ...input.query, continuationToken },
          });
          values.push(...(yield* readList(response.body, input.operation)));
          continuationToken = response.continuationToken ?? undefined;
        } while (continuationToken !== undefined);
        return values;
      });
    },
    readOffsetPages(repoConfig, repository, input) {
      return Effect.gen(function* () {
        const values: AzureDevOpsJson[] = [];
        const pageSize = 100;
        let offset = 0;
        while (true) {
          const response = yield* request(repoConfig, repository, {
            ...input,
            query: { ...input.query, $top: pageSize, $skip: offset },
          });
          const page = yield* readList(response.body, input.operation);
          values.push(...page);
          if (page.length < pageSize) {
            return values;
          }
          offset += page.length;
        }
      });
    },
  };
};

const buildApiUrl = (repository: AzureDevOpsRepository, request: AzureDevOpsRequest): string => {
  const base = `${azureDevOpsCollectionUrl(repository)}/${encodeURIComponent(repository.project)}`;
  const url = new URL(`${base}/_apis/${request.path.replace(/^\/+|\/+$/gu, "")}`);
  url.searchParams.set("api-version", request.apiVersion ?? "7.0");
  for (const [name, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(name, String(value));
    }
  }
  return url.toString();
};

const readList = (body: AzureDevOpsJson, operation: string) => {
  const parsed = azureDevOpsJsonListSchema.safeParse(body);
  return parsed.success
    ? Effect.succeed(parsed.data.value)
    : Effect.fail(
        new HostOperationError({
          operation,
          message: `Azure DevOps ${operation} returned a malformed list response.`,
        }),
      );
};

const readErrorDetail = (response: Response) =>
  Effect.tryPromise({
    try: () => response.text(),
    catch: () => new HostOperationError({ operation: "azureDevOps.readError", message: "" }),
  }).pipe(Effect.catchAll(() => Effect.succeed("")));

const failureGuidance = (status: number): string => {
  if (status === 401) {
    return "The credential was rejected or expired. Sign in again or replace the PAT.";
  }
  if (status === 403) {
    return "The account lacks permission for this operation. Check repository, build, and policy access.";
  }
  if (status === 404) {
    return "The repository is missing or inaccessible to this account.";
  }
  return "Check the configured Azure DevOps address and Server 2022 compatibility.";
};
