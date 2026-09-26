import { describe, expect, test } from "bun:test";
import {
  azureDevOpsRepositorySchema,
  repoConfigSchema,
  type AzureDevOpsRepository,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { GitProviderRepositoryPort } from "../../../ports/git-provider-port";
import { createAzureDevOpsAreaPathsReader, createAzureDevOpsIssueReader } from "./issues";
import type { AzureDevOpsRequest, AzureDevOpsRestClient } from "./rest-client";

const repository = azureDevOpsRepositorySchema.parse({
  providerId: "azure_devops",
  deployment: "server",
  serviceUrl: "https://ado.example.test/collection",
  organization: "DefaultCollection",
  project: "Desktop App",
  name: "app",
});
const repoConfig = repoConfigSchema.parse({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  git: {
    provider: {
      id: "azure_devops",
      enabled: true,
      repository,
      settings: { areaPath: "Desktop App\\Client" },
    },
  },
});
const repositoryPort: GitProviderRepositoryPort<AzureDevOpsRepository> = {
  detectRepository: () => Effect.die("Unexpected repository detection"),
  getRepository: () => Effect.succeed(repository),
  getMapping: () => Effect.die("Unexpected repository mapping"),
};

const workItem = {
  id: 17,
  rev: 4,
  fields: {
    "System.Title": "Fix startup",
    "System.Description":
      '<p>See <a href="/guide">guide</a> &amp; &#999999999;</p><p><a href="javascript:alert(1)">unsafe</a></p>',
    "System.CreatedBy": { displayName: "Ada" },
    "System.ChangedDate": "2026-09-23T11:00:00Z",
    "System.Tags": "bug; ui",
    "System.WorkItemType": "Bug",
    "System.State": "Active",
    "System.AreaPath": "Desktop App\\Client\\Shell",
  },
};

const fixture = (ids: number[] = [17]) => {
  const requests: AzureDevOpsRequest[] = [];
  const client: AzureDevOpsRestClient = {
    request: (_config, _repository, request) => {
      requests.push(request);
      const body =
        request.path === "wit/classificationnodes/Areas"
          ? { name: "Desktop App", hasChildren: true, children: [{ name: "Client" }] }
          : request.path === "wit/workitemtypes"
            ? { value: [{ name: "Bug" }] }
            : request.path === "wit/workitemtypes/Bug/states"
              ? {
                  value: [
                    { name: "Active", category: "InProgress" },
                    { name: "Closed", category: "Completed" },
                  ],
                }
              : request.path === "wit/wiql"
                ? { asOf: "2026-09-23T11:00:00Z", workItems: ids.map((id) => ({ id })) }
                : request.path === "wit/workitems" || request.path === "wit/workitems/17"
                  ? request.path === "wit/workitems"
                    ? {
                        value: String(request.query?.ids ?? "")
                          .split(",")
                          .map((id) => ({ ...workItem, id: Number(id) })),
                      }
                    : workItem
                  : null;
      return Effect.succeed({ body, continuationToken: null });
    },
    readContinuationPages: () => Effect.die("Unexpected continuation request"),
    readOffsetPages: () => Effect.die("Unexpected offset request"),
  };
  return {
    reader: createAzureDevOpsIssueReader({ client, repositoryPort }),
    areaPaths: createAzureDevOpsAreaPathsReader({ client, repositoryPort }),
    requests,
  };
};

describe("Azure DevOps issue reader", () => {
  test("reads project areas through the Azure-only port", async () => {
    const { areaPaths, requests } = fixture();
    const paths = await Effect.runPromise(areaPaths.list(repoConfig));
    expect(paths).toEqual(["Desktop App", "Desktop App\\Client"]);
    expect(requests.map((request) => request.path)).toEqual(["wit/classificationnodes/Areas"]);
  });

  test("lists open work items in the saved area with Server 2022 API version", async () => {
    const { reader, requests } = fixture();
    const result = await Effect.runPromise(reader.list({ repoConfig, search: "startup", page: 1 }));

    expect(result.items).toMatchObject([
      {
        providerId: "azure_devops",
        sourceId: "17",
        title: "Fix startup",
        creator: "Ada",
        tags: ["bug", "ui"],
        revision: "4",
      },
    ]);
    expect(result.items[0]?.description).toContain("[guide](https://ado.example.test/guide)");
    expect(result.items[0]?.description).toContain("unsafe");
    expect(result.items[0]?.description).not.toContain("javascript:");
    expect(requests.map((request) => request.apiVersion)).toEqual([
      "7.0",
      "7.0",
      "7.0",
      "7.0",
      "7.0",
    ]);
    expect(JSON.stringify(requests[3]?.body)).toContain("[System.Title] CONTAINS 'startup'");
    expect(JSON.stringify(requests[3]?.body)).toContain(
      "[System.AreaPath] UNDER 'Desktop App\\\\Client'",
    );
    expect(requests[4]?.query?.asOf).toBe("2026-09-23T11:00:00Z");
  });

  test("keeps later pages on the first WIQL snapshot", async () => {
    const { reader, requests } = fixture(Array.from({ length: 21 }, (_, index) => index + 1));
    const first = await Effect.runPromise(reader.list({ repoConfig, search: "", page: 1 }));
    expect(first.items).toHaveLength(20);
    expect(first.nextPage).toBe(2);
    expect(first.snapshot).toBe("2026-09-23T11:00:00Z");
    if (!first.snapshot) throw new Error("Expected a WIQL snapshot");

    const second = await Effect.runPromise(
      reader.list({ repoConfig, search: "", page: 2, snapshot: first.snapshot }),
    );
    expect(second.items.map((item) => item.sourceId)).toEqual(["21"]);
    expect(second.nextPage).toBeUndefined();
    const wiqlRequests = requests.filter((request) => request.path === "wit/wiql");
    expect(JSON.stringify(wiqlRequests[0]?.body)).not.toContain("ASOF");
    expect(JSON.stringify(wiqlRequests[1]?.body)).toContain("ASOF '2026-09-23T11:00:00Z'");
    expect(
      requests
        .filter((request) => request.path === "wit/workitems")
        .map((request) => request.query?.asOf),
    ).toEqual(["2026-09-23T11:00:00Z", "2026-09-23T11:00:00Z"]);
  });

  test("rejects a work item that moved out of the saved area", async () => {
    const moved = {
      ...workItem,
      fields: { ...workItem.fields, "System.AreaPath": "Desktop App\\Other" },
    };
    const client: AzureDevOpsRestClient = {
      request: (_config, _repository, request) =>
        Effect.succeed({
          body:
            request.path === "wit/classificationnodes/Areas"
              ? { name: "Desktop App", children: [{ name: "Client" }] }
              : request.path === "wit/workitemtypes"
                ? { value: [{ name: "Bug" }] }
                : request.path === "wit/workitemtypes/Bug/states"
                  ? { value: [{ name: "Active", category: "InProgress" }] }
                  : moved,
          continuationToken: null,
        }),
      readContinuationPages: () => Effect.die("Unexpected continuation request"),
      readOffsetPages: () => Effect.die("Unexpected offset request"),
    };
    const movedReader = createAzureDevOpsIssueReader({ client, repositoryPort });
    await expect(
      Effect.runPromise(movedReader.get({ repoConfig, sourceId: "17" })),
    ).rejects.toThrow("no longer open in area");
  });

  test("prepares area and state data once while reading each import item again", async () => {
    const { reader, requests } = fixture();
    const get = await Effect.runPromise(reader.prepareGet(repoConfig));

    await Effect.runPromise(get("17"));
    await Effect.runPromise(get("17"));

    expect(requests.map((request) => request.path)).toEqual([
      "wit/classificationnodes/Areas",
      "wit/workitemtypes",
      "wit/workitemtypes/Bug/states",
      "wit/workitems/17",
      "wit/workitems/17",
    ]);
  });
});
