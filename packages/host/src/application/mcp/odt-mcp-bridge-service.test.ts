import { ODT_MCP_TOOL_NAMES, type RepoConfig, type TaskCard } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { createEventPublishingTaskService } from "../tasks/event-publishing-task-service";
import type { TaskSyncService } from "../tasks/sync/task-sync-service";
import type { TaskService } from "../tasks/task-service";
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
const createWorkspaceSettingsService = (): WorkspaceSettingsService =>
  ({
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
    getRepoConfigByRepoPath() {
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
  }) as Pick<
    WorkspaceSettingsService,
    "getRepoConfig" | "getRepoConfigByRepoPath" | "listWorkspaces"
  > as unknown as WorkspaceSettingsService;
const createTaskService = (service: Partial<TaskService>): TaskService =>
  service as unknown as TaskService;
const createOdtMcpBridgeServiceForTest = (input: Parameters<typeof createOdtMcpBridgeService>[0]) =>
  createOdtMcpBridgeService(input);
describe("createOdtMcpBridgeService", () => {
  test("reports MCP tool coverage and workspaces", async () => {
    const service = createOdtMcpBridgeServiceForTest({
      taskService: {} as TaskService,
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
  test("sets a spec through repo-scoped task service calls", async () => {
    const calls: unknown[] = [];
    let currentTask = taskCard();
    const taskService = createTaskService({
      listTasks(input: unknown) {
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
      setSpec(input: unknown) {
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
    const baseTaskService = createTaskService({
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
      createTask(input: unknown) {
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
      listTasks(input: unknown) {
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
      linkPullRequest(input: unknown) {
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
