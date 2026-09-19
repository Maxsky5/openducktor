import { describe, expect, test } from "bun:test";
import {
  azureDevOpsHttpConsentCollectionUrl,
  azureRemoteMappingDraftErrors,
  azureRepositoryDraftErrors,
  isAzureDevOpsConnectionEventCurrent,
  parseAzureRepositoryDraft,
  toAzureRemoteMappings,
} from "./azure-devops-git-provider-form-model";

const repositoryDraft = {
  deployment: "server" as const,
  serviceUrl: "https://azure.example.test/tfs",
  organization: "DefaultCollection",
  project: "Desktop",
  name: "OpenDucktor",
};

describe("Azure DevOps settings draft", () => {
  test("requires HTTP consent for a mixed-case Azure DevOps Server address", () => {
    expect(
      azureDevOpsHttpConsentCollectionUrl({
        providerId: "azure_devops",
        ...repositoryDraft,
        serviceUrl: "HTTP://ADO.Example/tfs",
      }),
    ).toBe("http://ado.example/tfs/DefaultCollection");
  });

  test("reports repository errors by field without discarding raw input", () => {
    const draft = { ...repositoryDraft, project: "" };

    expect(parseAzureRepositoryDraft(draft).success).toBe(false);
    expect(azureRepositoryDraftErrors(draft)).toMatchObject({
      project: "Too small: expected string to have >=1 characters",
    });
    expect(draft.project).toBe("");
  });

  test("builds an exact explicit remote mapping from multiline push URLs", () => {
    const parsed = parseAzureRepositoryDraft(repositoryDraft);
    if (!parsed.success) throw parsed.error;

    expect(
      toAzureRemoteMappings(
        [
          {
            draftId: "mapping-1",
            remoteName: "azure",
            fetchUrl: "git@work:team/repo",
            pushUrls: "git@work:team/repo\nssh://work/team/repo",
          },
        ],
        parsed.data,
      ),
    ).toEqual([
      {
        remoteName: "azure",
        fetchUrl: "git@work:team/repo",
        pushUrls: ["git@work:team/repo", "ssh://work/team/repo"],
        repository: parsed.data,
      },
    ]);
  });

  test("reports each incomplete mapping field", () => {
    const parsed = parseAzureRepositoryDraft(repositoryDraft);
    if (!parsed.success) throw parsed.error;

    expect(
      azureRemoteMappingDraftErrors(
        { draftId: "mapping-1", remoteName: "", fetchUrl: "", pushUrls: "" },
        parsed.data,
      ),
    ).toMatchObject({
      remoteName: expect.any(String),
      fetchUrl: expect.any(String),
      pushUrls: expect.any(String),
    });
  });

  test("accepts connection events only for the active selection and attempt", () => {
    const event = {
      workspaceId: "workspace-1",
      repoPath: "/repo-a",
      providerId: "azure_devops" as const,
      configurationFingerprint: "fingerprint-a",
      attemptId: "8f7c9548-59a8-4f0e-a788-370a060d3f4f",
      state: { status: "connected" as const, account: "ada@example.test" },
    };
    const selection = {
      workspaceId: "workspace-1",
      repoPath: "/repo-a",
      configurationFingerprint: "fingerprint-a",
      attemptId: "8f7c9548-59a8-4f0e-a788-370a060d3f4f",
    };

    expect(isAzureDevOpsConnectionEventCurrent(event, selection)).toBe(true);
    expect(
      isAzureDevOpsConnectionEventCurrent(event, {
        ...selection,
        configurationFingerprint: "fingerprint-b",
      }),
    ).toBe(false);
    expect(
      isAzureDevOpsConnectionEventCurrent(event, {
        ...selection,
        attemptId: "53afb4ed-31bd-4ac4-b3eb-54dcbec51062",
      }),
    ).toBe(false);
  });
});
