import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { BeadsCommandJsonOutput } from "../../infrastructure/beads/task-store/beads-raw-issue";
import type { BeadsCliContext } from "./beads-cli-context";
import { createBeadsTaskRepository } from "./beads-task-repository";
import {
  createTestBeadsCliContext as createBeadsCliContext,
  createExistingTestBeadsCliContext as createExistingBeadsCliContext,
  createFakeBd,
  createTestToolDiscoveryPort as createToolDiscoveryPort,
} from "./test-support/beads-test-support";

const encodedMarkdown = (markdown: string): string => gzipSync(markdown).toString("base64");
type RawTaskFixture = { [key in string]?: BeadsCommandJsonOutput };
const rawTask = (overrides: RawTaskFixture = {}): RawTaskFixture => ({
  id: "task-1",
  title: "Task",
  status: "open",
  priority: 0,
  issue_type: "task",
  labels: [],
  updated_at: "2026-05-10T00:00:00Z",
  created_at: "2026-05-10T00:00:00Z",
  ...overrides,
});
const createTestBeadsTaskRepository = (
  input: Omit<Parameters<typeof createBeadsTaskRepository>[0], "toolDiscovery">,
  toolDiscovery = createToolDiscoveryPort(),
) =>
  createBeadsTaskRepository({
    toolDiscovery,
    ...input,
  });
