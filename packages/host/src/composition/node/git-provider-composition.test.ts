import { expect, test } from "bun:test";
import { GITHUB_PROVIDER_DESCRIPTOR, repoConfigSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { createGitPortTestDouble } from "../../test-support/service-test-doubles";
import { createNodeGitProviderResolver } from "./git-provider-composition";

test("node composition registers the GitHub provider", async () => {
  const systemCommands: SystemCommandPort = {
    resolveCommandPath: () => Effect.die("Unexpected resolveCommandPath call"),
    versionCommand: () => Effect.die("Unexpected versionCommand call"),
    runCommandAllowFailure: () => Effect.die("Unexpected runCommandAllowFailure call"),
  };
  const toolDiscovery: ToolDiscoveryPort = {
    discoverTool: () => Effect.die("Unexpected discoverTool call"),
    resolveTool: () => Effect.die("Unexpected resolveTool call"),
    resolveToolPath: () => Effect.die("Unexpected resolveToolPath call"),
    validateToolPath: () => Effect.die("Unexpected validateToolPath call"),
  };
  const resolver = await Effect.runPromise(
    createNodeGitProviderResolver({
      gitPort: createGitPortTestDouble({}),
      systemCommands,
      toolDiscovery,
    }),
  );
  const repoConfig = repoConfigSchema.parse({
    workspaceId: "repo",
    workspaceName: "Repo",
    repoPath: "/repo",
    defaultRuntimeKind: "opencode",
    git: { provider: { id: "github", enabled: true } },
  });

  const resolved = await Effect.runPromise(resolver.resolve(repoConfig));

  expect(resolved.getDescriptor()).toBe(GITHUB_PROVIDER_DESCRIPTOR);
});
