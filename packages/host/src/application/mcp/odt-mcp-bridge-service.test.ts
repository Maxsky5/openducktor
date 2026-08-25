import { createFocusedTestService } from "../../test-support/focused-service";
import {
  createTaskServiceTestDouble,
  createTaskServiceWithMutationProgressTestDouble,
} from "../../test-support/task-service-test-double";
import { ODT_MCP_TOOL_NAMES, type RepoConfig, type TaskCard } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { TaskAssetError } from "../../effect/task-asset-error";
import type { TaskAssetReadService } from "../task-assets/task-asset-read-service";
import type { CreateTaskUseCaseInput } from "../tasks/task-inputs";
import { createEventPublishingTaskService } from "../tasks/event-publishing-task-service";
import type { TaskSyncService } from "../tasks/sync/task-sync-service";
import type { WorkspaceSettingsService } from "../workspaces/workspace-settings-service";
import { createOdtMcpBridgeService } from "./odt-mcp-bridge-service";

const repoConfig: RepoConfig = {
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  defaultRuntimeKind: "opencode",
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: { providers: {} },
  hooks: { preStart: [], postComplete: [] },
  devServers: [],
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
};
const taskCard = (overrides: Partial<TaskCard> = {}): TaskCard => ({
  id: "task-1",
  title: "Add bridge",
  description: "Wire the bridge",
  status: "open",
  priority: 2,
  issueType: "feature",
  aiReviewEnabled: true,
  availableActions: [],
  labels: ["mcp"],
  subtaskIds: [],
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: false, completed: false },
    planner: { required: false, canSkip: true, available: false, completed: false },
    builder: { required: true, canSkip: false, available: false, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  createdAt: "2026-05-10T10:00:00.000Z",
  updatedAt: "2026-05-10T10:00:00.000Z",
  ...overrides,
});
type OdtWorkspaceSettingsService = Parameters<
  typeof createOdtMcpBridgeService
>[0]["workspaceSettingsService"];
type OdtTaskService = Parameters<typeof createOdtMcpBridgeService>[0]["taskService"];

