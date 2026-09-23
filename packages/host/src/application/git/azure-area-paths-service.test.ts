import { describe, expect, test } from "bun:test";
import {
  AZURE_DEVOPS_PROVIDER_DESCRIPTOR,
  GITHUB_PROVIDER_DESCRIPTOR,
  repoConfigSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { GitProviderPort } from "../../ports/git-provider-port";
import type { GitProviderResolver } from "./git-provider-resolver";
import { createAzureAreaPathsService } from "./azure-area-paths-service";

const repoConfig = repoConfigSchema.parse({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
});

const fixture = (providerId: "github" | "azure_devops") => {
  const paths: string[] = [];
  // SAFETY: The service reads only getDescriptor after the resolver returns this test provider.
  const provider = {
    getDescriptor: () =>
      providerId === "azure_devops" ? AZURE_DEVOPS_PROVIDER_DESCRIPTOR : GITHUB_PROVIDER_DESCRIPTOR,
  } as GitProviderPort;
  const resolver: GitProviderResolver = {
    resolve: () => Effect.succeed(provider),
    resolveConfigured: () => Effect.succeed(provider),
  };
  const service = createAzureAreaPathsService({
    resolver,
    areaPaths: {
      list: () =>
        Effect.sync(() => {
          paths.push("read");
          return ["Project\\Team"];
        }),
    },
    workspaceSettingsService: { getRepoConfigByRepoPath: () => Effect.succeed(repoConfig) },
  });
  return { service, paths };
};

describe("Azure area paths service", () => {
  test("reads areas for Azure DevOps", async () => {
    const { service, paths } = fixture("azure_devops");
    expect(await Effect.runPromise(service.list("/repo"))).toEqual(["Project\\Team"]);
    expect(paths).toEqual(["read"]);
  });

  test("rejects another provider before reading areas", async () => {
    const { service, paths } = fixture("github");
    await expect(Effect.runPromise(service.list("/repo"))).rejects.toThrow("Choose Azure DevOps");
    expect(paths).toEqual([]);
  });
});
