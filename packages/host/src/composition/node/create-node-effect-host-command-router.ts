import { Effect } from "effect";
import { createGeneratedImageWorkers } from "../../adapters/attachments/generated-image-worker-client";
import { toHostOperationError } from "../../effect/host-errors";
import { assembleNodeEffectHostCommandRouter } from "./create-node-host-command-router";
import { createNodeGitProviderComposition } from "./git-provider-composition";
import { createNodeHostDefaultPorts } from "./node-host-default-ports";
import type { CreateNodeHostCommandRouterInput } from "./node-host-command-router-types";

export const createNodeEffectHostCommandRouter = (input: CreateNodeHostCommandRouterInput) =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const imageWorkers = yield* createGeneratedImageWorkers(input.onBackgroundFailure);
      return yield* restore(
        Effect.gen(function* () {
          const defaultPorts = yield* createNodeHostDefaultPorts(input, imageWorkers).pipe(
            Effect.mapError((cause) => toHostOperationError(cause, "host.create-router")),
          );
          const { configDir, git, processEnvironment, systemCommands, toolDiscovery } =
            defaultPorts;
          const gitProviders = yield* createNodeGitProviderComposition({
            azureDevOpsFetch: input.azureDevOpsFetch,
            configDir: configDir.root,
            gitPort: git,
            processEnv: processEnvironment.environment,
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
        }),
      ).pipe(Effect.onError(() => imageWorkers.shutdown.pipe(Effect.orDie)));
    }),
  );
