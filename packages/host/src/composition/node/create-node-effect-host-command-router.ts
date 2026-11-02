import { Effect } from "effect";
import { createGeneratedImageWorkers } from "../../adapters/attachments/generated-image-worker-client";
import { toHostOperationError } from "../../effect/host-errors";
import { assembleNodeEffectHostCommandRouter } from "./create-node-host-command-router";
import { createNodeGitProviderComposition } from "./git-provider-composition";
import { createNodeHostDefaultPorts } from "./node-host-default-ports";
import type { CreateNodeHostCommandRouterInput } from "./node-host-command-router-types";
import { createNodeSharedStorage } from "./node-shared-storage";
import { builtinTaskWorkflowResolver } from "./task-workflow-composition";

export const createNodeEffectHostCommandRouter = (input: CreateNodeHostCommandRouterInput) =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const imageWorkers = yield* createGeneratedImageWorkers(input.onBackgroundFailure);
      return yield* restore(
        Effect.gen(function* () {
          const ports = yield* createNodeHostDefaultPorts(input, imageWorkers).pipe(
            Effect.mapError((cause) => toHostOperationError(cause, "host.create-router")),
          );
          const defaultPorts = yield* createNodeSharedStorage(
            ports,
            input.taskWorkflows ?? builtinTaskWorkflowResolver,
            input.onHostDatabaseImport,
          );
          return yield* Effect.gen(function* () {
            const { configDir, git, startupEnv, systemCommands, toolDiscovery } = defaultPorts;
            const gitProviders = yield* createNodeGitProviderComposition({
              azureDevOpsFetch: input.azureDevOpsFetch,
              configDir: configDir.root,
              gitPort: git,
              processEnv: startupEnv,
              eventBus: input.eventBus,
              systemCommands,
              toolDiscovery,
            });
            return yield* Effect.try({
              try: () =>
                assembleNodeEffectHostCommandRouter(
                  input,
                  defaultPorts,
                  gitProviders.resolver,
                  gitProviders.azureDevOpsConnection,
                  gitProviders.azureAreaPaths,
                ),
              catch: (cause) => toHostOperationError(cause, "host.create-router"),
            });
          }).pipe(Effect.onError(() => defaultPorts.taskDatabase.dispose().pipe(Effect.orDie)));
        }),
      ).pipe(Effect.onError(() => imageWorkers.shutdown.pipe(Effect.orDie)));
    }),
  );
