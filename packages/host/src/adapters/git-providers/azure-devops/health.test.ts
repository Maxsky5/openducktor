import { describe, expect, test } from "bun:test";
import {
  azureDevOpsRepositorySchema,
  repoConfigSchema,
  type AzureDevOpsRepository,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { AzureDevOpsConnectionPort } from "../../../ports/azure-devops-connection-port";
import type { GitProviderRepositoryPort } from "../../../ports/git-provider-port";
import { createAzureDevOpsHealthPort } from "./health";
import { createAzureDevOpsRestClient } from "./rest-client";

const repository = azureDevOpsRepositorySchema.parse({
  providerId: "azure_devops",
  deployment: "services",
  serviceUrl: "https://dev.azure.com",
  organization: "example",
  project: "app",
  name: "app",
});
const repoConfig = repoConfigSchema.parse({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  git: { provider: { id: "azure_devops", enabled: true, repository } },
});
const connection: AzureDevOpsConnectionPort = {
  shutdown: () => Effect.void,
  getAuthorization: () => Effect.succeed({ headerValue: "Bearer secret", account: "user" }),
  getState: () => Effect.succeed({ status: "connected", account: "user" }),
  replacePat: () => Effect.void,
  startCloudSignIn: () => Effect.die("unexpected sign-in"),
  cancelCloudSignIn: () => Effect.void,
  disconnect: () => Effect.void,
};
const repositoryPort: GitProviderRepositoryPort<AzureDevOpsRepository> = {
  detectRepository: () => Effect.die("unexpected repository detection"),
  getRepository: () => Effect.die("unexpected repository read"),
  getMapping: () => Effect.die("unexpected repository mapping"),
};

describe("Azure DevOps health", () => {
  test.each([
    [401, false],
    [403, true],
  ])("reports HTTP %p with authenticated=%p", async (status, authenticated) => {
    const client = createAzureDevOpsRestClient({
      connection,
      fetchImplementation: Object.assign(async () => new Response(null, { status }), {
        preconnect: fetch.preconnect,
      }),
    });
    const health = await Effect.runPromise(
      createAzureDevOpsHealthPort({ client, connection, repositoryPort }).getStatus(repoConfig),
    );

    expect(health.available).toBe(false);
    expect(health.authenticated).toBe(authenticated);
    expect(health.reason).toContain(`HTTP ${status}`);
  });
});
