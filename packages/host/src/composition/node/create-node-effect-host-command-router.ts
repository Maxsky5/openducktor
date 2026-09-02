import { Effect } from "effect";
import { toHostOperationError } from "../../effect/host-errors";
import { assembleNodeEffectHostCommandRouter } from "./create-node-host-command-router";
import { createNodeGitProviderResolver } from "./git-provider-composition";
import { createNodeHostDefaultPorts } from "./node-host-default-ports";
import type { CreateNodeHostCommandRouterInput } from "./node-host-command-router-types";

export const createNodeEffectHostCommandRouter = (input: CreateNodeHostCommandRouterInput) =>
  Effect.gen(function* () {
    const defaultPorts = yield* Effect.try({
      try: () => createNodeHostDefaultPorts(input),
      catch: (cause) => toHostOperationError(cause, "host.create-router"),
    });
    const { git, systemCommands, toolDiscovery } = defaultPorts;
    const resolver = yield* createNodeGitProviderResolver({
      gitPort: git,
      systemCommands,
      toolDiscovery,
    });
    return yield* Effect.try({
      try: () => assembleNodeEffectHostCommandRouter(input, defaultPorts, resolver),
      catch: (cause) => toHostOperationError(cause, "host.create-router"),
    });
  });