describe("createBeadsTaskRepository", () => {
  test("delegates close to the Beads CLI context manager", async () => {
    const context = await createExistingBeadsCliContext();
    const stoppedServers: Array<{
      pid: number;
      serverStatePath: string;
    }> = [];
    const port = createTestBeadsTaskRepository({
      resolveCliContext: () => Effect.succeed(context),
      runBdJson() {
        return Effect.succeed({ path: context.beadsDir });
      },
      stopSharedDoltServer(sharedServer, serverStatePath) {
        return Effect.sync(() => {
          stoppedServers.push({
            pid: sharedServer.pid,
            serverStatePath,
          });
        });
      },
    });
    await Effect.runPromise(port.diagnoseRepoStore?.({ repoPath: "/repo" }));
    await expect(Effect.runPromise(port.close())).resolves.toEqual({ stoppedSharedDoltServers: 1 });
    expect(stoppedServers).toEqual([
      {
        pid: process.pid,
        serverStatePath: "/config/beads/shared-server/server.json",
      },
    ]);
  });
  test("diagnoses a ready Beads repo store from bd where", async () => {
    const context = await createExistingBeadsCliContext();
    const calls: Array<{
      repoPath: string;
      args: string[];
      context?: BeadsCliContext;
    }> = [];
    const port = createTestBeadsTaskRepository({
      resolveCliContext: () =>
        Effect.tryPromise({
          try: async () => {
            return context;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        }),
      runBdJson(repoPath, args, callContext) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({
              repoPath,
              args,
              ...(callContext === undefined ? {} : { context: callContext }),
            });
            return { path: context.beadsDir };
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
    await expect(
      Effect.runPromise(port.diagnoseRepoStore?.({ repoPath: "/repo" })),
    ).resolves.toEqual({
      category: "healthy",
      status: "ready",
      isReady: true,
      detail: "Beads attachment and shared Dolt server are healthy.",
      attachment: {
        path: context.beadsDir,
        databaseName: "odt_repo_123456789abc",
      },
      sharedServer: {
        host: "127.0.0.1",
        port: 36000,
        ownershipState: "owned_by_current_process",
      },
    });
    expect(calls).toEqual([{ repoPath: "/repo", args: ["where"], context }]);
  });
  test("passes configured workspace id into Beads context resolution", async () => {
    const context = await createExistingBeadsCliContext();
    const requestedWorkspaceIds: Array<string | null | undefined> = [];
    const port = createTestBeadsTaskRepository({
      resolveWorkspaceIdForRepoPath(repoPath) {
        return Effect.tryPromise({
          try: async () => {
            expect(repoPath).toBe("/repo");
            return "openducktor";
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      resolveCliContext(_repoPath, options) {
        return Effect.tryPromise({
          try: async () => {
            requestedWorkspaceIds.push(options?.workspaceId);
            return context;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      runBdJson(_repoPath, _args, callContext) {
        return Effect.tryPromise({
          try: async () => {
            expect(callContext).toBe(context);
            return { path: context.beadsDir };
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
    await expect(
      Effect.runPromise(port.diagnoseRepoStore?.({ repoPath: "/repo" })),
    ).resolves.toMatchObject({
      category: "healthy",
      status: "ready",
    });
    expect(requestedWorkspaceIds).toEqual(["openducktor"]);
  });
  test("trims and forwards resolved workspace id for path-edge repo inputs", async () => {
    const context = await createExistingBeadsCliContext();
    const repoPath = path.join(
      await mkdtemp(path.join(tmpdir(), "Repo With Spaces-")),
      "C-Users\\Max Sky\\Repo Name",
    );
    const workspaceResolverCalls: string[] = [];
    const contextRequests: Array<{
      repoPath: string;
      workspaceId: string | null | undefined;
      requireSharedServer: boolean | undefined;
    }> = [];
    const port = createTestBeadsTaskRepository({
      resolveWorkspaceIdForRepoPath(requestedRepoPath) {
        return Effect.sync(() => {
          workspaceResolverCalls.push(requestedRepoPath);
          return "  workspace-id-with-spaces  ";
        });
      },
      resolveCliContext(requestedRepoPath, options) {
        return Effect.sync(() => {
          contextRequests.push({
            repoPath: requestedRepoPath,
            workspaceId: options?.workspaceId,
            requireSharedServer: options?.requireSharedServer,
          });
          return context;
        });
      },
      runBdJson(_repoPath, _args, callContext) {
        return Effect.sync(() => {
          expect(callContext).toBe(context);
          return { path: context.beadsDir };
        });
      },
    });

    await expect(
      Effect.runPromise(port.diagnoseRepoStore?.({ repoPath, prepare: true })),
    ).resolves.toMatchObject({
      category: "healthy",
      status: "ready",
    });

    expect(workspaceResolverCalls).toEqual([repoPath]);
    expect(contextRequests).toEqual([
      {
        repoPath,
        workspaceId: "workspace-id-with-spaces",
        requireSharedServer: true,
      },
    ]);
  });

  test("prepares the shared Dolt server when diagnostics request preparation", async () => {
    const context = await createExistingBeadsCliContext();
    const requestedSharedServerModes: Array<boolean | undefined> = [];
    const port = createTestBeadsTaskRepository({
      resolveCliContext(_repoPath, options) {
        return Effect.tryPromise({
          try: async () => {
            requestedSharedServerModes.push(options?.requireSharedServer);
            return context;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      runBdJson() {
        return Effect.tryPromise({
          try: async () => {
            return { path: context.beadsDir };
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
    await expect(
      Effect.runPromise(port.diagnoseRepoStore?.({ repoPath: "/repo", prepare: true })),
    ).resolves.toMatchObject({
      category: "healthy",
      status: "ready",
    });
    expect(requestedSharedServerModes).toEqual([true]);
  });
  test("uses configured workspace id for default bd command runner", async () => {
    const context = await createExistingBeadsCliContext();
    const binDir = await mkdtemp(path.join(tmpdir(), "odt-fake-bd-bin-"));
    const bdPath = await createFakeBd(
      binDir,
      `console.log(JSON.stringify([{ id: "task-1", title: "Task", status: "open", priority: 0, issue_type: "task", labels: [], updated_at: "2026-05-10T00:00:00Z", created_at: "2026-05-10T00:00:00Z" }]));\n`,
    );
    context.tools = { beads: bdPath };
    const requestedWorkspaceIds: Array<string | null | undefined> = [];
    const port = createTestBeadsTaskRepository({
      resolveWorkspaceIdForRepoPath() {
        return Effect.tryPromise({
          try: async () => {
            return "openducktor";
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      resolveCliContext(_repoPath, options) {
        return Effect.tryPromise({
          try: async () => {
            requestedWorkspaceIds.push(options?.workspaceId);
            return context;
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
    const tasks = await Effect.runPromise(port.listTasks({ repoPath: "/repo" }));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe("task-1");
    expect(requestedWorkspaceIds).toEqual(["openducktor"]);
  });
  test("reuses the prepared Beads context across default bd task-list commands", async () => {
    const context = await createExistingBeadsCliContext();
    const binDir = await mkdtemp(path.join(tmpdir(), "odt-fake-bd-bin-"));
    const bdPath = await createFakeBd(
      binDir,
      `const args = process.argv.slice(2);
if (args.join(" ") === "list --limit 0 --json") {
  console.log(JSON.stringify([{ id: "task-1", title: "Task", status: "open", priority: 0, issue_type: "task", labels: [], updated_at: "2026-05-10T00:00:00Z", created_at: "2026-05-10T00:00:00Z" }]));
} else if (args[0] === "list" && args.includes("--status") && args.includes("closed") && args.includes("--closed-after")) {
  console.log("[]");
} else {
  console.error(\`unexpected bd args: \${args.join(" ")}\`);
  process.exit(1);
}
`,
    );
    context.tools = { beads: bdPath };
    const requestedWorkspaceIds: Array<string | null | undefined> = [];
    const port = createTestBeadsTaskRepository({
      resolveWorkspaceIdForRepoPath() {
        return Effect.tryPromise({
          try: async () => {
            return "openducktor";
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      resolveCliContext(_repoPath, options) {
        return Effect.tryPromise({
          try: async () => {
            requestedWorkspaceIds.push(options?.workspaceId);
            return context;
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
    await expect(
      Effect.runPromise(port.listTasks({ repoPath: "/repo", doneVisibleDays: 1 })),
    ).resolves.toHaveLength(1);
    await expect(
      Effect.runPromise(port.listTasks({ repoPath: "/repo", doneVisibleDays: 2 })),
    ).resolves.toHaveLength(1);
    expect(requestedWorkspaceIds).toEqual(["openducktor"]);
  });
  test("reuses fresh task lists and invalidates them after metadata mutations", async () => {
    let listCalls = 0;
    const port = createTestBeadsTaskRepository({
      now: () => new Date("2026-05-10T12:00:00.000Z"),
      runBdJson(_repoPath, args) {
        return Effect.tryPromise({
          try: async () => {
            if (args[0] === "list") {
              listCalls += 1;
              return [rawTask({ title: `Task ${listCalls}` })];
            }
            if (args[0] === "show") {
              return [rawTask({ metadata: {} })];
            }
            return [];
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
    const first = await Effect.runPromise(port.listTasks({ repoPath: "/repo" }));
    const firstTask = first[0];
    if (!firstTask) {
      throw new Error("expected cached task");
    }
    firstTask.title = "Mutated by caller";
    const cached = await Effect.runPromise(port.listTasks({ repoPath: "/repo" }));
    await Effect.runPromise(
      port.setSpecDocument({ repoPath: "/repo", taskId: "task-1", markdown: "# Spec" }),
    );
    const refreshed = await Effect.runPromise(port.listTasks({ repoPath: "/repo" }));
    expect(listCalls).toBe(2);
    expect(cached[0]?.title).toBe("Task 1");
    expect(refreshed[0]?.title).toBe("Task 2");
  });
  test("resolves Dolt before context resolution for task commands that require the shared server", async () => {
    const port = createTestBeadsTaskRepository(
      {
        resolveCliContext() {
          return Effect.tryPromise({
            try: async () => {
              throw new Error("Dolt preflight should run before context resolution.");
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
      },
      createToolDiscoveryPort(["dolt"]),
    );
    await expect(Effect.runPromise(port.listTasks({ repoPath: "/repo" }))).rejects.toThrow(
      "dolt not found. Checked OPENDUCKTOR_DOLT_PATH, PATH. Install dolt and ensure it is available on PATH, or set OPENDUCKTOR_DOLT_PATH.",
    );
  });
  test("diagnoses existing Beads store without requiring Dolt when preparation is disabled", async () => {
    const context = await createExistingBeadsCliContext();
    const port = createTestBeadsTaskRepository(
      {
        resolveCliContext: () => Effect.succeed(context),
        runBdJson() {
          return Effect.succeed({ path: context.beadsDir });
        },
      },
      createToolDiscoveryPort(["dolt"]),
    );

    await expect(
      Effect.runPromise(port.diagnoseRepoStore?.({ repoPath: "/repo", prepare: false })),
    ).resolves.toMatchObject({
      category: "healthy",
      status: "ready",
    });
  });
  test("diagnoses Beads repo store verification errors from bd where", async () => {
    const context = await createExistingBeadsCliContext();
    const port = createTestBeadsTaskRepository({
      resolveCliContext: () =>
        Effect.tryPromise({
          try: async () => {
            return context;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        }),
      runBdJson() {
        return Effect.tryPromise({
          try: async () => {
            return { error: "Beads attachment is missing" };
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
    await expect(
      Effect.runPromise(port.diagnoseRepoStore?.({ repoPath: "/repo" })),
    ).resolves.toMatchObject({
      category: "attachment_verification_failed",
      status: "degraded",
      isReady: false,
      detail: "Beads attachment is missing",
      attachment: {
        path: context.beadsDir,
        databaseName: "odt_repo_123456789abc",
      },
    });
  });
  test("diagnoses a missing managed Beads attachment before running bd", async () => {
    const attachmentRoot = await mkdtemp(path.join(tmpdir(), "odt-beads-missing-test-"));
    const context = createBeadsCliContext(path.join(attachmentRoot, ".beads"));
    const port = createTestBeadsTaskRepository({
      resolveCliContext: () =>
        Effect.tryPromise({
          try: async () => {
            return context;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        }),
      runBdJson() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("bd should not run when the managed attachment is absent");
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
    await expect(
      Effect.runPromise(port.diagnoseRepoStore?.({ repoPath: "/repo" })),
    ).resolves.toMatchObject({
      category: "missing_attachment",
      status: "blocking",
      isReady: false,
      detail: `Beads attachment is missing at ${context.beadsDir}`,
      attachment: {
        path: context.beadsDir,
        databaseName: "odt_repo_123456789abc",
      },
    });
  });
  test("runs bd list commands and parses Beads issues into task cards", async () => {
    const calls: Array<{
      repoPath: string;
      args: string[];
    }> = [];
    const port = createTestBeadsTaskRepository({
      now: () => new Date("2026-05-10T12:00:00Z"),
      runBdJson(repoPath, args) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ repoPath, args });
            if (args.includes("--closed-after")) {
              return [
                {
                  id: "closed-1",
                  title: "Closed task",
                  status: "closed",
                  priority: 2,
                  issue_type: "task",
                  updated_at: "2026-05-09T00:00:00Z",
                  created_at: "2026-05-01T00:00:00Z",
                },
                {
                  id: "task-2",
                  title: "Duplicate child",
                  status: "open",
                  priority: 2,
                  issue_type: "task",
                  updated_at: "2026-05-09T00:00:00Z",
                  created_at: "2026-05-01T00:00:00Z",
                },
              ];
            }
            return [
              {
                id: "event-1",
                title: "Event",
                status: "open",
                issue_type: "event",
                updated_at: "2026-05-09T00:00:00Z",
                created_at: "2026-05-01T00:00:00Z",
              },
              {
                id: "epic-1",
                title: "Epic",
                description: "Body",
                notes: "Notes",
                status: "spec_ready",
                priority: 1,
                issue_type: "epic",
                labels: [" beta ", "alpha", "alpha"],
                owner: "max",
                metadata: {
                  openducktor: {
                    qaRequired: false,
                    targetBranch: { remote: "origin", branch: "main" },
                    delivery: {
                      linkedPullRequest: {
                        providerId: "github",
                        number: 42,
                        url: "https://github.com/openai/openducktor/pull/42",
                        state: "open",
                        createdAt: "2026-05-01T00:00:00Z",
                        updatedAt: "2026-05-02T00:00:00Z",
                      },
                    },
                    documents: {
                      spec: [
                        {
                          markdown: encodedMarkdown("# Spec"),
                          encoding: "gzip-base64-v1",
                          updatedAt: "2026-05-03T00:00:00Z",
                        },
                      ],
                      implementationPlan: [{ markdown: "", updatedAt: "2026-05-04T00:00:00Z" }],
                      qaReports: [
                        {
                          markdown: "Needs work",
                          verdict: "rejected",
                          updatedAt: "2026-05-05T00:00:00Z",
                        },
                      ],
                    },
                    agentSessions: [
                      {
                        externalSessionId: "old",
                        role: "build",
                        startedAt: "2026-05-01T00:00:00Z",
                        runtimeKind: "opencode",
                        workingDirectory: "/repo",
                        selectedModel: null,
                      },
                      {
                        externalSessionId: "new",
                        role: "qa",
                        startedAt: "2026-05-02T00:00:00Z",
                        runtimeKind: "opencode",
                        workingDirectory: "/repo",
                        selectedModel: null,
                      },
                    ],
                  },
                },
                updated_at: "2026-05-09T00:00:00Z",
                created_at: "2026-05-01T00:00:00Z",
              },
              {
                id: "task-2",
                title: "Child task",
                status: "open",
                priority: 2,
                issue_type: "task",
                dependencies: [{ type: "parent-child", depends_on_id: "epic-1" }],
                updated_at: "2026-05-09T00:00:00Z",
                created_at: "2026-05-01T00:00:00Z",
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
    });
    const tasks = await Effect.runPromise(
      port.listTasks({ repoPath: "/repo", doneVisibleDays: 2 }),
    );
    expect(calls).toEqual([
      { repoPath: "/repo", args: ["list", "--limit", "0"] },
      {
        repoPath: "/repo",
        args: ["list", "--status", "closed", "--closed-after", "2026-05-08", "--limit", "0"],
      },
    ]);
    expect(tasks).toHaveLength(3);
    expect(tasks[0]).toMatchObject({
      id: "epic-1",
      labels: ["alpha", "beta"],
      assignee: "max",
      subtaskIds: ["task-2"],
      aiReviewEnabled: false,
      targetBranch: { remote: "origin", branch: "main" },
      pullRequest: { number: 42 },
      documentSummary: {
        spec: { has: true, updatedAt: "2026-05-03T00:00:00Z" },
        plan: { has: false },
        qaReport: { has: true, verdict: "rejected", updatedAt: "2026-05-05T00:00:00Z" },
      },
      agentSessions: [
        { externalSessionId: "new", role: "qa" },
        { externalSessionId: "old", role: "build" },
      ],
    });
    expect(tasks[1]).toMatchObject({ id: "task-2", parentId: "epic-1" });
    expect(tasks[2]).toMatchObject({ id: "closed-1", status: "closed" });
  });
  test("uses the all-tasks bd query when kanban visibility is not requested", async () => {
    const calls: string[][] = [];
    const port = createTestBeadsTaskRepository({
      runBdJson(_repoPath, args) {
        return Effect.tryPromise({
          try: async () => {
            calls.push(args);
            return [];
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
    await expect(Effect.runPromise(port.listTasks({ repoPath: "/repo" }))).resolves.toEqual([]);
    expect(calls).toEqual([["list", "--all", "--limit", "0"]]);
  });
  test("lists only open pull request sync candidates", async () => {
    const port = createTestBeadsTaskRepository({
      runBdJson() {
        return Effect.tryPromise({
          try: async () => {
            return [
              {
                id: "task-open-pr",
                title: "Open PR",
                status: "human_review",
                priority: 2,
                issue_type: "task",
                metadata: {
                  openducktor: {
                    pullRequest: {
                      providerId: "github",
                      number: 42,
                      url: "https://github.com/openai/openducktor/pull/42",
                      state: "open",
                      createdAt: "2026-05-01T00:00:00Z",
                      updatedAt: "2026-05-02T00:00:00Z",
                    },
                  },
                },
                updated_at: "2026-05-09T00:00:00Z",
                created_at: "2026-05-01T00:00:00Z",
              },
              {
                id: "task-closed-pr",
                title: "Closed task",
                status: "closed",
                priority: 2,
                issue_type: "task",
                metadata: {
                  openducktor: {
                    pullRequest: {
                      providerId: "github",
                      number: 43,
                      url: "https://github.com/openai/openducktor/pull/43",
                      state: "open",
                      createdAt: "2026-05-01T00:00:00Z",
                      updatedAt: "2026-05-02T00:00:00Z",
                    },
                  },
                },
                updated_at: "2026-05-09T00:00:00Z",
                created_at: "2026-05-01T00:00:00Z",
              },
              {
                id: "task-merged-pr",
                title: "Merged PR",
                status: "human_review",
                priority: 2,
                issue_type: "task",
                metadata: {
                  openducktor: {
                    pullRequest: {
                      providerId: "github",
                      number: 44,
                      url: "https://github.com/openai/openducktor/pull/44",
                      state: "merged",
                      createdAt: "2026-05-01T00:00:00Z",
                      updatedAt: "2026-05-02T00:00:00Z",
                    },
                  },
                },
                updated_at: "2026-05-09T00:00:00Z",
                created_at: "2026-05-01T00:00:00Z",
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
    });
    const listPullRequestSyncCandidates = port.listPullRequestSyncCandidates;
    if (!listPullRequestSyncCandidates) {
      throw new Error("Expected node Beads task store to expose listPullRequestSyncCandidates");
    }
    await expect(
      Effect.runPromise(listPullRequestSyncCandidates({ repoPath: "/repo" })),
    ).resolves.toMatchObject([{ id: "task-open-pr", pullRequest: { number: 42, state: "open" } }]);
  });
  test("keeps invalid target branch metadata as a task-local error", async () => {
    const port = createTestBeadsTaskRepository({
      runBdJson() {
        return Effect.tryPromise({
          try: async () => {
            return [
              {
                id: "task-1",
                title: "Task",
                status: "open",
                priority: 2,
                issue_type: "task",
                metadata: { openducktor: { targetBranch: { branch: "" } } },
                updated_at: "2026-05-09T00:00:00Z",
                created_at: "2026-05-01T00:00:00Z",
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
    });
    const tasks = await Effect.runPromise(port.listTasks({ repoPath: "/repo" }));
    expect(tasks[0]?.targetBranch).toBeUndefined();
    expect(tasks[0]?.targetBranchError).toContain("Invalid openducktor.targetBranch metadata");
  });
  test("loads one task with bd show", async () => {
    const calls: Array<{
      repoPath: string;
      args: string[];
    }> = [];
    const port = createTestBeadsTaskRepository({
      runBdJson(repoPath, args) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ repoPath, args });
            return [
              {
                id: "task-1",
                title: "Task",
                status: "blocked",
                priority: 2,
                issue_type: "task",
                updated_at: "2026-05-10T00:00:00Z",
                created_at: "2026-05-01T00:00:00Z",
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
    });
    const task = await Effect.runPromise(port.getTask({ repoPath: "/repo", taskId: "task-1" }));
    expect(calls).toEqual([{ repoPath: "/repo", args: ["show", "--id", "task-1"] }]);
    expect(task).toMatchObject({ id: "task-1", status: "blocked" });
  });
  test("persists spec documents in openducktor metadata with encoded markdown", async () => {
    const calls: Array<{
      repoPath: string;
      args: string[];
    }> = [];
    const port = createTestBeadsTaskRepository({
      now: () => new Date("2026-05-10T12:00:00.000Z"),
      runBdJson(repoPath, args) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ repoPath, args });
            if (args[0] === "show") {
              return [
                {
                  id: "task-1",
                  title: "Task",
                  status: "open",
                  priority: 2,
                  issue_type: "task",
                  metadata: {
                    other: true,
                    openducktor: {
                      documents: {
                        spec: [
                          {
                            markdown: "Old",
                            updatedAt: "2026-05-09T00:00:00.000Z",
                            revision: 4,
                          },
                        ],
                      },
                    },
                  },
                  updated_at: "2026-05-10T00:00:00Z",
                  created_at: "2026-05-01T00:00:00Z",
                },
              ];
            }
            return [];
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
    await expect(
      Effect.runPromise(
        port.setSpecDocument({ repoPath: "/repo", taskId: "task-1", markdown: " # Spec " }),
      ),
    ).resolves.toEqual({
      markdown: "# Spec",
      updatedAt: "2026-05-10T12:00:00.000Z",
      revision: 5,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ repoPath: "/repo", args: ["show", "--id", "task-1"] });
    const updateArgs = calls[1]?.args;
    expect(updateArgs?.slice(0, 2)).toEqual(["update", "--metadata"]);
    expect(updateArgs?.slice(-2)).toEqual(["--", "task-1"]);
    const metadata = JSON.parse(String(updateArgs?.[2]));
    const entry = metadata.openducktor.documents.spec[0];
    expect(metadata.other).toBe(true);
    expect(entry).toMatchObject({
      encoding: "gzip-base64-v1",
      updatedAt: "2026-05-10T12:00:00.000Z",
      updatedBy: "planner-agent",
      sourceTool: "odt_set_spec",
      revision: 5,
    });
    expect(gunzipSync(Buffer.from(entry.markdown, "base64")).toString("utf8")).toBe("# Spec");
  });
  test("loads task metadata documents and delivery fields with bd show", async () => {
    const calls: Array<{
      repoPath: string;
      args: string[];
    }> = [];
    const port = createTestBeadsTaskRepository({
      runBdJson(repoPath, args) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ repoPath, args });
            return [
              {
                id: "task-1",
                title: "Task",
                status: "open",
                priority: 2,
                issue_type: "task",
                metadata: {
                  openducktor: {
                    targetBranch: { remote: "origin", branch: "main" },
                    documents: {
                      spec: [
                        {
                          markdown: "# Spec v1",
                          updatedAt: "2026-05-09T00:00:00.000Z",
                          revision: 1,
                        },
                        {
                          markdown: encodedMarkdown("# Spec v2"),
                          encoding: "gzip-base64-v1",
                          updatedAt: "2026-05-10T00:00:00.000Z",
                          revision: 2,
                        },
                      ],
                      implementationPlan: [{ markdown: "# Plan", revision: 1 }],
                      qaReports: [
                        {
                          markdown: encodedMarkdown("Looks good"),
                          encoding: "gzip-base64-v1",
                          verdict: "approved",
                          updatedAt: "2026-05-11T00:00:00.000Z",
                          revision: 3,
                        },
                      ],
                    },
                    delivery: {
                      linkedPullRequest: {
                        providerId: "github",
                        number: 42,
                        url: "https://github.com/openai/openducktor/pull/42",
                        state: "merged",
                        createdAt: "2026-05-01T00:00:00.000Z",
                        updatedAt: "2026-05-02T00:00:00.000Z",
                      },
                      directMerge: {
                        method: "squash",
                        sourceBranch: "feature/task-1",
                        targetBranch: { remote: "origin", branch: "main" },
                        mergedAt: "2026-05-12T00:00:00.000Z",
                      },
                    },
                    agentSessions: [
                      {
                        externalSessionId: "older",
                        role: "spec",
                        startedAt: "2026-05-01T00:00:00.000Z",
                        runtimeKind: "opencode",
                        workingDirectory: "/repo",
                        selectedModel: null,
                      },
                      {
                        externalSessionId: "newer",
                        role: "build",
                        startedAt: "2026-05-02T00:00:00.000Z",
                        runtimeKind: "opencode",
                        workingDirectory: "/repo",
                        selectedModel: null,
                      },
                    ],
                  },
                },
                updated_at: "2026-05-10T00:00:00Z",
                created_at: "2026-05-01T00:00:00Z",
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
    });
    await expect(
      Effect.runPromise(port.getTaskMetadata({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toEqual({
      spec: { markdown: "# Spec v2", updatedAt: "2026-05-10T00:00:00.000Z", revision: 2 },
      plan: { markdown: "# Plan", revision: 1 },
      targetBranch: { remote: "origin", branch: "main" },
      qaReport: {
        markdown: "Looks good",
        verdict: "approved",
        updatedAt: "2026-05-11T00:00:00.000Z",
        revision: 3,
      },
      pullRequest: {
        providerId: "github",
        number: 42,
        url: "https://github.com/openai/openducktor/pull/42",
        state: "merged",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      },
      directMerge: {
        method: "squash",
        sourceBranch: "feature/task-1",
        targetBranch: { remote: "origin", branch: "main" },
        mergedAt: "2026-05-12T00:00:00.000Z",
      },
      agentSessions: [
        expect.objectContaining({ externalSessionId: "newer", role: "build" }),
        expect.objectContaining({ externalSessionId: "older", role: "spec" }),
      ],
    });
    expect(calls).toEqual([{ repoPath: "/repo", args: ["show", "--id", "task-1"] }]);
  });
  test("records QA outcomes with status and encoded latest report metadata", async () => {
    const calls: Array<{
      repoPath: string;
      args: string[];
    }> = [];
    const port = createTestBeadsTaskRepository({
      now: () => new Date("2026-05-10T12:00:00.000Z"),
      runBdJson(repoPath, args) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ repoPath, args });
            if (args[0] === "show" && calls.length === 1) {
              return [
                {
                  id: "task-1",
                  title: "Task",
                  status: "ai_review",
                  priority: 2,
                  issue_type: "task",
                  metadata: {
                    openducktor: {
                      documents: {
                        qaReports: [
                          {
                            markdown: "Old QA",
                            verdict: "rejected",
                            updatedAt: "2026-05-09T00:00:00.000Z",
                            revision: 4,
                          },
                        ],
                      },
                    },
                  },
                  updated_at: "2026-05-10T00:00:00Z",
                  created_at: "2026-05-01T00:00:00Z",
                },
              ];
            }
            if (args[0] === "show") {
              return [
                {
                  id: "task-1",
                  title: "Task",
                  status: "human_review",
                  priority: 2,
                  issue_type: "task",
                  metadata: {
                    openducktor: {
                      documents: {
                        qaReports: [
                          {
                            markdown: encodedMarkdown("Looks good"),
                            encoding: "gzip-base64-v1",
                            verdict: "approved",
                            updatedAt: "2026-05-10T12:00:00.000Z",
                            revision: 5,
                          },
                        ],
                      },
                    },
                  },
                  updated_at: "2026-05-10T00:00:00Z",
                  created_at: "2026-05-01T00:00:00Z",
                },
              ];
            }
            return [];
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
    await expect(
      Effect.runPromise(
        port.recordQaOutcome({
          repoPath: "/repo",
          taskId: "task-1",
          status: "human_review",
          markdown: " Looks good ",
          verdict: "approved",
        }),
      ),
    ).resolves.toMatchObject({
      id: "task-1",
      status: "human_review",
      documentSummary: {
        qaReport: {
          has: true,
          verdict: "approved",
          updatedAt: "2026-05-10T12:00:00.000Z",
        },
      },
    });
    expect(calls).toHaveLength(3);
    expect(calls[1]?.args.slice(0, 5)).toEqual([
      "update",
      "--status",
      "human_review",
      "--metadata",
      expect.any(String),
    ]);
    expect(calls[1]?.args.slice(-2)).toEqual(["--", "task-1"]);
    const metadata = JSON.parse(String(calls[1]?.args[4]));
    const entry = metadata.openducktor.documents.qaReports[0];
    expect(entry).toMatchObject({
      encoding: "gzip-base64-v1",
      verdict: "approved",
      updatedAt: "2026-05-10T12:00:00.000Z",
      updatedBy: "qa-agent",
      sourceTool: "odt_qa_approved",
      revision: 5,
    });
    expect(gunzipSync(Buffer.from(entry.markdown, "base64")).toString("utf8")).toBe("Looks good");
  });
  test("upserts agent sessions in metadata by external session id", async () => {
    const calls: Array<{
      repoPath: string;
      args: string[];
    }> = [];
    const port = createTestBeadsTaskRepository({
      runBdJson(repoPath, args) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ repoPath, args });
            if (args[0] === "show") {
              return [
                {
                  id: "task-1",
                  title: "Task",
                  status: "in_progress",
                  priority: 2,
                  issue_type: "task",
                  metadata: {
                    other: true,
                    openducktor: {
                      documents: { spec: [] },
                      agentSessions: [
                        {
                          externalSessionId: "session-1",
                          role: "spec",
                          startedAt: "2026-05-09T12:00:00.000Z",
                          runtimeKind: "opencode",
                          workingDirectory: "/repo",
                          selectedModel: null,
                        },
                        {
                          externalSessionId: "session-2",
                          role: "qa",
                          startedAt: "2026-05-08T12:00:00.000Z",
                          runtimeKind: "opencode",
                          workingDirectory: "/repo",
                          selectedModel: null,
                        },
                      ],
                    },
                  },
                  updated_at: "2026-05-10T00:00:00Z",
                  created_at: "2026-05-01T00:00:00Z",
                },
              ];
            }
            return [];
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
    const upsertAgentSession = port.upsertAgentSession;
    if (!upsertAgentSession) {
      throw new Error("Expected node Beads task store to expose upsertAgentSession");
    }
    await expect(
      Effect.runPromise(
        upsertAgentSession({
          repoPath: "/repo",
          taskId: "task-1",
          session: {
            externalSessionId: " session-1 ",
            role: "build",
            startedAt: "2026-05-10T12:00:00.000Z",
            runtimeKind: "opencode",
            workingDirectory: " /repo/task-1 ",
            selectedModel: null,
          },
        }),
      ),
    ).resolves.toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.args.slice(0, 2)).toEqual(["update", "--metadata"]);
    expect(calls[1]?.args.slice(-2)).toEqual(["--", "task-1"]);
    const metadata = JSON.parse(String(calls[1]?.args[2]));
    expect(metadata.other).toBe(true);
    expect(metadata.openducktor.documents).toEqual({ spec: [] });
    expect(metadata.openducktor.agentSessions).toEqual([
      {
        externalSessionId: "session-1",
        role: "build",
        startedAt: "2026-05-10T12:00:00.000Z",
        runtimeKind: "opencode",
        workingDirectory: "/repo/task-1",
        selectedModel: null,
      },
      {
        externalSessionId: "session-2",
        role: "qa",
        startedAt: "2026-05-08T12:00:00.000Z",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
        selectedModel: null,
      },
    ]);
  });
  test("clears pull request metadata and removes legacy delivery metadata", async () => {
    const calls: Array<{
      repoPath: string;
      args: string[];
    }> = [];
    const port = createTestBeadsTaskRepository({
      runBdJson(repoPath, args) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ repoPath, args });
            if (args[0] === "show") {
              return [
                {
                  id: "task-1",
                  title: "Task",
                  status: "human_review",
                  priority: 2,
                  issue_type: "task",
                  metadata: {
                    openducktor: {
                      pullRequest: {
                        providerId: "github",
                        number: 42,
                        url: "https://github.com/openai/openducktor/pull/42",
                        state: "open",
                        createdAt: "2026-05-01T00:00:00.000Z",
                        updatedAt: "2026-05-02T00:00:00.000Z",
                      },
                      delivery: {
                        linkedPullRequest: {
                          providerId: "github",
                          number: 42,
                          url: "https://github.com/openai/openducktor/pull/42",
                          state: "open",
                          createdAt: "2026-05-01T00:00:00.000Z",
                          updatedAt: "2026-05-02T00:00:00.000Z",
                        },
                      },
                      documents: { spec: [] },
                    },
                  },
                  updated_at: "2026-05-10T00:00:00Z",
                  created_at: "2026-05-01T00:00:00Z",
                },
              ];
            }
            return [];
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
    const setPullRequest = port.setPullRequest;
    if (!setPullRequest) {
      throw new Error("Expected node Beads task store to expose setPullRequest");
    }
    await expect(
      Effect.runPromise(setPullRequest({ repoPath: "/repo", taskId: "task-1", pullRequest: null })),
    ).resolves.toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.args.slice(0, 2)).toEqual(["update", "--metadata"]);
    const metadata = JSON.parse(String(calls[1]?.args[2]));
    expect(metadata.openducktor.pullRequest).toBeUndefined();
    expect(metadata.openducktor.delivery).toBeUndefined();
    expect(metadata.openducktor.documents).toEqual({ spec: [] });
  });
  test("clears agent sessions by role", async () => {
    const calls: Array<{
      repoPath: string;
      args: string[];
    }> = [];
    const port = createTestBeadsTaskRepository({
      runBdJson(repoPath, args) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ repoPath, args });
            if (args[0] === "show") {
              return [
                {
                  id: "task-1",
                  title: "Task",
                  status: "in_progress",
                  priority: 2,
                  issue_type: "task",
                  metadata: {
                    openducktor: {
                      agentSessions: [
                        {
                          externalSessionId: "build-1",
                          role: "build",
                          startedAt: "2026-05-10T12:00:00.000Z",
                          runtimeKind: "opencode",
                          workingDirectory: "/repo/task-1",
                          selectedModel: null,
                        },
                        {
                          externalSessionId: "spec-1",
                          role: "spec",
                          startedAt: "2026-05-09T12:00:00.000Z",
                          runtimeKind: "opencode",
                          workingDirectory: "/repo",
                          selectedModel: null,
                        },
                      ],
                      documents: { spec: [] },
                    },
                  },
                  updated_at: "2026-05-10T00:00:00Z",
                  created_at: "2026-05-01T00:00:00Z",
                },
              ];
            }
            return [];
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
    const clearAgentSessionsByRoles = port.clearAgentSessionsByRoles;
    if (!clearAgentSessionsByRoles) {
      throw new Error("Expected node Beads task store to expose clearAgentSessionsByRoles");
    }
    await expect(
      Effect.runPromise(
        clearAgentSessionsByRoles({ repoPath: "/repo", taskId: "task-1", roles: ["build", "qa"] }),
      ),
    ).resolves.toBe(true);
    expect(calls).toHaveLength(2);
    const metadata = JSON.parse(String(calls[1]?.args[2]));
    expect(metadata.openducktor.agentSessions).toEqual([
      {
        externalSessionId: "spec-1",
        role: "spec",
        startedAt: "2026-05-09T12:00:00.000Z",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
        selectedModel: null,
      },
    ]);
    expect(metadata.openducktor.documents).toEqual({ spec: [] });
  });
  test("clears workflow documents and QA reports", async () => {
    const calls: Array<{
      repoPath: string;
      args: string[];
    }> = [];
    const port = createTestBeadsTaskRepository({
      runBdJson(repoPath, args) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ repoPath, args });
            if (args[0] === "show") {
              return [
                {
                  id: "task-1",
                  title: "Task",
                  status: "in_progress",
                  priority: 2,
                  issue_type: "task",
                  metadata: {
                    openducktor: {
                      documents: {
                        spec: [{ markdown: encodedMarkdown("# Spec"), encoding: "gzip-base64-v1" }],
                        implementationPlan: [{ markdown: "# Plan" }],
                        qaReports: [{ markdown: "Looks good", verdict: "approved" }],
                        extra: [{ value: true }],
                      },
                    },
                  },
                  updated_at: "2026-05-10T00:00:00Z",
                  created_at: "2026-05-01T00:00:00Z",
                },
              ];
            }
            return [];
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
    const clearWorkflowDocuments = port.clearWorkflowDocuments;
    const clearQaReports = port.clearQaReports;
    if (!clearWorkflowDocuments || !clearQaReports) {
      throw new Error("Expected node Beads task store to expose document cleanup methods");
    }
    await expect(
      Effect.runPromise(clearWorkflowDocuments({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toBe(true);
    await expect(
      Effect.runPromise(clearQaReports({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toBe(true);
    expect(calls).toHaveLength(4);
    const workflowMetadata = JSON.parse(String(calls[1]?.args[2]));
    expect(workflowMetadata.openducktor.documents).toEqual({ extra: [{ value: true }] });
    const qaMetadata = JSON.parse(String(calls[3]?.args[2]));
    expect(qaMetadata.openducktor.documents).toEqual({
      spec: [{ markdown: encodedMarkdown("# Spec"), encoding: "gzip-base64-v1" }],
      implementationPlan: [{ markdown: "# Plan" }],
      extra: [{ value: true }],
    });
  });
  test("setting pull request metadata clears direct merge metadata", async () => {
    const calls: Array<{
      repoPath: string;
      args: string[];
    }> = [];
    const port = createTestBeadsTaskRepository({
      runBdJson(repoPath, args) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ repoPath, args });
            if (args[0] === "show") {
              return [
                {
                  id: "task-1",
                  title: "Task",
                  status: "human_review",
                  priority: 2,
                  issue_type: "task",
                  metadata: {
                    openducktor: {
                      directMerge: {
                        method: "squash",
                        sourceBranch: "odt/task-1",
                        targetBranch: { branch: "main" },
                        mergedAt: "2026-05-10T11:00:00.000Z",
                      },
                    },
                  },
                  updated_at: "2026-05-10T00:00:00Z",
                  created_at: "2026-05-01T00:00:00Z",
                },
              ];
            }
            return [];
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
    const setPullRequest = port.setPullRequest;
    if (!setPullRequest) {
      throw new Error("Expected node Beads task store to expose setPullRequest");
    }
    await expect(
      Effect.runPromise(
        setPullRequest({
          repoPath: "/repo",
          taskId: "task-1",
          pullRequest: {
            providerId: "github",
            number: 42,
            url: "https://github.com/openai/openducktor/pull/42",
            state: "merged",
            createdAt: "2026-05-01T00:00:00.000Z",
            updatedAt: "2026-05-02T00:00:00.000Z",
            mergedAt: "2026-05-10T11:00:00.000Z",
          },
        }),
      ),
    ).resolves.toBe(true);
    const metadata = JSON.parse(String(calls[1]?.args[2]));
    expect(metadata.openducktor.directMerge).toBeUndefined();
    expect(metadata.openducktor.pullRequest).toMatchObject({ number: 42, state: "merged" });
  });
  test("setting direct merge metadata clears pull request metadata", async () => {
    const calls: Array<{
      repoPath: string;
      args: string[];
    }> = [];
    const port = createTestBeadsTaskRepository({
      runBdJson(repoPath, args) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ repoPath, args });
            if (args[0] === "show") {
              return [
                {
                  id: "task-1",
                  title: "Task",
                  status: "human_review",
                  priority: 2,
                  issue_type: "task",
                  metadata: {
                    openducktor: {
                      pullRequest: {
                        providerId: "github",
                        number: 42,
                        url: "https://github.com/openai/openducktor/pull/42",
                        state: "merged",
                        createdAt: "2026-05-01T00:00:00.000Z",
                        updatedAt: "2026-05-02T00:00:00.000Z",
                      },
                    },
                  },
                  updated_at: "2026-05-10T00:00:00Z",
                  created_at: "2026-05-01T00:00:00Z",
                },
              ];
            }
            return [];
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
    const setDirectMerge = port.setDirectMerge;
    if (!setDirectMerge) {
      throw new Error("Expected node Beads task store to expose setDirectMerge");
    }
    await expect(
      Effect.runPromise(
        setDirectMerge({
          repoPath: "/repo",
          taskId: "task-1",
          directMerge: {
            method: "squash",
            sourceBranch: "odt/task-1",
            targetBranch: { branch: "main" },
            mergedAt: "2026-05-10T11:00:00.000Z",
          },
        }),
      ),
    ).resolves.toBe(true);
    const metadata = JSON.parse(String(calls[1]?.args[2]));
    expect(metadata.openducktor.pullRequest).toBeUndefined();
    expect(metadata.openducktor.directMerge).toMatchObject({
      method: "squash",
      sourceBranch: "odt/task-1",
    });
  });
  test("returns document-level errors for malformed task metadata documents", async () => {
    const port = createTestBeadsTaskRepository({
      runBdJson() {
        return Effect.tryPromise({
          try: async () => {
            return [
              {
                id: "task-1",
                title: "Task",
                status: "open",
                priority: 2,
                issue_type: "task",
                metadata: {
                  openducktor: {
                    documents: {
                      spec: { unexpected: true },
                      implementationPlan: [{ markdown: "not-base64", encoding: "gzip-base64-v1" }],
                      qaReports: [{ markdown: "QA", verdict: "maybe" }],
                    },
                  },
                },
                updated_at: "2026-05-10T00:00:00Z",
                created_at: "2026-05-01T00:00:00Z",
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
    });
    const metadata = await Effect.runPromise(
      port.getTaskMetadata({ repoPath: "/repo", taskId: "task-1" }),
    );
    expect(metadata.spec.error).toBe(
      "Failed to read openducktor.documents.spec: expected an array",
    );
    expect(metadata.plan.error).toContain(
      "Failed to decode openducktor.documents.implementationPlan[0]",
    );
    expect(metadata.qaReport).toMatchObject({
      markdown: "QA",
      verdict: "not_reviewed",
      error: "openducktor.documents.qaReports[0].verdict must be one of approved or rejected",
    });
  });
  test("rejects malformed existing plan document revisions before overwriting metadata", async () => {
    const calls: string[][] = [];
    const port = createTestBeadsTaskRepository({
      runBdJson(_repoPath, args) {
        return Effect.tryPromise({
          try: async () => {
            calls.push(args);
            return [
              {
                id: "task-1",
                title: "Task",
                status: "open",
                priority: 2,
                issue_type: "task",
                metadata: {
                  openducktor: {
                    documents: {
                      implementationPlan: [{ markdown: "# Plan", revision: 0 }],
                    },
                  },
                },
                updated_at: "2026-05-10T00:00:00Z",
                created_at: "2026-05-01T00:00:00Z",
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
    });
    await expect(
      Effect.runPromise(
        port.setPlanDocument({ repoPath: "/repo", taskId: "task-1", markdown: "# Plan" }),
      ),
    ).rejects.toThrow(
      "Invalid existing openducktor.documents.implementationPlan metadata at index 0: revision must be a positive integer",
    );
    expect(calls).toEqual([["show", "--id", "task-1"]]);
  });
  test("fails fast for invalid Beads issue status", async () => {
    const port = createTestBeadsTaskRepository({
      runBdJson() {
        return Effect.tryPromise({
          try: async () => {
            return [
              {
                id: "task-1",
                title: "Task",
                status: "unknown",
                priority: 2,
                issue_type: "task",
                updated_at: "2026-05-09T00:00:00Z",
                created_at: "2026-05-01T00:00:00Z",
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
    });
    await expect(Effect.runPromise(port.listTasks({ repoPath: "/repo" }))).rejects.toThrow(
      "Invalid Beads status for task task-1",
    );
  });
  test("creates tasks, persists qaRequired metadata, and reloads the created issue", async () => {
    const calls: Array<{
      repoPath: string;
      args: string[];
    }> = [];
    const port = createTestBeadsTaskRepository({
      runBdJson(repoPath, args) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ repoPath, args });
            if (args[0] === "create") {
              return {
                id: "task-1",
                title: "Created task",
                status: "open",
                priority: 3,
                issue_type: "bug",
                metadata: { existing: true },
                updated_at: "2026-05-10T00:00:00Z",
                created_at: "2026-05-10T00:00:00Z",
              };
            }
            if (args[0] === "update") {
              return [];
            }
            if (args[0] === "show") {
              return [
                {
                  id: "task-1",
                  title: "Created task",
                  status: "open",
                  priority: 3,
                  issue_type: "bug",
                  labels: ["backend"],
                  metadata: { openducktor: { qaRequired: false } },
                  updated_at: "2026-05-10T00:00:00Z",
                  created_at: "2026-05-10T00:00:00Z",
                },
              ];
            }
            throw new Error(`Unexpected command: ${args.join(" ")}`);
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
    const created = await Effect.runPromise(
      port.createTask({
        repoPath: "/repo",
        task: {
          title: "Created task",
          issueType: "bug",
          priority: 3,
          aiReviewEnabled: false,
          description: "  Fix it  ",
          labels: [" backend ", "backend"],
          parentId: "  ",
        },
      }),
    );
    expect(calls).toEqual([
      {
        repoPath: "/repo",
        args: [
          "create",
          "Created task",
          "--type",
          "bug",
          "--priority",
          "3",
          "--description",
          "Fix it",
          "--labels",
          "backend",
        ],
      },
      {
        repoPath: "/repo",
        args: [
          "update",
          "--metadata",
          JSON.stringify({ existing: true, openducktor: { qaRequired: false } }),
          "--",
          "task-1",
        ],
      },
      { repoPath: "/repo", args: ["show", "--id", "task-1"] },
    ]);
    expect(created).toMatchObject({
      id: "task-1",
      issueType: "bug",
      aiReviewEnabled: false,
      labels: ["backend"],
    });
  });
  test("updates task fields, labels, metadata, and reloads the task", async () => {
    const calls: Array<{
      repoPath: string;
      args: string[];
    }> = [];
    const port = createTestBeadsTaskRepository({
      runBdJson(repoPath, args) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ repoPath, args });
            if (
              args[0] === "show" &&
              calls.filter((call) => call.args[0] === "show").length === 1
            ) {
              return [
                {
                  id: "task-1",
                  title: "Task",
                  status: "open",
                  priority: 2,
                  issue_type: "task",
                  labels: ["old"],
                  metadata: {
                    openducktor: {
                      qaRequired: true,
                      documents: { spec: [{ markdown: "spec" }] },
                    },
                  },
                  updated_at: "2026-05-10T00:00:00Z",
                  created_at: "2026-05-01T00:00:00Z",
                },
              ];
            }
            if (args[0] === "update") {
              return [];
            }
            if (args[0] === "show") {
              return [
                {
                  id: "task-1",
                  title: "Updated",
                  description: "Updated body",
                  notes: "Note",
                  status: "open",
                  priority: 4,
                  issue_type: "bug",
                  labels: ["new"],
                  owner: "max",
                  parent: "epic-1",
                  metadata: {
                    openducktor: {
                      qaRequired: false,
                      targetBranch: { remote: "origin", branch: "main" },
                    },
                  },
                  updated_at: "2026-05-11T00:00:00Z",
                  created_at: "2026-05-01T00:00:00Z",
                },
              ];
            }
            throw new Error(`Unexpected command: ${args.join(" ")}`);
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
    const updated = await Effect.runPromise(
      port.updateTask({
        repoPath: "/repo",
        taskId: "task-1",
        patch: {
          title: "Updated",
          description: "Updated body",
          notes: "Note",
          priority: 4,
          issueType: "bug",
          assignee: "max",
          parentId: " epic-1 ",
          labels: [" new ", "new"],
          aiReviewEnabled: false,
          targetBranch: { remote: "origin", branch: "main" },
        },
      }),
    );
    expect(calls).toEqual([
      {
        repoPath: "/repo",
        args: [
          "update",
          "--title",
          "Updated",
          "--description",
          "Updated body",
          "--notes",
          "Note",
          "--priority",
          "4",
          "--type",
          "bug",
          "--assignee",
          "max",
          "--parent",
          "epic-1",
          "--set-labels",
          "new",
          "--",
          "task-1",
        ],
      },
      { repoPath: "/repo", args: ["show", "--id", "task-1"] },
      {
        repoPath: "/repo",
        args: [
          "update",
          "--metadata",
          JSON.stringify({
            openducktor: {
              qaRequired: false,
              documents: { spec: [{ markdown: "spec" }] },
              targetBranch: { remote: "origin", branch: "main" },
            },
          }),
          "--",
          "task-1",
        ],
      },
      { repoPath: "/repo", args: ["show", "--id", "task-1"] },
    ]);
    expect(updated).toMatchObject({
      id: "task-1",
      title: "Updated",
      issueType: "bug",
      labels: ["new"],
      aiReviewEnabled: false,
      targetBranch: { remote: "origin", branch: "main" },
    });
  });
  test("returns the current task without update commands for no-op empty labels", async () => {
    const calls: string[][] = [];
    const port = createTestBeadsTaskRepository({
      runBdJson(_repoPath, args) {
        return Effect.tryPromise({
          try: async () => {
            calls.push(args);
            return [
              {
                id: "task-1",
                title: "Task",
                status: "open",
                priority: 2,
                issue_type: "task",
                labels: [],
                updated_at: "2026-05-10T00:00:00Z",
                created_at: "2026-05-01T00:00:00Z",
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
    });
    const updated = await Effect.runPromise(
      port.updateTask({
        repoPath: "/repo",
        taskId: "task-1",
        patch: { labels: [] },
      }),
    );
    expect(calls).toEqual([["show", "--id", "task-1"]]);
    expect(updated).toMatchObject({ id: "task-1", labels: [] });
  });
  test("transitions task status and reloads the task", async () => {
    const calls: Array<{
      repoPath: string;
      args: string[];
    }> = [];
    const port = createTestBeadsTaskRepository({
      runBdJson(repoPath, args) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ repoPath, args });
            if (args[0] === "update") {
              return [];
            }
            if (args[0] === "show") {
              return [
                {
                  id: "task-1",
                  title: "Task",
                  status: "in_progress",
                  priority: 2,
                  issue_type: "task",
                  updated_at: "2026-05-10T00:00:00Z",
                  created_at: "2026-05-01T00:00:00Z",
                },
              ];
            }
            throw new Error(`Unexpected command: ${args.join(" ")}`);
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
    const updated = await Effect.runPromise(
      port.transitionTask({
        repoPath: "/repo",
        taskId: "task-1",
        status: "in_progress",
      }),
    );
    expect(calls).toEqual([
      { repoPath: "/repo", args: ["update", "--status", "in_progress", "--", "task-1"] },
      { repoPath: "/repo", args: ["show", "--id", "task-1"] },
    ]);
    expect(updated).toMatchObject({ id: "task-1", status: "in_progress" });
  });
  test("deletes a task with the non-json Beads delete command", async () => {
    const calls: Array<{
      repoPath: string;
      args: string[];
    }> = [];
    const port = createTestBeadsTaskRepository({
      runBd(repoPath, args) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ repoPath, args });
            return "";
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
    await expect(
      Effect.runPromise(
        port.deleteTask({ repoPath: "/repo", taskId: "task-1", deleteSubtasks: false }),
      ),
    ).resolves.toBe(true);
    expect(calls).toEqual([{ repoPath: "/repo", args: ["delete", "--force", "--", "task-1"] }]);
  });
  test("passes cascade when deleting subtasks is requested", async () => {
    const calls: string[][] = [];
    const port = createTestBeadsTaskRepository({
      runBd(_repoPath, args) {
        return Effect.tryPromise({
          try: async () => {
            calls.push(args);
            return "";
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
    await expect(
      Effect.runPromise(
        port.deleteTask({ repoPath: "/repo", taskId: "epic-1", deleteSubtasks: true }),
      ),
    ).resolves.toBe(true);
    expect(calls).toEqual([["delete", "--force", "--cascade", "--", "epic-1"]]);
  });
  test("propagates Beads delete failures", async () => {
    const port = createTestBeadsTaskRepository({
      runBd() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("bd delete failed");
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
    await expect(
      Effect.runPromise(
        port.deleteTask({ repoPath: "/repo", taskId: "task-1", deleteSubtasks: false }),
      ),
    ).rejects.toThrow("bd delete failed");
  });
});
