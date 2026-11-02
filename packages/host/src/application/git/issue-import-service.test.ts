import { collectTaskStatusChanges } from "../../ports/task-status-changes";
import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { describe, expect, test } from "bun:test";
import {
  GITHUB_PROVIDER_DESCRIPTOR,
  repoConfigSchema,
  type SourceIssue,
  type RepoConfig,
  type TaskCard,
} from "@openducktor/contracts";
import { Deferred, Effect } from "effect";
import { createSerialGate } from "../../effect/serial-gate";
import { createTaskSyncService, type TaskSyncService } from "../tasks/sync/task-sync-service";
import {
  createEventBus,
  noMergeDetection,
  syncWorkspace,
  task,
} from "../tasks/sync/task-sync-service.test-support";
import {
  createSqliteTaskStoreHarness,
  type SqliteTaskStoreTestHarness,
} from "../../adapters/sqlite/sqlite-task-store-test-support";
import { createSqliteIssueImportStore } from "../../adapters/sqlite/sqlite-issue-import-store";
import { createTaskEventStream } from "../../events/task-event-stream";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { enrichTasks } from "../tasks/support/task-workflow-helpers";
import type { ExternalTaskSyncEvent } from "@openducktor/contracts";
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
  scope: "github.com/@repository/123",
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

const fixture = (
  issueAccess: "browse" | "search" = "search",
  taskSyncService?: Pick<TaskSyncService, "runStatusMutation" | "publishExternalTaskCreated">,
  savedStore?: IssueImportStorePort,
) => {
  const sources = new Map([
    ["1", issue("1")],
    ["2", issue("2")],
  ]);
  const linked = new Map<string, string>();
  const legacyLinked = new Map<string, string>();
  const created: string[] = [];
  const published: string[] = [];
  let currentRepoConfig: RepoConfig = repoConfig;
  const resolvedConfigs: RepoConfig[] = [];
  const reader: IssueReaderPort = {
    providerId: "github",
    scope: () => Effect.succeed("github.com/@repository/123"),
    resolveLegacyScope: (_repoConfig, legacyScope) =>
      Effect.succeed(
        legacyScope === "github.com/example/repo" ? "github.com/@repository/123" : undefined,
      ),
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
    resolve: (config) =>
      Effect.sync(() => {
        resolvedConfigs.push(config);
        return provider;
      }),
    resolveConfigured: () => Effect.succeed(provider),
  };
  const store: IssueImportStorePort = {
    getSourceIssue: ({ taskId }) => Effect.succeed(taskId === "task-1" ? issue("1") : undefined),
    findLinkedTaskIds: ({ sourceIds }) =>
      Effect.succeed(
        Object.fromEntries(
          sourceIds.flatMap((id) => (linked.has(id) ? [[id, linked.get(id)!]] : [])),
        ),
      ),
    findSourceScopes: ({ sourceIds }) =>
      Effect.succeed(
        sourceIds.some((id) => legacyLinked.has(id)) ? ["github.com/example/repo"] : [],
      ),
    replaceSourceScope: ({ sourceIds }) =>
      Effect.sync(() => {
        for (const id of sourceIds) {
          const taskId = legacyLinked.get(id);
          if (!taskId) continue;
          legacyLinked.delete(id);
          linked.set(id, taskId);
        }
      }),
    createImportedTask: ({ sourceIssue, task: input }) => {
      const taskId = linked.get(sourceIssue.sourceId);
      if (taskId)
        return Effect.succeed({ outcome: "duplicate", taskId } satisfies {
          outcome: "duplicate";
          taskId: string;
        });
      const id = `task-${sourceIssue.sourceId}`;
      linked.set(sourceIssue.sourceId, id);
      created.push(sourceIssue.sourceId);
      return Effect.succeed({
        outcome: "created",
        task: task({ id, title: input.title }),
      } satisfies {
        outcome: "created";
        task: TaskCard;
      });
    },
  };
  const mutationGate = createSerialGate();
  const service = createIssueImportService({
    taskWorkflows: builtinTaskWorkflows,
    resolver,
    store: savedStore ?? store,
    workspaceSettingsService: { getRepoConfig: () => Effect.succeed(currentRepoConfig) },
    runStatusMutation:
      taskSyncService?.runStatusMutation ??
      ((workspace, _operation, mutation, afterCommit) =>
        mutationGate.run(
          workspace.repoPath,
          collectTaskStatusChanges(mutation).pipe(Effect.flatMap(afterCommit)),
        )),
    publishTaskCreated:
      taskSyncService?.publishExternalTaskCreated ??
      ((_repoPath, task) =>
        Effect.sync(() => {
          published.push(task.id);
        })),
  });
  return {
    service,
    store,
    reader,
    sources,
    linked,
    legacyLinked,
    created,
    published,
    resolvedConfigs,
    setRepoConfig: (config: RepoConfig) => {
      currentRepoConfig = config;
    },
  };
};

