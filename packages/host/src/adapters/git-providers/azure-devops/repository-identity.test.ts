import { describe, expect, test } from "bun:test";
import { azureDevOpsCollectionUrl, azureDevOpsRepositoryKey } from "@openducktor/core";
import { parseAzureDevOpsRepositoryUrl } from "./repository-identity";

describe("Azure DevOps repository identity", () => {
  test("normalizes Services HTTPS, legacy, and SSH remotes", () => {
    const expected = {
      providerId: "azure_devops",
      deployment: "services",
      serviceUrl: "https://dev.azure.com",
      organization: "OpenDucktor",
      project: "Desktop App",
      name: "Main Repo",
    } as const;
    const repositories = [
      parseAzureDevOpsRepositoryUrl(
        "https://dev.azure.com/OpenDucktor/Desktop%20App/_git/Main%20Repo",
      ),
      parseAzureDevOpsRepositoryUrl(
        "https://OpenDucktor.visualstudio.com/Desktop%20App/_git/Main%20Repo",
      ),
      parseAzureDevOpsRepositoryUrl(
        "git@ssh.dev.azure.com:v3/OpenDucktor/Desktop%20App/Main%20Repo",
      ),
      parseAzureDevOpsRepositoryUrl(
        "ssh://git@ssh.dev.azure.com/v3/OpenDucktor/Desktop%20App/Main%20Repo",
      ),
    ];

    expect(repositories[0]).toEqual(expected);
    expect(repositories[1]).toEqual({ ...expected, organization: "openducktor" });
    expect(repositories[2]).toEqual(expected);
    expect(repositories[3]).toEqual(expected);
    expect(
      new Set(repositories.map((repository) => azureDevOpsRepositoryKey(repository!))).size,
    ).toBe(1);
  });

  test("preserves Server service, collection, and project paths", () => {
    const repository = parseAzureDevOpsRepositoryUrl(
      "http://azure.example.test:8080/tfs/Collection%20A/Project%20One/_git/Repo%20A.git",
    );

    expect(repository).toEqual({
      providerId: "azure_devops",
      deployment: "server",
      serviceUrl: "http://azure.example.test:8080/tfs",
      organization: "Collection A",
      project: "Project One",
      name: "Repo A",
    });
    expect(azureDevOpsCollectionUrl(repository!)).toBe(
      "http://azure.example.test:8080/tfs/Collection%20A",
    );
  });

  test("detects a Server SSH remote with the standard SSH port", () => {
    expect(
      parseAzureDevOpsRepositoryUrl(
        "ssh://azure-devops.example.test:22/tfs/DefaultCollection/Asterix/_git/Asterix",
      ),
    ).toEqual({
      providerId: "azure_devops",
      deployment: "server",
      serviceUrl: "https://azure-devops.example.test/tfs",
      organization: "DefaultCollection",
      project: "Asterix",
      name: "Asterix",
    });
  });

  test("rejects unsafe or incomplete remotes", () => {
    expect(
      parseAzureDevOpsRepositoryUrl("https://user:secret@dev.azure.com/org/project/_git/repo"),
    ).toBeNull();
    expect(
      parseAzureDevOpsRepositoryUrl("https://git@dev.azure.com/org/project/_git/repo"),
    ).toBeNull();
    expect(
      parseAzureDevOpsRepositoryUrl("ssh://other@ssh.dev.azure.com/v3/org/project/repo"),
    ).toBeNull();
    expect(
      parseAzureDevOpsRepositoryUrl("ssh://git:secret@ssh.dev.azure.com/v3/org/project/repo"),
    ).toBeNull();
    expect(
      parseAzureDevOpsRepositoryUrl("https://dev.azure.com/org/project/_git/repo?x=1"),
    ).toBeNull();
    expect(parseAzureDevOpsRepositoryUrl("git@azure.example.test:project/repo")).toBeNull();
    expect(
      parseAzureDevOpsRepositoryUrl(
        "ssh://azure.example.test:2222/tfs/DefaultCollection/Project/_git/Repo",
      ),
    ).toBeNull();
    expect(parseAzureDevOpsRepositoryUrl("https://dev.azure.com/org/_git/repo")).toBeNull();
  });
});
