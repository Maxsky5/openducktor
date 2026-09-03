import { describe, expect, test } from "bun:test";
import {
  gitProviderCapabilitiesSchema,
  gitProviderConfigSchema,
  gitProviderDescriptorSchema,
  repositoryGitProviderContextSchema,
  repoGitConfigSchema,
} from "./git-schemas";
import { GITHUB_PROVIDER_DESCRIPTOR } from "./git-provider-descriptors";

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

  test("keeps provider support, configuration, and health as separate context fields", () => {
    const context = {
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
    };

    expect(repositoryGitProviderContextSchema.parse(context)).toEqual(context);
    expect(repositoryGitProviderContextSchema.parse(null)).toBeNull();
  });
});