const createDatabaseSync = (
  harness: SqliteTaskStoreTestHarness,
  eventBus: { publish: (event: ExternalTaskSyncEvent) => void },
) => {
  const stream = createTaskEventStream({ reporter: { report: () => {} } });
  const workspace = syncWorkspace(harness.repoPath, harness.workspaceId);
  return createTaskSyncService({
    taskService: {
      listTasks: (input) =>
        harness.store
          .listTasks(input)
          .pipe(Effect.map((records) => enrichTasks(builtinTaskWorkflows, records))),
      repoPullRequestSyncDetailed: () =>
        Effect.succeed({ ran: true, changedTaskIds: [], autoCloseFailures: [] }),
    },
    mergeDetection: noMergeDetection,
    taskEventStream: {
      ...stream,
      publish: (event) => {
        eventBus.publish(event);
        return stream.publish(event);
      },
    },
    publicationReporter: { report: () => Effect.void },
    onBackgroundFailure: () => Effect.void,
    settingsConfig: {
      readGlobalConfig: () => Effect.succeed(createDefaultGlobalConfig()),
    },
    workspaceSettingsService: {
      listWorkspaces: () => Effect.succeed([workspace]),
      getWorkspaceCatalog: () =>
        Effect.succeed({
          catalogRevision: 0,
          openWorkspaces: [workspace],
          closedWorkspaces: [],
          incompleteRemovals: [],
        }),
    },
  });
};

