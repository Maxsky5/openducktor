import { expect, test } from "bun:test";
import { repoConfigSchema, type WorkspaceSession } from "@openducktor/contracts";
import { Effect, Result } from "effect";
import {
  workspaceSessionCatalog,
  workspaceSessionOwnership,
} from "../../test-support/workspace-session-ownership";
import { createSqliteTaskStoreHarness } from "../../adapters/sqlite/sqlite-task-store-test-support";
import { createSqliteWorkspaceSessionStore } from "../../adapters/sqlite/sqlite-workspace-session-store";
import { createAgentSessionRecord } from "../../ports/task-store-port-contract.test-support";
import { createLiveSessionRootRefsReader } from "./live-session-root-refs";

test("reload roots recover workflow roles and repository scope from persisted owners", async () => {
  const harness = await createSqliteTaskStoreHarness();
  try {
    const { repoPath } = harness;
    const store = createSqliteWorkspaceSessionStore(harness);
    const config = repoConfigSchema.parse({
      workspaceId: "fairnest",
      workspaceName: "Fairnest",
      repoPath,
    });
    const task = await Effect.runPromise(
      harness.store.createTask({
        ...harness.scope,
        status: "open",
        task: { title: "Permissions", issueType: "task", priority: 2 },
      }),
    );
    const workflowSessions = (["spec", "planner", "build", "qa"] as const).map((role) =>
      createAgentSessionRecord({
        role,
        runtimeKind: (
          { spec: "opencode", planner: "codex", build: "claude", qa: "opencode" } as const
        )[role],
        externalSessionId: `workflow-${role}`,
        workingDirectory: `${repoPath}/${role}`,
      }),
    );
    for (const session of workflowSessions)
      await Effect.runPromise(
        harness.store.upsertAgentSession({
          workspaceId: harness.workspaceId,
          ownershipScope: workspaceSessionOwnership({ workspaceId: harness.workspaceId, repoPath }),
          repoPath,
          taskId: task.id,
          session,
        }),
      );
    const closed = await Effect.runPromise(
      harness.store.createTask({
        ...harness.scope,
        status: "open",
        task: { title: "Closed history", issueType: "task", priority: 2 },
      }),
    );
    const historicalSession = createAgentSessionRecord({
      externalSessionId: "closed-build",
      workingDirectory: `${repoPath}/removed-worktree`,
    });
    await Effect.runPromise(
      harness.store.upsertAgentSession({
        workspaceId: harness.workspaceId,
        ownershipScope: workspaceSessionOwnership({ workspaceId: harness.workspaceId, repoPath }),
        repoPath,
        taskId: closed.id,
        session: historicalSession,
      }),
    );
    await Effect.runPromise(
      harness.store.transitionTask({
        ...harness.scope,
        taskId: closed.id,
        decide: () => Result.succeed({ status: "closed", workflowId: "openducktor" }),
      }),
    );
    const history = await Effect.runPromise(
      harness.store.getTaskMetadata({ ...harness.scope, taskId: closed.id }),
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
      targetBranch: null,
      createdAt: 1,
      updatedAt: 1,
      archivedAt: null,
    };
    for (const session of [chat, { ...chat, id: "draft", externalSessionId: null }])
      await Effect.runPromise(
        store.create({
          repoPath,
          workspaceId: config.workspaceId,
          ownershipScope: workspaceSessionOwnership(config),
          session,
        }),
      );
    const readRoots = createLiveSessionRootRefsReader({
      store,
      settings: { getWorkspaceCatalog: () => Effect.succeed(workspaceSessionCatalog(config)) },
    });
    const roots = await Effect.runPromise(readRoots(repoPath));
    expect(roots).toEqual([
      {
        repoPath,
        runtimeKind: "opencode",
        externalSessionId: "repository-native",
        workingDirectory: repoPath,
        sessionScope: { kind: "repository", workspaceId: harness.workspaceId },
      },
      ...workflowSessions.map((session) => ({
        repoPath,
        runtimeKind: session.runtimeKind,
        externalSessionId: session.externalSessionId,
        workingDirectory: session.workingDirectory,
        sessionScope: {
          kind: "workflow" as const,
          workspaceId: harness.workspaceId,
          taskId: task.id,
          role: session.role,
        },
      })),
    ]);
    expect(
      await Effect.runPromise(
        harness.store.getTaskMetadata({ ...harness.scope, taskId: closed.id }),
      ),
    ).toEqual(history);
    await Effect.runPromise(
      harness.store.transitionTask({
        ...harness.scope,
        taskId: closed.id,
        decide: () => Result.succeed({ status: "open", workflowId: "openducktor" }),
      }),
    );
    expect(await Effect.runPromise(readRoots(repoPath))).toContainEqual({
      repoPath,
      runtimeKind: historicalSession.runtimeKind,
      externalSessionId: historicalSession.externalSessionId,
      workingDirectory: historicalSession.workingDirectory,
      sessionScope: {
        kind: "workflow",
        workspaceId: harness.workspaceId,
        taskId: closed.id,
        role: historicalSession.role,
      },
    });
  } finally {
    await harness.cleanup();
  }
});
