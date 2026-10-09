import { expect, test } from "bun:test";
import { repoConfigSchema, type WorkspaceSession } from "@openducktor/contracts";
import { Effect } from "effect";
import { createSqliteTaskStoreHarness } from "../../adapters/sqlite/sqlite-task-store-test-support";
import { createSqliteWorkspaceSessionStore } from "../../adapters/sqlite/sqlite-workspace-session-store";
import { createAgentSessionRecord } from "../../ports/task-store-port-contract.test-support";
import { createLiveSessionRootRefsReader } from "./live-session-root-refs";

test("reload roots recover workflow roles and repository scope from persisted owners", async () => {
  const harness = await createSqliteTaskStoreHarness();
  try {
    const { repoPath } = harness;
    const store = createSqliteWorkspaceSessionStore(harness.contextProvider);
    const config = repoConfigSchema.parse({
      workspaceId: "fairnest",
      workspaceName: "Fairnest",
      repoPath,
    });
    const task = await Effect.runPromise(
      harness.store.createTask({
        repoPath,
        task: { title: "Permissions", issueType: "task", priority: 2, aiReviewEnabled: true },
      }),
    );
    const workflowSessions = (["spec", "planner", "build", "qa"] as const).map((role) =>
      createAgentSessionRecord({
        role,
        externalSessionId: `workflow-${role}`,
        workingDirectory: `${repoPath}/${role}`,
      }),
    );
    for (const session of workflowSessions)
      await Effect.runPromise(
        harness.store.upsertAgentSession({ repoPath, taskId: task.id, session }),
      );
    const chat: WorkspaceSession = {
      id: "repository-chat",
      runtimeKind: "opencode",
      externalSessionId: "repository-native",
      executionTarget: { kind: "local_repo_root", workingDirectory: repoPath },
      roleSnapshot: null,
      selectedModel: null,
      generatedTitle: null,
      manualTitle: null,
      createdAt: 1,
      updatedAt: 1,
      speed: "standard",
      archivedAt: null,
    };
    for (const session of [chat, { ...chat, id: "draft", externalSessionId: null }])
      await Effect.runPromise(store.create({ repoPath, workspaceId: config.workspaceId, session }));
    const roots = await Effect.runPromise(
      createLiveSessionRootRefsReader({
        store,
        taskStore: harness.store,
        settings: { getRepoConfigByRepoPath: () => Effect.succeed(config) },
      })(repoPath),
    );
    expect(roots).toEqual([
      {
        repoPath,
        runtimeKind: "opencode",
        externalSessionId: "repository-native",
        workingDirectory: repoPath,
        sessionScope: { kind: "repository" },
      },
      ...workflowSessions.map((session) => ({
        repoPath,
        runtimeKind: session.runtimeKind,
        externalSessionId: session.externalSessionId,
        workingDirectory: session.workingDirectory,
        sessionScope: { kind: "workflow" as const, taskId: task.id, role: session.role },
      })),
    ]);
  } finally {
    await harness.cleanup();
  }
});
