import { expect, test } from "bun:test";
import { GITHUB_PROVIDER_DESCRIPTOR, repoConfigSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { resolveAzureDevOpsEntraClientId } from "../../config/azure-devops";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { createGitPortTestDouble } from "../../test-support/service-test-doubles";
import { createNodeGitProviderComposition } from "./git-provider-composition";

test("node composition uses the product Azure DevOps Entra client ID by default", () => {
  expect(resolveAzureDevOpsEntraClientId({})).toBe("bac43573-dc2b-4b13-b536-8ea09b9c8816");
});

test("node composition accepts an Azure DevOps Entra client ID development override", () => {
  expect(
    resolveAzureDevOpsEntraClientId({
      OPENDUCKTOR_AZURE_DEVOPS_CLIENT_ID: " development-client-id ",
    }),
  ).toBe("development-client-id");
});

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
  const { resolver } = await Effect.runPromise(
    createNodeGitProviderComposition({
      configDir: "/tmp/openducktor-git-provider-test",
      gitPort: createGitPortTestDouble({}),
      processEnv: {},
      systemCommands,
      toolDiscovery,
    }),
  );
  const repoConfig = repoConfigSchema.parse({
    workspaceId: "repo",
    workspaceName: "Repo",
    repoPath: "/repo",
    git: { provider: { id: "github", enabled: true } },
  });

  const resolved = await Effect.runPromise(resolver.resolve(repoConfig));

  expect(resolved.getDescriptor()).toBe(GITHUB_PROVIDER_DESCRIPTOR);
});
