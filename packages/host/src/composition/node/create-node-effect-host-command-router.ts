import { Effect } from "effect";
import {
  createGithubCliAdapter,
  createGithubCommandResolver,
} from "../../adapters/git-providers/github-cli";
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
    const githubCli = createGithubCliAdapter(systemCommands);
    const githubCommands = createGithubCommandResolver({ githubCli, toolDiscovery });
    const resolver = yield* createNodeGitProviderResolver({
      gitPort: git,
      githubCommands,
    });
    return yield* Effect.try({
      try: () =>
        assembleNodeEffectHostCommandRouter(input, defaultPorts, resolver, {
          githubCli,
          githubCommands,
        }),
      catch: (cause) => toHostOperationError(cause, "host.create-router"),
    });
  });
