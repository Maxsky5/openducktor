import { Effect } from "effect";
import type { GithubCommandDependencies } from "../../../application/tasks/support/github-pull-requests";
import type { SystemCommandPort } from "../../../ports/system-command-port";
import type { ToolDiscoveryPort } from "../../../ports/tool-discovery-port";

const unexpectedCall = (operation: string): Effect.Effect<never, never> =>
  Effect.die(`Unexpected ${operation} call`);

export const createGithubReviewTestDependencies = (
  runCommandAllowFailure: SystemCommandPort["runCommandAllowFailure"],
): GithubCommandDependencies => {
  const systemCommands: SystemCommandPort = {
    resolveCommandPath: () => unexpectedCall("resolveCommandPath"),
    versionCommand: () => unexpectedCall("versionCommand"),
    runCommandAllowFailure,
  };
  const toolDiscovery: ToolDiscoveryPort = {
    discoverTool: () => unexpectedCall("discoverTool"),
    resolveTool: () => unexpectedCall("resolveTool"),
    resolveToolPath: () => unexpectedCall("resolveToolPath"),
    validateToolPath: () => unexpectedCall("validateToolPath"),
  };

  return {
    resolveGithubCommand: () => Effect.succeed({ ghCommand: "gh", systemCommands }),
    systemCommands,
    toolDiscovery,
  };
};
