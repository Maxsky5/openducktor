import path from "node:path";
import { Effect } from "effect";
import { z } from "zod";
import {
  HostOperationError,
  type HostOperationErrorAggregate,
  toHostOperationError,
} from "../../../effect/host-errors";
import { openOsSecurePersistence } from "../os-secure-store";

const SERVICE_NAME = "OpenDucktor GitLab";

const gitlabSecretSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("token"), token: z.string().min(1) }),
  z.strictObject({
    kind: z.literal("oauth"),
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    accessTokenExpiresAt: z.string().min(1),
  }),
]);
export type GitlabSecret = z.infer<typeof gitlabSecretSchema>;

/** Decodes a stored credential. An invalid one asks the user for a new credential. */
export const decodeGitlabSecret = (payload: string) =>
  Effect.try({
    try: () => gitlabSecretSchema.parse(JSON.parse(payload)),
    catch: (cause) =>
      new HostOperationError({
        operation: "gitlab.secretStore.decode",
        message: "The saved GitLab credential is invalid. Replace the token or sign in again.",
        cause,
      }),
  });

/** One OS secure store record for each saved GitLab account, keyed by the account ID. */
export type GitlabSecretStore = {
  read(accountId: string): Effect.Effect<GitlabSecret | null, HostOperationErrorAggregate>;
  save(accountId: string, secret: GitlabSecret): Effect.Effect<void, HostOperationErrorAggregate>;
  delete(accountId: string): Effect.Effect<void, HostOperationErrorAggregate>;
  /** The stored text as it is, so a rollback works also for a credential that does not decode. */
  snapshot(accountId: string): Effect.Effect<string | null, HostOperationErrorAggregate>;
  /** Writes a snapshot back. A null snapshot deletes the record. */
  restore(
    accountId: string,
    snapshot: string | null,
  ): Effect.Effect<void, HostOperationErrorAggregate>;
};

export const createGitlabSecretStore = ({
  configDir,
}: {
  configDir: string;
}): GitlabSecretStore => {
  const directory = path.join(configDir, "credentials", "gitlab");
  const open = (accountId: string) =>
    Effect.tryPromise({
      try: () =>
        openOsSecurePersistence({
          cachePath: path.join(directory, `${accountId}.cache`),
          serviceName: SERVICE_NAME,
          accountName: accountId,
          providerLabel: "GitLab",
        }),
      catch: (cause) =>
        toHostOperationError(cause, "gitlab.secretStore.open", {
          message: "The operating system secure credential store is unavailable.",
        }),
    });
  const snapshot = (accountId: string) =>
    Effect.gen(function* () {
      const store = yield* open(accountId);
      return yield* Effect.tryPromise({
        try: () => store.load(),
        catch: (cause) => toHostOperationError(cause, "gitlab.secretStore.read"),
      });
    });
  const write = (accountId: string, payload: string) =>
    Effect.gen(function* () {
      const store = yield* open(accountId);
      yield* Effect.tryPromise({
        try: () => store.save(payload),
        catch: (cause) => toHostOperationError(cause, "gitlab.secretStore.save"),
      });
    });
  const remove = (accountId: string) =>
    Effect.gen(function* () {
      const store = yield* open(accountId);
      yield* Effect.tryPromise({
        try: () => store.delete(),
        catch: (cause) => toHostOperationError(cause, "gitlab.secretStore.delete"),
      });
    });
  return {
    read: (accountId) =>
      snapshot(accountId).pipe(
        Effect.flatMap((payload) =>
          payload === null ? Effect.succeed(null) : decodeGitlabSecret(payload),
        ),
      ),
    save: (accountId, secret) => write(accountId, JSON.stringify(secret)),
    delete: remove,
    snapshot,
    restore: (accountId, payload) =>
      payload === null ? remove(accountId) : write(accountId, payload),
  };
};
