import { describe, expect, test } from "bun:test";
import {
  GITHUB_PROVIDER_DESCRIPTOR,
  repoConfigSchema,
  type SourceIssue,
  type TaskCard,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { GitProviderPort, IssueReaderPort } from "../../ports/git-provider-port";
import type { IssueImportStorePort } from "../../ports/issue-import-store-port";
import type { GitProviderResolver } from "./git-provider-resolver";
import { createIssueImportService } from "./issue-import-service";

const repoConfig = repoConfigSchema.parse({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  git: {
    provider: {
      id: "github",
      enabled: true,
      repository: { host: "github.com", owner: "example", name: "repo" },
    },
  },
});

const issue = (sourceId: string, revision = "1"): SourceIssue => ({
  providerId: "github",
  scope: "github.com/example/repo",
  sourceId,
  number: sourceId,
  url: `https://github.com/example/repo/issues/${sourceId}`,
  title: `Issue ${sourceId}`,
  description: `Body ${sourceId}`,
  creator: "octocat",
  updatedAt: "2026-09-23T00:00:00Z",
  tags: ["triage"],
  revision,
});

const fixture = (issueAccess: "browse" | "search" = "search") => {
  const sources = new Map([
    ["1", issue("1")],
    ["2", issue("2")],
  ]);
  const linked = new Map<string, string>();
  const created: string[] = [];
  const published: string[] = [];
  const reader: IssueReaderPort = {
    providerId: "github",
    scope: () => Effect.succeed("github.com/example/repo"),
    list: ({ page }) =>
      Effect.succeed({
        items: page === 1 ? [sources.get("1")!, sources.get("2")!] : [],
        nextPage: page === 1 ? 2 : undefined,
      }),
    get: ({ sourceId }) => Effect.succeed(sources.get(sourceId)!),
    prepareGet: () => Effect.succeed((sourceId: string) => reader.get({ repoConfig, sourceId })),
  };
  const provider: GitProviderPort = {
    getDescriptor: () => ({
      ...GITHUB_PROVIDER_DESCRIPTOR,
      capabilities: { ...GITHUB_PROVIDER_DESCRIPTOR.capabilities, issueAccess },
    }),
    repository: () => ({
      detectRepository: () => Effect.die("Unexpected repository detection"),
      getRepository: () => Effect.die("Unexpected repository read"),
      getMapping: () => Effect.die("Unexpected repository mapping"),
    }),
    health: () => ({ getStatus: () => Effect.die("Unexpected health read") }),
    pullRequests: () => Effect.die("Unexpected Pull Request read"),
    pullRequestReview: () => Effect.die("Unexpected Pull Request review read"),
    issues: () => Effect.succeed(reader),
  };
  const resolver: GitProviderResolver = {
    resolve: () => Effect.succeed(provider),
    resolveConfigured: () => Effect.succeed(provider),
  };
  const store: IssueImportStorePort = {
    findLinkedTaskIds: ({ sourceIds }) =>
      Effect.succeed(
        Object.fromEntries(
          sourceIds.flatMap((id) => (linked.has(id) ? [[id, linked.get(id)!]] : [])),
        ),
      ),
    createImportedTask: ({ sourceIssue }) => {
      const taskId = linked.get(sourceIssue.sourceId);
      if (taskId)
        return Effect.succeed({ outcome: "duplicate", taskId } satisfies {
          outcome: "duplicate";
          taskId: string;
        });
      const id = `task-${sourceIssue.sourceId}`;
      linked.set(sourceIssue.sourceId, id);
      created.push(sourceIssue.sourceId);
      // SAFETY: The store fixture needs only the created Task ID that the service reads.
      return Effect.succeed({ outcome: "created", task: { id } as TaskCard } satisfies {
        outcome: "created";
        task: TaskCard;
      });
    },
  };
  const service = createIssueImportService({
    resolver,
    store,
    workspaceSettingsService: { getRepoConfigByRepoPath: () => Effect.succeed(repoConfig) },
    publishTaskCreated: (_repoPath, task) =>
      Effect.sync(() => {
        published.push(task.id);
      }),
  });
  return { service, reader, sources, linked, created, published };
};

describe("Issue import service", () => {
  test("lists browse-only issues and rejects search", async () => {
    const { service } = fixture("browse");
    const first = await Effect.runPromise(
      service.list({ repoPath: "/repo", search: "", cursor: undefined }),
    );
    expect(first.items).toHaveLength(2);
    expect(first.searchSupported).toBe(false);
    await expect(
      Effect.runPromise(service.list({ repoPath: "/repo", search: "startup", cursor: undefined })),
    ).rejects.toThrow("does not support Issue search");
  });

  test("marks links outside the visible Task list and binds the cursor to search and scope", async () => {
    const { service, linked } = fixture();
    linked.set("2", "hidden-task");
    const first = await Effect.runPromise(
      service.list({ repoPath: "/repo", search: "", cursor: undefined }),
    );
    expect(first.items[1]?.linkedTaskId).toBe("hidden-task");
    expect(first.nextCursor).toBeDefined();
    await expect(
      Effect.runPromise(
        service.list({ repoPath: "/repo", search: "other", cursor: first.nextCursor }),
      ),
    ).rejects.toThrow("no longer valid");
  });

  test("keeps successes and reports source changes and duplicates per item", async () => {
    const { service, sources, linked, created, published } = fixture();
    sources.set("2", issue("2", "2"));
    const result = await Effect.runPromise(
      service.import({
        repoPath: "/repo",
        items: [
          { sourceId: "1", revision: "1", issueType: "bug", priority: 0, labels: ["one"] },
          { sourceId: "2", revision: "1", issueType: "task", priority: 2, labels: [] },
        ],
      }),
    );
    expect(result.results).toMatchObject([
      { sourceId: "1", outcome: "created", taskId: "task-1" },
      { sourceId: "2", outcome: "failed" },
    ]);
    expect(result.results[1]).toMatchObject({
      reason: expect.stringContaining("changed since review"),
    });
    expect(created).toEqual(["1"]);
    expect(published).toEqual(["task-1"]);
    linked.set("2", "other-task");
    const retry = await Effect.runPromise(
      service.import({
        repoPath: "/repo",
        items: [{ sourceId: "2", revision: "2", issueType: "task", priority: 2, labels: [] }],
      }),
    );
    expect(retry.results[0]).toMatchObject({ sourceId: "2", outcome: "failed" });
    expect(retry.results[0]).toMatchObject({ reason: expect.stringContaining("other-task") });
    expect(created).toEqual(["1"]);
    expect(published).toEqual(["task-1"]);
  });

  test("reports reader setup failure for each item without creating Tasks", async () => {
    const { service, reader, created, published } = fixture();
    reader.prepareGet = () =>
      Effect.fail(
        new HostValidationError({ field: "provider", message: "Area access is unavailable." }),
      );

    const result = await Effect.runPromise(
      service.import({
        repoPath: "/repo",
        items: [
          { sourceId: "1", revision: "1", issueType: "task", priority: 2, labels: [] },
          { sourceId: "2", revision: "1", issueType: "task", priority: 2, labels: [] },
        ],
      }),
    );

    expect(result.results).toEqual([
      { sourceId: "1", outcome: "failed", reason: "Area access is unavailable." },
      { sourceId: "2", outcome: "failed", reason: "Area access is unavailable." },
    ]);
    expect(created).toEqual([]);
    expect(published).toEqual([]);
  });

  test("refreshes a source item by ID outside the current page and reports its Task link", async () => {
    const { service, sources, linked } = fixture();
    sources.set("42", issue("42", "3"));
    linked.set("42", "TASK-42");

    const refreshed = await Effect.runPromise(service.get({ repoPath: "/repo", sourceId: "42" }));

    expect(refreshed).toMatchObject({ sourceId: "42", revision: "3", linkedTaskId: "TASK-42" });
  });

  test("rejects an item returned outside the configured repository during refresh", async () => {
    const { service, sources } = fixture();
    sources.set("1", { ...issue("1"), scope: "github.com/other/repo" });

    await expect(
      Effect.runPromise(service.get({ repoPath: "/repo", sourceId: "1" })),
    ).rejects.toThrow("outside the configured repository");
  });
});
