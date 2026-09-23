import { Effect } from "effect";
import { z } from "zod";
import { HostOperationError, toHostOperationError } from "../../../effect/host-errors";
import type { AzureDevOpsProtectedStorage } from "./protected-storage";

const storedConnectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("server_pat"), pat: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal("cloud"),
      homeAccountId: z.string().min(1),
      account: z.string().nullable(),
    })
    .strict(),
]);

export type StoredConnection = z.infer<typeof storedConnectionSchema>;

export const loadConnection = (protectedStorage: AzureDevOpsProtectedStorage, scope: string) =>
  Effect.gen(function* () {
    const store = yield* protectedStorage.open(scope, "connection");
    const payload = yield* Effect.tryPromise({
      try: () => store.load(),
      catch: (cause) => toHostOperationError(cause, "azureDevOps.connection.load"),
    });
    if (payload === null) {
      return null;
    }
    return yield* Effect.try({
      try: () => storedConnectionSchema.parse(JSON.parse(payload)),
      catch: (cause) =>
        new HostOperationError({
          operation: "azureDevOps.connection.decode",
          message:
            "The protected Azure DevOps connection record is invalid. Disconnect it and sign in again.",
          cause,
        }),
    });
  });

export const saveConnection = (
  protectedStorage: AzureDevOpsProtectedStorage,
  scope: string,
  connection: StoredConnection,
) =>
  Effect.gen(function* () {
    const store = yield* protectedStorage.open(scope, "connection");
    yield* Effect.tryPromise({
      try: () => store.save(JSON.stringify(connection)),
      catch: (cause) => toHostOperationError(cause, "azureDevOps.connection.save"),
    });
  });
