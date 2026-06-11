import { ODT_MCP_TOOL_NAMES, type RepoConfig, type TaskCard } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
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
  test("publishes a host-compatible task event after external task creation", async () => {
    const events: unknown[] = [];
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
      taskSyncService: {
        publishExternalTaskCreated(repoPath, taskId) {
          return Effect.sync(() => {
            events.push({ repoPath, taskId });
          });
        },
      },
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
    expect(events).toEqual([{ repoPath: "/repo", taskId: "task-new" }]);
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
