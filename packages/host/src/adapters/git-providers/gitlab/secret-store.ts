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

/** One OS secure store record for each saved GitLab account, keyed by the account ID. */
export type GitlabSecretStore = {
  read(accountId: string): Effect.Effect<GitlabSecret | null, HostOperationErrorAggregate>;
  save(accountId: string, secret: GitlabSecret): Effect.Effect<void, HostOperationErrorAggregate>;
  delete(accountId: string): Effect.Effect<void, HostOperationErrorAggregate>;
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
  return {
    read: (accountId) =>
      Effect.gen(function* () {
        const store = yield* open(accountId);
        const payload = yield* Effect.tryPromise({
          try: () => store.load(),
          catch: (cause) => toHostOperationError(cause, "gitlab.secretStore.read"),
        });
        if (payload === null) return null;
        return yield* Effect.try({
          try: () => gitlabSecretSchema.parse(JSON.parse(payload)),
          catch: (cause) =>
            new HostOperationError({
              operation: "gitlab.secretStore.decode",
              message:
                "The saved GitLab credential is invalid. Replace the token or sign in again.",
              cause,
            }),
        });
      }),
    save: (accountId, secret) =>
      Effect.gen(function* () {
        const store = yield* open(accountId);
        yield* Effect.tryPromise({
          try: () => store.save(JSON.stringify(secret)),
          catch: (cause) => toHostOperationError(cause, "gitlab.secretStore.save"),
        });
      }),
    delete: (accountId) =>
      Effect.gen(function* () {
        const store = yield* open(accountId);
        yield* Effect.tryPromise({
          try: () => store.delete(),
          catch: (cause) => toHostOperationError(cause, "gitlab.secretStore.delete"),
        });
      }),
  };
};
