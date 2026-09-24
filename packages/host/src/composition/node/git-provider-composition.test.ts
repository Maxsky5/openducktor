import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "bun:test";
import { GITHUB_PROVIDER_DESCRIPTOR, repoConfigSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { createGitProviderService } from "../../application/git/git-provider-service";
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

test("node composition leaves Azure storage untouched without an Azure repository", async () => {
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
  const configDir = await mkdtemp(path.join(tmpdir(), "openducktor-git-provider-"));
  try {
    const { resolver } = await Effect.runPromise(
      createNodeGitProviderComposition({
        configDir,
        gitPort: createGitPortTestDouble({}),
        processEnv: {},
        systemCommands,
        toolDiscovery,
      }),
    );
    const githubConfig = repoConfigSchema.parse({
      workspaceId: "repo",
      workspaceName: "Repo",
      repoPath: "/repo",
      git: { provider: { id: "github", enabled: true } },
    });
    const noProviderConfig = repoConfigSchema.parse({
      ...githubConfig,
      git: {},
    });
    const service = createGitProviderService({
      resolver,
      workspaceSettingsService: {
        getRepoConfigByRepoPath: () => Effect.succeed(noProviderConfig),
      },
    });

    expect((await Effect.runPromise(resolver.resolve(githubConfig))).getDescriptor()).toBe(
      GITHUB_PROVIDER_DESCRIPTOR,
    );
    await expect(
      Effect.runPromise(service.getContext(noProviderConfig.repoPath)),
    ).resolves.toBeNull();
    await expect(stat(path.join(configDir, "credentials", "azure-devops"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});