describe("Issue import service", () => {
  test("reports a committed import publication failure without reporting creation success", async () => {
    const harness = await createSqliteTaskStoreHarness({ workspaceId: "repo", repoPath: "/repo" });
    const sync = createDatabaseSync(harness, {
      publish: () => {
        throw new Error("Event transport unavailable");
      },
    });
    try {
      const { service } = fixture(
        "search",
        sync,
        createSqliteIssueImportStore({ contextProvider: harness.contextProvider }),
      );
      const result = await Effect.runPromise(
        service.import({
          workspaceId: "repo",
          repoPath: "/repo",
          items: [{ sourceId: "1", revision: "1", issueType: "task", priority: 2, labels: [] }],
        }),
      );
      const saved = await Effect.runPromise(
        harness.store.listTasks({ workspaceId: "repo", repoPath: "/repo" }),
      );
      expect(saved).toMatchObject([{ title: "Issue 1", sourceIssue: { sourceId: "1" } }]);
      expect(result.results).toEqual([
        {
          sourceId: "1",
          outcome: "failed",
          reason: expect.stringContaining("Do not repeat the change"),
        },
      ]);
    } finally {
      await harness.cleanup();
    }
  });

  test("publishes an import before a concurrent mutation of the imported task", async () => {
    const harness = await createSqliteTaskStoreHarness({ workspaceId: "repo", repoPath: "/repo" });
    const { eventBus, events } = createEventBus();
    const captured = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    const sync = createDatabaseSync(harness, eventBus);
    const store = createSqliteIssueImportStore({ contextProvider: harness.contextProvider });
    try {
      const { service } = fixture("search", sync, {
        ...store,
        createImportedTask: (input) =>
          store
            .createImportedTask(input)
            .pipe(
              Effect.tap(() =>
                Deferred.succeed(captured, undefined).pipe(Effect.andThen(Deferred.await(release))),
              ),
            ),
      });
      const imported = Effect.runPromise(
        service.import({
          workspaceId: "repo",
          repoPath: "/repo",
          items: [{ sourceId: "1", revision: "1", issueType: "task", priority: 2, labels: [] }],
        }),
      );
      await Effect.runPromise(Deferred.await(captured));
      const [saved] = await Effect.runPromise(
        harness.store.listTasks({ workspaceId: "repo", repoPath: "/repo" }),
      );
      if (!saved) throw new Error("Expected the committed imported task.");
      const updated = Effect.runPromise(
        sync.runMutation(
          "/repo",
          Effect.gen(function* () {
            yield* harness.store.updateTask({
              workspaceId: "repo",
              repoPath: "/repo",
              taskId: saved.id,
              patch: { title: "Edited after import", priority: 1 },
            });
            yield* sync.publishTasksUpdated(
              { workspaceId: "repo", repoPath: "/repo" },
              { taskIds: [saved.id], removedTaskIds: [] },
              "update-task",
              [],
            );
          }),
        ),
      );
      await Effect.runPromise(Deferred.succeed(release, undefined));
      const [result] = await Promise.all([imported, updated]);
      expect(result.results).toEqual([{ sourceId: "1", outcome: "created", taskId: saved.id }]);
      expect(events).toMatchObject([
        { kind: "external_task_created", taskSnapshot: { title: "Issue 1" } },
        { kind: "tasks_updated", boardChanges: { cards: [{ title: "Edited after import" }] } },
      ]);
      expect(
        (
          await Effect.runPromise(
            harness.store.listTasks({ workspaceId: "repo", repoPath: "/repo" }),
          )
        )[0]?.title,
      ).toBe("Edited after import");
    } finally {
      await Effect.runPromise(Deferred.succeed(release, undefined));
      await harness.cleanup();
    }
  });

  test("rejects a stale workspace reference before reading its provider", async () => {
    const { service, setRepoConfig, resolvedConfigs, created } = fixture();
    setRepoConfig({ ...repoConfig, repoPath: "/moved" });
    await expect(
      Effect.runPromise(service.list({ workspaceId: "repo", repoPath: "/repo", search: "" })),
    ).rejects.toMatchObject({ field: "workspaceId" });
    expect(resolvedConfigs).toEqual([]);
    expect(created).toEqual([]);
  });

  test("loads a saved Task image from its original GitHub repository after provider change", async () => {
    const { service, store, reader, resolvedConfigs, setRepoConfig } = fixture();
    setRepoConfig(
      repoConfigSchema.parse({
        ...repoConfig,
        git: {
          provider: {
            id: "azure_devops",
            enabled: true,
            autoDetected: false,
            repository: {
              providerId: "azure_devops",
              deployment: "services",
              serviceUrl: "https://dev.azure.com",
              organization: "example",
              project: "app",
              name: "repo",
            },
          },
        },
      }),
    );
    const imageUrl =
      "https://github.com/user-attachments/assets/cda6c6b0-48b1-4d49-b8f2-78a1bd758be9";
    const description = `Saved image: ![Image](${imageUrl})`;
    store.getSourceIssue = () => Effect.succeed({ ...issue("1"), description });
    reader.readImage = ({ repoConfig: sourceConfig, sourceId, url, savedDescription }) => {
      expect(sourceConfig.git.provider?.id).toBe("github");
      expect(sourceConfig.git.provider?.repository).toEqual({
        host: "github.com",
        owner: "example",
        name: "repo",
      });
      expect(sourceId).toBe("1");
      expect(url).toBe(imageUrl);
      expect(savedDescription).toBe(description);
      return Effect.succeed({ mediaType: "image/png", bytesBase64: "aGVsbG8=" });
    };

    await expect(
      Effect.runPromise(
        service.getImage({
          workspaceId: "repo",
          repoPath: "/repo",
          taskId: "task-1",
          url: imageUrl,
        }),
      ),
    ).resolves.toEqual({ mediaType: "image/png", bytesBase64: "aGVsbG8=" });
    expect(resolvedConfigs.at(-1)?.git.provider?.id).toBe("github");
  });

  test("rejects a saved Task source whose URL does not match its stored scope", async () => {
    const { service, store, reader } = fixture();
    store.getSourceIssue = () =>
      Effect.succeed({
        ...issue("1"),
        scope: "github.com/other/repo",
      });
    reader.readImage = () => Effect.die("Image fetch must not run");

    await expect(
      Effect.runPromise(
        service.getImage({
          workspaceId: "repo",
          repoPath: "/repo",
          taskId: "task-1",
          url: "https://github.com/user-attachments/assets/cda6c6b0-48b1-4d49-b8f2-78a1bd758be9",
        }),
      ),
    ).rejects.toThrow("no valid GitHub Issue source");
  });

  test("lists browse-only issues and rejects search", async () => {
    const { service } = fixture("browse");
    const first = await Effect.runPromise(
      service.list({ workspaceId: "repo", repoPath: "/repo", search: "", cursor: undefined }),
    );
    expect(first.items).toHaveLength(2);
    expect(first.searchSupported).toBe(false);
    await expect(
      Effect.runPromise(
        service.list({
          workspaceId: "repo",
          repoPath: "/repo",
          search: "startup",
          cursor: undefined,
        }),
      ),
    ).rejects.toThrow("does not support Issue search");
  });

  test("marks links outside the visible Task list and binds the cursor to search and scope", async () => {
    const { service, linked } = fixture();
    linked.set("2", "hidden-task");
    const first = await Effect.runPromise(
      service.list({ workspaceId: "repo", repoPath: "/repo", search: "", cursor: undefined }),
    );
    expect(first.items[1]?.linkedTaskId).toBe("hidden-task");
    expect(first.nextCursor).toBeDefined();
    await expect(
      Effect.runPromise(
        service.list({
          workspaceId: "repo",
          repoPath: "/repo",
          search: "other",
          cursor: first.nextCursor,
        }),
      ),
    ).rejects.toThrow("no longer valid");
  });

  test("keeps a saved link after a GitHub repository rename", async () => {
    const { service, legacyLinked, created, setRepoConfig } = fixture();
    legacyLinked.set("1", "old-task");
    setRepoConfig(
      repoConfigSchema.parse({
        ...repoConfig,
        git: {
          provider: {
            id: "github",
            enabled: true,
            repository: { host: "github.com", owner: "example", name: "renamed" },
          },
        },
      }),
    );

    const result = await Effect.runPromise(
      service.import({
        workspaceId: "repo",
        repoPath: "/repo",
        items: [{ sourceId: "1", revision: "1", issueType: "task", priority: 2, labels: [] }],
      }),
    );
    expect(result.results[0]).toMatchObject({ outcome: "failed", taskId: "old-task" });
    expect(created).toEqual([]);
    legacyLinked.set("2", "other-old-task");
    const listed = await Effect.runPromise(
      service.list({ workspaceId: "repo", repoPath: "/repo", search: "", cursor: undefined }),
    );
    expect(listed.items[0]?.linkedTaskId).toBe("old-task");
    expect(listed.items[1]?.linkedTaskId).toBe("other-old-task");
  });

  test("does not import when a saved GitHub link cannot be verified", async () => {
    const { service, reader, legacyLinked, created } = fixture();
    legacyLinked.set("1", "old-task");
    reader.resolveLegacyScope = () =>
      Effect.fail(
        new HostValidationError({
          field: "sourceScope",
          message: "Cannot verify a saved GitHub Task link. Check access and retry.",
        }),
      );

    const result = await Effect.runPromise(
      service.import({
        workspaceId: "repo",
        repoPath: "/repo",
        items: [{ sourceId: "1", revision: "1", issueType: "task", priority: 2, labels: [] }],
      }),
    );
    expect(result.results[0]).toMatchObject({
      outcome: "failed",
      reason: expect.stringContaining("Cannot verify a saved GitHub Task link"),
    });
    expect(created).toEqual([]);
  });

  test("keeps successes and reports source changes and duplicates per item", async () => {
    const { service, sources, linked, created, published } = fixture();
    sources.set("2", issue("2", "2"));
    const result = await Effect.runPromise(
      service.import({
        workspaceId: "repo",
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
        workspaceId: "repo",
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
        workspaceId: "repo",
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

    const refreshed = await Effect.runPromise(
      service.get({ workspaceId: "repo", repoPath: "/repo", sourceId: "42" }),
    );

    expect(refreshed).toMatchObject({ sourceId: "42", revision: "3", linkedTaskId: "TASK-42" });
  });

  test("rejects an item returned outside the configured repository during refresh", async () => {
    const { service, sources } = fixture();
    sources.set("1", { ...issue("1"), scope: "github.com/other/repo" });

    await expect(
      Effect.runPromise(service.get({ workspaceId: "repo", repoPath: "/repo", sourceId: "1" })),
    ).rejects.toThrow("outside the configured repository");
  });
});
