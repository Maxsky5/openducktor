import { describe, expect, test } from "bun:test";
import { GITHUB_PROVIDER_DESCRIPTOR, type SourceIssue } from "@openducktor/contracts";
import { createGitProviderContextFixture } from "../../test-support/shared-test-fixtures";
import {
  issueImportCreatedMessage,
  issueImportListQueryOptions,
  issueImportPageSummary,
  issueImportReviewStatus,
  issueImportSearchField,
  issueImportUnavailableReason,
  nextIssueImportCursors,
  selectedItemsWithCurrentLinks,
} from "./issue-import-model";
import type { IssueImportProvider } from "./issue-import-provider";

const sourceIssue = (sourceId: string, overrides: Partial<SourceIssue> = {}): SourceIssue => ({
  providerId: "github",
  scope: "example/repo",
  sourceId,
  number: sourceId,
  url: `https://github.com/example/repo/issues/${sourceId}`,
  title: `Issue ${sourceId}`,
  description: "",
  creator: "octocat",
  updatedAt: "2026-02-22T12:00:00.000Z",
  tags: [],
  revision: "1",
  ...overrides,
});

const githubProvider = (): IssueImportProvider => ({
  ...createGitProviderContextFixture(),
  descriptor: GITHUB_PROVIDER_DESCRIPTOR,
});

describe("issueImportUnavailableReason", () => {
  test("allows a provider whose issue connection works", () => {
    expect(issueImportUnavailableReason(githubProvider())).toBeNull();
    const mappingInvalid = githubProvider();
    mappingInvalid.health = {
      ...mappingInvalid.health,
      available: false,
      repositoryMappingValid: false,
    };
    expect(issueImportUnavailableReason(mappingInvalid)).toBeNull();
  });

  test("names the host reason, or the setup step, when the provider is not available", () => {
    const unavailable = { ...createGitProviderContextFixture({ available: false }) };
    expect(issueImportUnavailableReason(unavailable)).toBe("Sign in to GitHub CLI.");
    unavailable.health = { ...unavailable.health, reason: undefined };
    expect(issueImportUnavailableReason(unavailable)).toBe(
      "Connect the Git provider in repository settings before importing.",
    );
  });

  test("asks for an Azure DevOps area path", () => {
    const azure = githubProvider();
    azure.config = { ...azure.config, id: "azure_devops" };
    expect(issueImportUnavailableReason(azure)).toBe(
      "Choose an Azure DevOps area path in repository settings before importing work items.",
    );
  });
});

describe("issue import selection", () => {
  test("keeps the selection and adds task links that the current page shows", () => {
    const selected = new Map([
      ["1", sourceIssue("1")],
      ["2", sourceIssue("2")],
    ]);
    const page = [sourceIssue("1", { linkedTaskId: "TASK-9" }), sourceIssue("3")];

    expect(
      selectedItemsWithCurrentLinks(selected, page).map((item) => [
        item.sourceId,
        item.linkedTaskId,
      ]),
    ).toEqual([
      ["1", "TASK-9"],
      ["2", undefined],
    ]);
  });

  test("keeps earlier page cursors and drops later ones on a move to the next page", () => {
    expect(nextIssueImportCursors([undefined, "a", "b"], 0, "c")).toEqual([undefined, "c"]);
    expect(nextIssueImportCursors([undefined], 0, "a")).toEqual([undefined, "a"]);
  });

  test("keys each result page by provider scope, search, and cursor", () => {
    const options = issueImportListQueryOptions({
      repoPath: "/repo",
      provider: githubProvider(),
      search: "crash",
      cursor: "page-2",
    });
    expect([...options.queryKey]).toEqual([
      "issue-items",
      "/repo",
      "github",
      { host: "github.com", owner: "example", name: "repo" },
      undefined,
      "crash",
      "page-2",
    ]);
  });
});

describe("issue import text", () => {
  test("names the search field of a provider that can search", () => {
    expect(issueImportSearchField(githubProvider())).toEqual({
      label: "Search issues",
      placeholder: "Search titles or issue numbers",
    });
    const browseOnly = githubProvider();
    browseOnly.descriptor = {
      ...browseOnly.descriptor,
      capabilities: { ...browseOnly.descriptor.capabilities, issueAccess: "browse" },
    };
    expect(issueImportSearchField(browseOnly)).toBeNull();
  });

  test("summarizes the page and the item count", () => {
    expect(issueImportPageSummary(0, 1, false)).toBe("1 item");
    expect(issueImportPageSummary(1, 20, true)).toBe("Page 2 · 20 items");
  });

  test("states the result of each reviewed item", () => {
    expect(
      issueImportReviewStatus(sourceIssue("1"), {
        sourceId: "1",
        outcome: "created",
        taskId: "TASK-1",
      }),
    ).toEqual({ kind: "created", text: "Created Task TASK-1" });
    expect(
      issueImportReviewStatus(sourceIssue("1", { linkedTaskId: "TASK-2" }), undefined),
    ).toEqual({ kind: "failed", text: "Already linked to Task TASK-2" });
    expect(
      issueImportReviewStatus(sourceIssue("1"), {
        sourceId: "1",
        outcome: "failed",
        reason: "The source item changed.",
      }),
    ).toEqual({ kind: "failed", text: "The source item changed." });
    expect(issueImportReviewStatus(sourceIssue("1"), undefined)).toBeNull();
    expect(issueImportCreatedMessage(1)).toBe("1 Task created");
    expect(issueImportCreatedMessage(3)).toBe("3 Tasks created");
  });
});
