import { PublicClientApplication } from "@azure/msal-node";
import { Effect } from "effect";
import { type HostError, toHostOperationError } from "../../../effect/host-errors";
import type { AzureDevOpsProtectedStorage } from "./protected-storage";

const AUTHORITY = "https://login.microsoftonline.com/common";

export type AzureDevOpsPublicClient = Pick<
  PublicClientApplication,
  "acquireTokenByDeviceCode" | "acquireTokenSilent" | "getAllAccounts"
>;

export type AzureDevOpsPublicClientFactory = (
  clientId: string,
  protectedStorage: AzureDevOpsProtectedStorage,
  scope: string,
) => Effect.Effect<AzureDevOpsPublicClient, HostError>;

export const createAzureDevOpsPublicClient: AzureDevOpsPublicClientFactory = (
  clientId,
  protectedStorage,
  scope,
) =>
  Effect.gen(function* () {
    const persistence = yield* protectedStorage.open(scope, "msal");
    const { PersistenceCachePlugin } = yield* Effect.tryPromise({
      try: () => import("@azure/msal-node-extensions"),
      catch: (cause) => toHostOperationError(cause, "azureDevOps.connection.loadMsalPersistence"),
    });
    return new PublicClientApplication({
      auth: { clientId, authority: AUTHORITY },
      cache: {
        cachePlugin: new PersistenceCachePlugin(persistence),
      },
    });
  });
