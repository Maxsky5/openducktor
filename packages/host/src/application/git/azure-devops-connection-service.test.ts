import { describe, expect, mock, test } from "bun:test";
import { repoConfigSchema, type AzureDevOpsRepository } from "@openducktor/contracts";
import { Effect } from "effect";
import type { AzureDevOpsConnectionPort } from "../../ports/azure-devops-connection-port";
import { createWorkspaceSettingsServiceTestDouble } from "../../test-support/service-test-doubles";
import { createAzureDevOpsConnectionService } from "./azure-devops-connection-service";

describe("AzureDevOpsConnectionService", () => {
  test("rejects credential changes while the provider is disabled", async () => {
    const repository: AzureDevOpsRepository = {
      providerId: "azure_devops",
      deployment: "services",
      serviceUrl: "https://dev.azure.com",
      organization: "OpenDucktor",
      project: "Desktop",
      name: "app",
    };
    const startCloudSignIn = mock(() =>
      Effect.succeed({
        attemptId: "attempt-1",
        verificationUri: "https://microsoft.com/devicelogin",
        userCode: "CODE",
        expiresAt: "2026-09-19T18:00:00Z",
      }),
    );
    const replacePat = mock(() => Effect.void);
    const connection: AzureDevOpsConnectionPort = {
      getAuthorization: () => Effect.dieMessage("unexpected authorization"),
      getState: () => Effect.succeed({ status: "disconnected" }),
      replacePat,
      startCloudSignIn,
      cancelCloudSignIn: () => Effect.void,
      disconnect: () => Effect.void,
    };
    const repoConfig = repoConfigSchema.parse({
      workspaceId: "repo",
      workspaceName: "Repo",
      repoPath: "/repo",
      git: {
        provider: {
          id: "azure_devops",
          enabled: false,
          autoDetected: false,
          repository,
        },
      },
    });
    const service = createAzureDevOpsConnectionService({
      connection,
      workspaceSettingsService: createWorkspaceSettingsServiceTestDouble({
        getRepoConfigByRepoPath: () => Effect.succeed(repoConfig),
      }),
    });

    await expect(
      Effect.runPromise(service.startSignIn({ repoPath: "/repo", repository })),
    ).rejects.toThrow("not enabled");
    await expect(
      Effect.runPromise(service.replacePat({ repoPath: "/repo", repository, pat: "secret" })),
    ).rejects.toThrow("not enabled");
    expect(startCloudSignIn).not.toHaveBeenCalled();
    expect(replacePat).not.toHaveBeenCalled();
  });
});
