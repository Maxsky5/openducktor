import { randomUUID } from "node:crypto";
import {
  loadOpencodeModelCatalogFromConnection,
  type OpenCodeRuntimeConnection,
} from "@openducktor/adapters-opencode-sdk";
import type { AgentModelCatalog } from "@openducktor/core";
import { Cause, Effect, Exit } from "effect";
import { resolveSavedRuntimeExecutableConfig } from "../../application/runtimes/saved-runtime-executable";
import { HostOperationError, toHostOperationError } from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import {
  acquireOpenCodeStandalone,
  type OpenCodeStandaloneOptions,
} from "./opencode-standalone-process";

export const createOpenCodeModelCatalogPreview =
  (
    options: OpenCodeStandaloneOptions & {
      settingsConfig: SettingsConfigPort;
      toolDiscovery: ToolDiscoveryPort;
      readModelCatalog?: (
        repoPath: string,
        connection: OpenCodeRuntimeConnection,
      ) => Promise<AgentModelCatalog>;
      readTimeoutMs?: number;
    },
  ) =>
  (repoPath: string) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const { executablePath } = yield* resolveSavedRuntimeExecutableConfig({
          kind: "opencode",
          settingsConfig: options.settingsConfig,
          toolDiscovery: options.toolDiscovery,
        });
        const owned = yield* acquireOpenCodeStandalone({
          ...options,
          executablePath,
          workingDirectory: repoPath,
          runtimeId: randomUUID(),
        });
        const read = yield* Effect.exit(
          restore(
            Effect.gen(function* () {
              const connection = yield* owned.waitReady;
              return yield* Effect.tryPromise({
                try: () =>
                  (options.readModelCatalog ?? loadOpencodeModelCatalogFromConnection)(
                    repoPath,
                    connection,
                  ),
                catch: (cause) => toHostOperationError(cause, "opencodeModelCatalogPreview.read"),
              }).pipe(
                Effect.timeoutOrElse({
                  duration: `${options.readTimeoutMs ?? 30_000} millis`,
                  orElse: () =>
                    Effect.fail(
                      new HostOperationError({
                        operation: "opencodeModelCatalogPreview.read",
                        message: "OpenCode did not return its model catalog. Retry the model list.",
                      }),
                    ),
                }),
              );
            }),
          ),
        );
        const cleanup = yield* Effect.exit(owned.stop);
        if (Exit.isFailure(cleanup))
          return yield* new HostOperationError({
            operation: "opencodeModelCatalogPreview.cleanup",
            message: `${Exit.isFailure(read) ? Cause.pretty(read.cause) + "\n" : ""}Cleanup failed: ${Cause.pretty(cleanup.cause)}`,
          });
        return yield* Exit.isFailure(read)
          ? Effect.failCause(read.cause)
          : Effect.succeed(read.value);
      }),
    );