const createWorkspaceSettingsService = (): OdtWorkspaceSettingsService =>
  createFocusedTestService<WorkspaceSettingsService>()({
    listWorkspaces() {
      return Effect.tryPromise({
        try: async () => {
          return [
            {
              workspaceId: "repo",
              workspaceName: "Repo",
              repoPath: "/repo",
              isActive: true,
              hasConfig: true,
              configuredWorktreeBasePath: null,
              defaultWorktreeBasePath: null,
              effectiveWorktreeBasePath: null,
            },
          ];
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    getRepoConfig() {
      return Effect.tryPromise({
        try: async () => {
          return repoConfig;
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
  });
const createTaskService = <Overrides extends Partial<OdtTaskService>>(overrides: Overrides) =>
  createTaskServiceTestDouble(overrides);
type TestOdtMcpBridgeServiceInput = Omit<
  Parameters<typeof createOdtMcpBridgeService>[0],
  "taskAssetReadService"
> & {
  taskAssetReadService?: TaskAssetReadService;
};
const createOdtMcpBridgeServiceForTest = (input: TestOdtMcpBridgeServiceInput) =>
  createOdtMcpBridgeService({
    taskAssetReadService: input.taskAssetReadService ?? {
      read: () => Effect.succeed(null),
      readBatch: () => Effect.succeed({ kind: "missing", assetIds: [] }),
    },
    ...input,
  });
describe("createOdtMcpBridgeService", () => {
  test("reports MCP tool coverage and workspaces", async () => {
    const service = createOdtMcpBridgeServiceForTest({
      taskService: createTaskService({}),
      workspaceSettingsService: createWorkspaceSettingsService(),
    });
    await expect(Effect.runPromise(service.ready())).resolves.toEqual({
      bridgeVersion: 1,
      toolNames: [...ODT_MCP_TOOL_NAMES],
    });
    await expect(Effect.runPromise(service.getWorkspaces({}))).resolves.toMatchObject({
      workspaces: [{ workspaceId: "repo", repoPath: "/repo" }],
    });
  });
  test("reads a requested asset batch in caller order through the owned task scope", async () => {
    const firstAssetId = "28cb7c3d-5ec4-47e8-bffe-090223eae3b7";
    const secondAssetId = "96d20c03-a470-47f6-9472-1a1d34cd23df";
    const calls: unknown[] = [];
    const taskAssetReadService: TaskAssetReadService = {
      read: () => Effect.succeed(null),
      readBatch(input) {
        calls.push(input);
        return Effect.succeed({
          kind: "available",
          assets: [
            {
              assetId: firstAssetId,
              asset: {
                bytes: Uint8Array.from([1, 2, 3]),
                mediaType: "image/png" as const,
                headers: {
                  "Cache-Control": "private, no-store",
                  "Content-Disposition": 'inline; filename="first.png"',
                  "Content-Type": "image/png",
                  "X-Content-Type-Options": "nosniff",
                },
              },
            },
            {
              assetId: secondAssetId,
              asset: {
                bytes: Uint8Array.from([4, 5]),
                mediaType: "image/webp" as const,
                headers: {
                  "Cache-Control": "private, no-store",
                  "Content-Disposition": 'inline; filename="second.webp"',
                  "Content-Type": "image/webp",
                  "X-Content-Type-Options": "nosniff",
                },
              },
            },
          ],
        });
      },
    };
    const service = createOdtMcpBridgeServiceForTest({
      taskService: createTaskService({
        listTasks: () => Effect.succeed([taskCard()]),
      }),
      taskAssetReadService,
      workspaceSettingsService: createWorkspaceSettingsService(),
    });

    await expect(
      Effect.runPromise(
        service.invoke("odt_read_task_assets", {
          workspaceId: "repo",
          taskId: "Add bridge",
          assetIds: [firstAssetId, secondAssetId],
        }),
      ),
    ).resolves.toEqual({
      assets: [
        {
          assetId: firstAssetId,
          mediaType: "image/png",
          byteSize: 3,
          dataBase64: "AQID",
        },
        {
          assetId: secondAssetId,
          mediaType: "image/webp",
          byteSize: 2,
          dataBase64: "BAU=",
        },
      ],
    });
    expect(calls).toEqual([
      {
        workspaceId: "repo",
        taskId: "task-1",
        scope: "description",
        assetIds: [firstAssetId, secondAssetId],
      },
    ]);
  });

  test("fails the whole asset batch when any requested asset is unavailable", async () => {
    const availableAssetId = "28cb7c3d-5ec4-47e8-bffe-090223eae3b7";
    const missingAssetId = "96d20c03-a470-47f6-9472-1a1d34cd23df";
    const service = createOdtMcpBridgeServiceForTest({
      taskService: createTaskService({
        listTasks: () => Effect.succeed([taskCard()]),
      }),
      taskAssetReadService: {
        read: () => Effect.succeed(null),
        readBatch: () =>
          Effect.succeed({
            kind: "missing",
            assetIds: [missingAssetId],
          }),
      },
      workspaceSettingsService: createWorkspaceSettingsService(),
    });

    const error = await Effect.runPromise(
      Effect.flip(
        service.invoke("odt_read_task_assets", {
          workspaceId: "repo",
          taskId: "task-1",
          assetIds: [availableAssetId, missingAssetId],
        }),
      ),
    );
    expect(error).toMatchObject({
      message: "One or more requested task description assets were not found.",
      details: {
        field: "assetIds",
        taskId: "task-1",
        missingAssetIds: [missingAssetId],
      },
    });
  });

  test("keeps task asset read failures actionable at the bridge boundary", async () => {
    const assetId = "28cb7c3d-5ec4-47e8-bffe-090223eae3b7";
    const service = createOdtMcpBridgeServiceForTest({
      taskService: createTaskService({
        listTasks: () => Effect.succeed([taskCard()]),
      }),
      taskAssetReadService: {
        read: () => Effect.succeed(null),
        readBatch() {
          return Effect.fail(
            new TaskAssetError({
              operation: "serve",
              code: "database",
              taskId: "task-1",
              assetIds: [assetId],
              failedPhase: "validate_registered_byte_size",
              durableState: "unchanged",
              retryAllowed: false,
              message: "Task asset content does not match its registry entry.",
            }),
          );
        },
      },
      workspaceSettingsService: createWorkspaceSettingsService(),
    });

    const error = await Effect.runPromise(
      Effect.flip(
        service.invoke("odt_read_task_assets", {
          workspaceId: "repo",
          taskId: "task-1",
          assetIds: [assetId],
        }),
      ),
    );
    expect(error).toMatchObject({
      _tag: "HostOperationError",
      operation: "odt_mcp_bridge.read_task_assets",
      message: "Task asset content does not match its registry entry.",
      details: {
        taskId: "task-1",
        assetIds: [assetId],
        failedPhase: "validate_registered_byte_size",
      },
    });
  });

  test("returns an actionable validation error for an oversized asset batch", async () => {
    const assetId = "28cb7c3d-5ec4-47e8-bffe-090223eae3b7";
    const service = createOdtMcpBridgeServiceForTest({
      taskService: createTaskService({
        listTasks: () => Effect.succeed([taskCard()]),
      }),
      taskAssetReadService: {
        read: () => Effect.succeed(null),
        readBatch: () =>
          Effect.succeed({
            kind: "too_large",
            requestedBytes: 20 * 1024 * 1024 + 1,
            maxBytes: 20 * 1024 * 1024,
          }),
      },
      workspaceSettingsService: createWorkspaceSettingsService(),
    });

    const error = await Effect.runPromise(
      Effect.flip(
        service.invoke("odt_read_task_assets", {
          workspaceId: "repo",
          taskId: "task-1",
          assetIds: [assetId],
        }),
      ),
    );
    expect(error).toMatchObject({
      _tag: "HostValidationError",
      field: "assetIds",
      message: "Requested task description assets exceed the per-call byte limit.",
      details: {
        field: "assetIds",
        taskId: "task-1",
        requestedBytes: 20 * 1024 * 1024 + 1,
        maxBytes: 20 * 1024 * 1024,
      },
    });
  });
  test("sets a spec through repo-scoped task service calls", async () => {
    const calls: unknown[] = [];
    let currentTask = taskCard();
    const taskService = createTaskService({
      listTasks(input: Parameters<OdtTaskService["listTasks"]>[0]) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "listTasks", input });
            return [currentTask];
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setSpec(input: Parameters<OdtTaskService["setSpec"]>[0]) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "setSpec", input });
            currentTask = taskCard({
              status: "spec_ready",
              documentSummary: {
                spec: { has: true },
                plan: { has: false },
                qaReport: { has: false, verdict: "not_reviewed" },
              },
              updatedAt: "2026-05-10T10:01:00.000Z",
            });
            return {
              markdown: "## Spec",
              updatedAt: "2026-05-10T10:01:00.000Z",
              revision: 1,
            };
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    });
    const service = createOdtMcpBridgeServiceForTest({
      taskService,
      workspaceSettingsService: createWorkspaceSettingsService(),
    });
    await expect(
      Effect.runPromise(
        service.invoke("odt_set_spec", {
          workspaceId: "repo",
          taskId: "Add bridge",
          markdown: "## Spec",
        }),
      ),
    ).resolves.toEqual({
      task: {
        id: "task-1",
        title: "Add bridge",
        description: "Wire the bridge",
        status: "spec_ready",
        priority: 2,
        issueType: "feature",
        aiReviewEnabled: true,
        labels: ["mcp"],
        createdAt: "2026-05-10T10:00:00.000Z",
        updatedAt: "2026-05-10T10:01:00.000Z",
      },
      document: {
        markdown: "## Spec",
        updatedAt: "2026-05-10T10:01:00.000Z",
        revision: 1,
      },
    });
    expect(calls).toEqual([
      { type: "listTasks", input: { repoPath: "/repo" } },
      { type: "setSpec", input: { repoPath: "/repo", taskId: "task-1", markdown: "## Spec" } },
      { type: "listTasks", input: { repoPath: "/repo" } },
    ]);
  });
  test("uses the task facade to publish one event for MCP document and create mutations", async () => {
    const events: Array<{ kind: "created" | "updated"; taskIds: string[] }> = [];
    const baseTaskService = createTaskServiceWithMutationProgressTestDouble({
      createTask: () => Effect.succeed(taskCard({ id: "task-new", title: "New task" })),
      listTasks: () => Effect.succeed([taskCard()]),
      setSpec: () =>
        Effect.succeed({
          markdown: "## Spec",
          revision: 1,
          updatedAt: "2026-07-22T00:00:00.000Z",
        }),
    });
    const taskSyncService: Pick<
      TaskSyncService,
      "publishExternalTaskCreated" | "publishTasksUpdated" | "syncRepoPullRequests"
    > = {
      publishExternalTaskCreated(_repoPath, taskId) {
        return Effect.sync(() => {
          events.push({ kind: "created", taskIds: [taskId] });
        });
      },
      publishTasksUpdated(_repoPath, changes) {
        return Effect.sync(() => {
          events.push({ kind: "updated", taskIds: changes.taskIds });
        });
      },
      syncRepoPullRequests() {
        return Effect.succeed({ ran: true, changedTaskIds: [] });
      },
    };
    const service = createOdtMcpBridgeServiceForTest({
      taskService: createEventPublishingTaskService({
        taskService: baseTaskService,
        taskSyncService,
      }),
      workspaceSettingsService: createWorkspaceSettingsService(),
    });

    await Effect.runPromise(
      service.invoke("odt_set_spec", {
        workspaceId: "repo",
        taskId: "task-1",
        markdown: "## Spec",
      }),
    );
    await Effect.runPromise(
      service.invoke("odt_create_task", {
        workspaceId: "repo",
        title: "New task",
        issueType: "task",
        priority: 2,
        description: "Created by MCP",
        labels: [],
        aiReviewEnabled: true,
      }),
    );

    expect(events).toEqual([
      { kind: "updated", taskIds: ["task-1"] },
      { kind: "created", taskIds: ["task-new"] },
    ]);
  });
  test("keeps internal plan affected ids out of the MCP response", async () => {
    const taskService = createTaskService({
      listTasks: () => Effect.succeed([taskCard({ id: "epic-1", issueType: "epic" })]),
      setPlan: () =>
        Effect.succeed({
          document: {
            markdown: "# Plan",
            revision: 2,
            updatedAt: "2026-07-22T00:00:00.000Z",
          },
          changes: { taskIds: ["epic-1", "old-child"], removedTaskIds: ["old-child"] },
        }),
    });
    const service = createOdtMcpBridgeServiceForTest({
      taskService,
      workspaceSettingsService: createWorkspaceSettingsService(),
    });

    const result = await Effect.runPromise(
      service.invoke("odt_set_plan", {
        workspaceId: "repo",
        taskId: "epic-1",
        markdown: "# Plan",
      }),
    );

    expect(result).toMatchObject({
      task: { id: "epic-1" },
      document: { markdown: "# Plan", revision: 2 },
      createdSubtaskIds: [],
    });
    expect(result).not.toHaveProperty("affectedTaskIds");
    if (!("document" in result)) {
      throw new Error("expected odt_set_plan document response");
    }
    expect(result.document).not.toHaveProperty("affectedTaskIds");
  });
  test("creates through the host-owned task service facade", async () => {
    const taskService = createTaskService({
      createTask(input: CreateTaskUseCaseInput) {
        return Effect.tryPromise({
          try: async () => {
            expect(input).toEqual({
              repoPath: "/repo",
              task: {
                title: "New task",
                issueType: "task",
                priority: 2,
                description: "Created by MCP",
                labels: ["mcp"],
                aiReviewEnabled: true,
              },
            });
            return taskCard({ id: "task-new", title: "New task", description: "Created by MCP" });
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    });
    const service = createOdtMcpBridgeServiceForTest({
      taskService,
      workspaceSettingsService: createWorkspaceSettingsService(),
    });
    await expect(
      Effect.runPromise(
        service.invoke("odt_create_task", {
          workspaceId: "repo",
          title: "New task",
          issueType: "task",
          priority: 2,
          description: "Created by MCP",
          labels: ["mcp"],
          aiReviewEnabled: true,
        }),
      ),
    ).resolves.toMatchObject({ task: { id: "task-new", title: "New task" } });
  });
  test("orders task search results by recent activity before applying the result limit", async () => {
    const taskService = createTaskService({
      listTasks(input: Parameters<OdtTaskService["listTasks"]>[0]) {
        expect(input).toEqual({ repoPath: "/repo" });
        return Effect.succeed([
          taskCard({
            id: "open-newer",
            title: "Open newer",
            status: "open",
            updatedAt: "2026-05-10T10:03:00.000Z",
          }),
          taskCard({
            id: "open-middle",
            title: "Open middle",
            status: "open",
            updatedAt: "2026-05-10T10:02:00.000Z",
          }),
          taskCard({
            id: "open-older",
            title: "Open older",
            status: "open",
            updatedAt: "2026-05-10T10:01:00.000Z",
          }),
          taskCard({
            id: "recent-progress",
            title: "Recent progress",
            status: "in_progress",
            updatedAt: "2026-05-10T12:00:00.000Z",
          }),
        ]);
      },
    });
    const service = createOdtMcpBridgeServiceForTest({
      taskService,
      workspaceSettingsService: createWorkspaceSettingsService(),
    });

    await expect(
      Effect.runPromise(
        service.invoke("odt_search_tasks", {
          workspaceId: "repo",
          limit: 2,
        }),
      ),
    ).resolves.toMatchObject({
      results: [{ task: { id: "recent-progress" } }, { task: { id: "open-newer" } }],
      limit: 2,
      totalCount: 4,
      hasMore: true,
    });
  });
  test("links pull requests through the task service provider lookup path", async () => {
    let currentTask = taskCard({ status: "human_review" });
    const linkPullRequestCalls: unknown[] = [];
    const taskService = createTaskService({
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            return [currentTask];
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      linkPullRequest(input: Parameters<OdtTaskService["linkPullRequest"]>[0]) {
        return Effect.tryPromise({
          try: async () => {
            linkPullRequestCalls.push(input);
            currentTask = taskCard({ status: "human_review" });
            return {
              providerId: "github",
              number: 42,
              url: "https://github.com/open/ducktor/pull/42",
              state: "open",
              createdAt: "2026-05-10T10:02:00.000Z",
              updatedAt: "2026-05-10T10:02:00.000Z",
            };
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    });
    const service = createOdtMcpBridgeServiceForTest({
      taskService,
      workspaceSettingsService: createWorkspaceSettingsService(),
    });
    await expect(
      Effect.runPromise(
        service.invoke("odt_set_pull_request", {
          workspaceId: "repo",
          taskId: "task-1",
          providerId: "github",
          number: 42,
        }),
      ),
    ).resolves.toMatchObject({
      pullRequest: {
        providerId: "github",
        number: 42,
        url: "https://github.com/open/ducktor/pull/42",
        state: "open",
      },
    });
    expect(linkPullRequestCalls).toEqual([
      {
        repoPath: "/repo",
        taskId: "task-1",
        providerId: "github",
        number: 42,
      },
    ]);
  });
});
