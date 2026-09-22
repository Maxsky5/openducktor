import { describe, expect, test } from "bun:test";
import { azureDevOpsRepositorySchema } from "./azure-devops-schemas";
import {
  gitProviderCapabilitiesSchema,
  gitProviderConfigSchema,
  gitProviderDescriptorSchema,
  repositoryGitProviderContextSchema,
  repoGitConfigSchema,
} from "./git-schemas";
import {
  AZURE_DEVOPS_PROVIDER_DESCRIPTOR,
  GITHUB_PROVIDER_DESCRIPTOR,
} from "./git-provider-descriptors";

const providerContext = () => ({
  descriptor: GITHUB_PROVIDER_DESCRIPTOR,
  config: {
    id: "github",
    enabled: false,
    autoDetected: false,
  },
  health: {
    providerId: "github",
    enabled: false,
    available: false,
    reason: "GitHub provider is not enabled for this repository.",
    executablePath: null,
    version: null,
    authenticated: false,
    account: null,
    repositoryMappingValid: null,
  },
});

describe("Git provider descriptors", () => {
  test("exports the GitHub Pull Request capability contract", () => {
    expect(GITHUB_PROVIDER_DESCRIPTOR).toEqual({
      id: "github",
      label: "GitHub",
      description: "GitHub repository hosting and Pull Request integration.",
      capabilities: {
        supportsPullRequests: true,
        supportsPullRequestReview: true,
      },
    });
    expect(gitProviderDescriptorSchema.parse(GITHUB_PROVIDER_DESCRIPTOR)).toEqual(
      GITHUB_PROVIDER_DESCRIPTOR,
    );
  });

  test("exports the Azure DevOps Pull Request capability contract", () => {
    expect(gitProviderDescriptorSchema.parse(AZURE_DEVOPS_PROVIDER_DESCRIPTOR)).toEqual(
      AZURE_DEVOPS_PROVIDER_DESCRIPTOR,
    );
    expect(AZURE_DEVOPS_PROVIDER_DESCRIPTOR.capabilities).toEqual({
      supportsPullRequests: true,
      supportsPullRequestReview: true,
    });
  });

  test("rejects Pull Request review support without Pull Request support", () => {
    expect(() =>
      gitProviderCapabilitiesSchema.parse({
        supportsPullRequests: false,
        supportsPullRequestReview: true,
      }),
    ).toThrow("Pull Request review support requires Pull Request support.");
  });

  test("rejects undeclared descriptor and capability fields", () => {
    expect(
      gitProviderCapabilitiesSchema.safeParse({
        supportsPullRequests: true,
        supportsPullRequestReview: true,
        available: true,
      }).success,
    ).toBe(false);
    expect(
      gitProviderDescriptorSchema.safeParse({
        ...GITHUB_PROVIDER_DESCRIPTOR,
        enabled: true,
      }).success,
    ).toBe(false);
  });

  test("keeps configured provider identity open while rejecting undeclared config fields", () => {
    expect(
      gitProviderConfigSchema.parse({
        id: " gitlab ",
        enabled: true,
        autoDetected: false,
      }).id,
    ).toBe("gitlab");
    expect(
      gitProviderConfigSchema.safeParse({
        id: "github",
        enabled: true,
        autoDetected: false,
        available: true,
      }).success,
    ).toBe(false);
    expect(repoGitConfigSchema.safeParse({ providers: {} }).success).toBe(false);
  });

  test("rejects provider-specific repository and remote mapping combinations", () => {
    const azureRepository = {
      providerId: "azure_devops" as const,
      deployment: "services" as const,
      serviceUrl: "https://dev.azure.com",
      organization: "OpenDucktor",
      project: "Desktop",
      name: "app",
    };
    const otherAzureRepository = { ...azureRepository, name: "other" };

    expect(
      gitProviderConfigSchema.safeParse({
        id: "github",
        enabled: true,
        autoDetected: false,
        repository: azureRepository,
      }).success,
    ).toBe(false);
    expect(
      gitProviderConfigSchema.safeParse({
        id: "azure_devops",
        enabled: true,
        autoDetected: false,
        repository: { host: "github.com", owner: "openai", name: "openducktor" },
      }).success,
    ).toBe(false);
    expect(
      gitProviderConfigSchema.safeParse({
        id: "azure_devops",
        enabled: true,
        autoDetected: false,
        repository: azureRepository,
        remoteMappings: [
          {
            remoteName: "origin",
            fetchUrl: "https://dev.azure.com/OpenDucktor/Desktop/_git/other",
            pushUrls: ["https://dev.azure.com/OpenDucktor/Desktop/_git/other"],
            repository: otherAzureRepository,
          },
        ],
      }).success,
    ).toBe(false);
  });

  test("validates an Azure DevOps Server service address without rewriting it", () => {
    expect(
      azureDevOpsRepositorySchema.parse({
        providerId: "azure_devops",
        deployment: "server",
        serviceUrl: "HTTP://ADO.Example/tfs/",
        organization: "DefaultCollection",
        project: "OpenDucktor",
        name: "Desktop",
      }).serviceUrl,
    ).toBe("HTTP://ADO.Example/tfs/");
  });

  test("reports an invalid Azure DevOps Server address without throwing", () => {
    expect(() =>
      azureDevOpsRepositorySchema.safeParse({
        providerId: "azure_devops",
        deployment: "server",
        serviceUrl: "",
        organization: "DefaultCollection",
        project: "OpenDucktor",
        name: "Desktop",
      }),
    ).not.toThrow();

    expect(
      azureDevOpsRepositorySchema.safeParse({
        providerId: "azure_devops",
        deployment: "server",
        serviceUrl: "",
        organization: "DefaultCollection",
        project: "OpenDucktor",
        name: "Desktop",
      }).success,
    ).toBe(false);
  });

  test("rejects Server paths that URL parsing would rewrite or cannot decode", () => {
    for (const serviceUrl of [
      "https://ado.example/tfs/../admin",
      "https://ado.example/tfs/%2e%2e/admin",
      "https://ado.example/tfs/%252e%252e/admin",
      "https://ado.example/tfs/%2fadmin",
      "https://ado.example/tfs/%5cadmin",
      "https://ado.example/tfs\\..\\admin",
      "https://ado.example/tfs/%",
    ]) {
      expect(
        azureDevOpsRepositorySchema.safeParse({
          providerId: "azure_devops",
          deployment: "server",
          serviceUrl,
          organization: "DefaultCollection",
          project: "OpenDucktor",
          name: "Desktop",
        }).success,
      ).toBe(false);
    }
  });

  test("keeps provider support, configuration, and health as separate context fields", () => {
    const context = providerContext();

    expect(repositoryGitProviderContextSchema.parse(context)).toEqual(context);
    expect(repositoryGitProviderContextSchema.parse(null)).toBeNull();
  });

  test("rejects a context whose provider ids do not match", () => {
    const context = providerContext();

    expect(
      repositoryGitProviderContextSchema.safeParse({
        ...context,
        config: { ...context.config, id: "fake" },
      }).success,
    ).toBe(false);
    expect(
      repositoryGitProviderContextSchema.safeParse({
        ...context,
        health: { ...context.health, providerId: "fake" },
      }).success,
    ).toBe(false);
  });

  test("rejects a context whose enabled values do not match", () => {
    const context = providerContext();

    expect(
      repositoryGitProviderContextSchema.safeParse({
        ...context,
        health: { ...context.health, enabled: true },
      }).success,
    ).toBe(false);
  });
});
