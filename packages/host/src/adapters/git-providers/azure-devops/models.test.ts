import { describe, expect, test } from "bun:test";
import type { AzureDevOpsRepository, PullRequest } from "@openducktor/contracts";
import { parseAzurePullRequest, requireAzureLinkedRepository } from "./models";
import { azureDevOpsResolvedRepositoryIdentity } from "@openducktor/core";

const repository: AzureDevOpsRepository = {
  providerId: "azure_devops",
  deployment: "services",
  serviceUrl: "https://dev.azure.com",
  organization: "OpenDucktor",
  project: "Desktop",
  name: "app",
};

const response = (status: string, isDraft = false) => ({
  pullRequestId: 42,
  status,
  isDraft,
  sourceRefName: "refs/heads/odt/task-42",
  targetRefName: "refs/heads/main",
  creationDate: "2026-09-18T10:00:00Z",
  closedDate: status === "active" ? null : "2026-09-19T10:00:00Z",
  repository: {
    id: "repository-1",
    name: "app",
    project: { id: "project-1", name: "Desktop" },
  },
  _links: { web: { href: "https://dev.azure.com/OpenDucktor/Desktop/_git/app/pullrequest/42" } },
});

describe("Azure DevOps pull request models", () => {
  test.each([
    ["active", false, "open"],
    ["active", true, "draft"],
    ["completed", false, "merged"],
    ["abandoned", false, "closed_unmerged"],
  ] as const)("maps %s state and branches", (status, draft, expected) => {
    const parsed = parseAzurePullRequest(
      response(status, draft),
      repository,
      "2026-09-19T12:00:00Z",
    );
    expect(parsed.record.state).toBe(expected);
    expect(parsed.record.repositoryIdentity).toBe(
      azureDevOpsResolvedRepositoryIdentity({
        ...repository,
        projectId: "project-1",
        repositoryId: "repository-1",
      }),
    );
    expect(parsed.sourceBranch).toBe("odt/task-42");
    expect(parsed.targetBranch).toBe("main");
  });

  test("keeps open pull request timestamps stable across reads", () => {
    const first = parseAzurePullRequest(response("active"), repository, "2026-09-19T12:00:00Z");
    const second = parseAzurePullRequest(response("active"), repository, "2026-09-19T13:00:00Z");

    expect(first.record.updatedAt).toBe("2026-09-18T10:00:00Z");
    expect(second.record.updatedAt).toBe(first.record.updatedAt);
    expect(first.record.lastSyncedAt).toBe("2026-09-19T12:00:00Z");
    expect(second.record.lastSyncedAt).toBe("2026-09-19T13:00:00Z");
  });

  test("rejects a linked pull request from another provider", () => {
    const linked: PullRequest = {
      providerId: "github",
      number: 42,
      url: "https://github.com/OpenDucktor/app/pull/42",
      state: "open",
      createdAt: "2026-09-18T10:00:00Z",
      updatedAt: "2026-09-19T10:00:00Z",
    };
    expect(() => requireAzureLinkedRepository(linked)).toThrow("does not match");
  });

  test("rejects a legacy Azure link without repository identity", () => {
    const linked: PullRequest = {
      providerId: "azure_devops",
      number: 42,
      url: "https://dev.azure.com/OpenDucktor/Desktop/_git/app/pullrequest/42",
      state: "open",
      createdAt: "2026-09-18T10:00:00Z",
      updatedAt: "2026-09-19T10:00:00Z",
    };

    expect(() => requireAzureLinkedRepository(linked)).toThrow("Unlink it and link it again");
  });

  test("rejects an Azure link from another repository", () => {
    const linked: PullRequest = {
      providerId: "azure_devops",
      repositoryIdentity: azureDevOpsResolvedRepositoryIdentity({
        ...repository,
        projectId: "project-1",
        repositoryId: "repository-2",
      }),
      number: 42,
      url: "https://dev.azure.com/OpenDucktor/Desktop/_git/other/pullrequest/42",
      state: "open",
      createdAt: "2026-09-18T10:00:00Z",
      updatedAt: "2026-09-19T10:00:00Z",
    };

    expect(() =>
      requireAzureLinkedRepository(linked, {
        ...repository,
        projectId: "project-1",
        repositoryId: "repository-1",
      }),
    ).toThrow("belongs to another repository");
  });
});
