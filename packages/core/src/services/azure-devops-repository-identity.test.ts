import { describe, expect, test } from "bun:test";
import type { AzureDevOpsRepository } from "@openducktor/contracts";
import {
  azureDevOpsCollectionUrl,
  azureDevOpsConnectionConfigurationFingerprint,
  azureDevOpsRepositoryKey,
  azureDevOpsResolvedRepositoryIdentity,
  canonicalAzureDevOpsServiceUrl,
} from "./azure-devops-repository-identity";

describe("Azure DevOps repository identity", () => {
  test("normalizes equivalent service addresses at the identity boundary", () => {
    const repository: AzureDevOpsRepository = {
      providerId: "azure_devops",
      deployment: "server",
      serviceUrl: "HTTP://ADO.Example/tfs/",
      organization: "DefaultCollection",
      project: "Desktop",
      name: "app",
    };
    const canonicalRepository = { ...repository, serviceUrl: "http://ado.example/tfs" };

    expect(canonicalAzureDevOpsServiceUrl(repository.serviceUrl)).toBe("http://ado.example/tfs");
    expect(azureDevOpsRepositoryKey(repository)).toBe(
      azureDevOpsRepositoryKey(canonicalRepository),
    );
    expect(azureDevOpsConnectionConfigurationFingerprint("workspace", "/repo", repository)).toBe(
      azureDevOpsConnectionConfigurationFingerprint("workspace", "/repo", canonicalRepository),
    );
    expect(azureDevOpsCollectionUrl(repository)).toBe("http://ado.example/tfs/DefaultCollection");
    expect(
      azureDevOpsResolvedRepositoryIdentity({
        ...repository,
        projectId: "project-id",
        repositoryId: "repository-id",
      }),
    ).toBe("azure_devops::http://ado.example/tfs/DefaultCollection::project-id::repository-id");
  });

  test("keeps Server path case and folds cloud identity case", () => {
    const server: AzureDevOpsRepository = {
      providerId: "azure_devops",
      deployment: "server",
      serviceUrl: "https://ado.example/tfs",
      organization: "DefaultCollection",
      project: "Desktop",
      name: "app",
    };
    const cloud: AzureDevOpsRepository = {
      ...server,
      deployment: "services",
      serviceUrl: "https://dev.azure.com",
    };

    expect(azureDevOpsRepositoryKey(server)).not.toBe(
      azureDevOpsRepositoryKey({ ...server, organization: "defaultcollection" }),
    );
    expect(azureDevOpsRepositoryKey(cloud)).toBe(
      azureDevOpsRepositoryKey({ ...cloud, organization: "defaultcollection" }),
    );
  });
});
