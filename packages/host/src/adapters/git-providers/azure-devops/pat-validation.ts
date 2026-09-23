import type { AzureDevOpsRepository } from "@openducktor/contracts";
import { azureDevOpsCollectionUrl } from "@openducktor/core";
import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../../effect/host-errors";
import { azureDevOpsJsonSchema } from "./json";
import { parseAzureRepository } from "./models";

const REQUEST_TIMEOUT = "30 seconds";

export const validatePat = (
  fetchImplementation: typeof fetch,
  repository: AzureDevOpsRepository,
  pat: string,
) =>
  Effect.gen(function* () {
    const base = `${azureDevOpsCollectionUrl(repository)}/${encodeURIComponent(repository.project)}`;
    const url = new URL(`${base}/_apis/git/repositories/${encodeURIComponent(repository.name)}`);
    url.searchParams.set("api-version", "7.0");
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetchImplementation(url, {
          redirect: "manual",
          signal,
          headers: {
            Accept: "application/json",
            Authorization: `Basic ${Buffer.from(`:${pat}`).toString("base64")}`,
          },
        }),
      catch: (cause) =>
        new HostOperationError({
          operation: "azureDevOps.connection.validatePat",
          message:
            "Azure DevOps PAT validation failed before the service returned a response. Check the service address, network, and TLS certificate.",
          cause,
        }),
    }).pipe(
      Effect.timeoutFail({
        duration: REQUEST_TIMEOUT,
        onTimeout: () =>
          new HostOperationError({
            operation: "azureDevOps.connection.validatePat",
            message: `Azure DevOps PAT validation timed out after ${REQUEST_TIMEOUT}. Check the service address and network. The prior connection remains active.`,
          }),
      }),
    );
    if (response.status >= 300 && response.status < 400) {
      return yield* Effect.fail(
        new HostOperationError({
          operation: "azureDevOps.connection.validatePat",
          message:
            "Azure DevOps PAT validation returned an unexpected redirect. Check the configured service address.",
          details: { status: response.status },
        }),
      );
    }
    if (!response.ok) {
      return yield* Effect.fail(
        new HostOperationError({
          operation: "azureDevOps.connection.validatePat",
          message: `Azure DevOps rejected the replacement PAT with HTTP ${response.status}. The prior connection remains active.`,
          details: { status: response.status },
        }),
      );
    }
    const body = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) =>
        new HostOperationError({
          operation: "azureDevOps.connection.validatePat",
          message:
            "Azure DevOps did not return repository details. Check the service address. The prior connection remains active.",
          cause,
        }),
    });
    yield* Effect.try({
      try: () => parseAzureRepository(azureDevOpsJsonSchema.parse(body), repository),
      catch: (cause) =>
        cause instanceof HostValidationError
          ? cause
          : new HostOperationError({
              operation: "azureDevOps.connection.validatePat",
              message:
                "Azure DevOps returned invalid repository details. Check the service address. The prior connection remains active.",
              cause,
            }),
    });
  });
