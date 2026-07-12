import { describe, expect, test } from "bun:test";
import { unavailableRoleErrorMessage } from "@/lib/task-agent-workflows";
import { createAgentSessionCollection } from "@/state/agent-session-collection";
import {
  createSettingsSnapshotFixture,
  createTaskCardFixture,
} from "@/test-utils/shared-test-fixtures";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { executeReuseStart } from "./start-session-reuse-strategy";
import {
  createBuildContinuationTargetFixture,
  createBuildSessionFixture,
  createRuntimeDependenciesFixture,
  createSessionDependenciesFixture,
  createStartSessionContextFixture,
  createTaskDependenciesFixture,
} from "./start-session-strategy-test-fixtures";

const createSessionsRef = (sessions: AgentSessionState[] = []) => ({
  current: createAgentSessionCollection(sessions),
});

const createQaAvailableTaskDependencies = () =>
  createTaskDependenciesFixture({
    taskRef: {
      current: [
        createTaskCardFixture(
          {
            status: "ai_review",
            agentWorkflows: {
              spec: { required: false, canSkip: true, available: true, completed: false },
              planner: { required: false, canSkip: true, available: true, completed: false },
              builder: { required: true, canSkip: false, available: true, completed: true },
              qa: { required: false, canSkip: true, available: true, completed: false },
            },
          },
          {},
        ),
      ],
    },
  });

const createModelDependenciesFixture = () => ({
  loadRepoPromptOverrides: async () => ({}),
  loadSettingsSnapshot: async () => createSettingsSnapshotFixture(),
});

describe("agent-orchestrator/handlers/start-session-reuse-strategy", () => {
  test("loads and returns a persisted reusable session", async () => {
    const sessionsRef = createSessionsRef();
    let loadCalls = 0;

    const sessionDependencies = createSessionDependenciesFixture({
      sessionsRef,
      loadSourceSession: async () => {
        loadCalls += 1;
        const session = createBuildSessionFixture({
          externalSessionId: "ext-build",
        });
        sessionsRef.current = createAgentSessionCollection([session]);
        return session;
      },
    });
    await expect(
      executeReuseStart({
        ctx: createStartSessionContextFixture(),
        input: {
          sourceSession: {
            externalSessionId: "ext-build",
            runtimeKind: "opencode",
            workingDirectory: "/tmp/repo/worktree",
          },
        },
        deps: {
          session: sessionDependencies,
          runtime: createRuntimeDependenciesFixture({
            resolveTaskWorktree: async () =>
              createBuildContinuationTargetFixture("/tmp/repo/worktree"),
          }),
          task: createTaskDependenciesFixture(),
          model: createModelDependenciesFixture(),
        },
      }),
    ).resolves.toMatchObject({
      kind: "reused",
      session: {
        externalSessionId: "ext-build",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      },
    });
    expect(loadCalls).toBe(1);
  });

  test("reuses a legacy build session at its exact recorded directory", async () => {
    const sessionDependencies = createSessionDependenciesFixture({
      sessionsRef: createSessionsRef([
        createBuildSessionFixture({
          externalSessionId: "ext-build",
          workingDirectory: "/tmp/repo/old-worktree",
        }),
      ]),
    });

    await expect(
      executeReuseStart({
        ctx: createStartSessionContextFixture(),
        input: {
          sourceSession: {
            externalSessionId: "ext-build",
            runtimeKind: "opencode",
            workingDirectory: "/tmp/repo/old-worktree",
          },
        },
        deps: {
          session: sessionDependencies,
          runtime: createRuntimeDependenciesFixture({
            resolveTaskWorktree: async () =>
              createBuildContinuationTargetFixture("/tmp/repo/new-worktree"),
          }),
          task: createTaskDependenciesFixture(),
          model: createModelDependenciesFixture(),
        },
      }),
    ).resolves.toMatchObject({
      kind: "reused",
      session: { workingDirectory: "/tmp/repo/old-worktree" },
    });
  });

  test("reuses a legacy qa session without resolving a current worktree", async () => {
    const sessionDependencies = createSessionDependenciesFixture({
      sessionsRef: createSessionsRef([
        createBuildSessionFixture({
          externalSessionId: "ext-qa",
          role: "qa",
        }),
      ]),
    });

    await expect(
      executeReuseStart({
        ctx: createStartSessionContextFixture({ role: "qa" }),
        input: {
          sourceSession: {
            externalSessionId: "ext-qa",
            runtimeKind: "opencode",
            workingDirectory: "/tmp/repo/worktree",
          },
        },
        deps: {
          session: sessionDependencies,
          runtime: createRuntimeDependenciesFixture({
            resolveTaskWorktree: async () => null,
          }),
          task: createQaAvailableTaskDependencies(),
          model: createModelDependenciesFixture(),
        },
      }),
    ).resolves.toMatchObject({
      kind: "reused",
      session: { workingDirectory: "/tmp/repo/worktree" },
    });
  });

  test("reuses qa at its recorded directory when the canonical target changed", async () => {
    const sessionDependencies = createSessionDependenciesFixture({
      sessionsRef: createSessionsRef([
        createBuildSessionFixture({
          externalSessionId: "ext-qa",
          role: "qa",
          workingDirectory: "/tmp/repo/old-worktree",
        }),
      ]),
    });

    await expect(
      executeReuseStart({
        ctx: createStartSessionContextFixture({ role: "qa" }),
        input: {
          sourceSession: {
            externalSessionId: "ext-qa",
            runtimeKind: "opencode",
            workingDirectory: "/tmp/repo/old-worktree",
          },
        },
        deps: {
          session: sessionDependencies,
          runtime: createRuntimeDependenciesFixture({
            resolveTaskWorktree: async () =>
              createBuildContinuationTargetFixture("/tmp/repo/new-worktree"),
          }),
          task: createQaAvailableTaskDependencies(),
          model: createModelDependenciesFixture(),
        },
      }),
    ).resolves.toMatchObject({
      kind: "reused",
      session: { workingDirectory: "/tmp/repo/old-worktree" },
    });
  });

  test("rejects qa reuse when the task workflow does not allow qa", async () => {
    const sessionDependencies = createSessionDependenciesFixture({
      sessionsRef: createSessionsRef([
        createBuildSessionFixture({
          externalSessionId: "ext-qa",
          role: "qa",
        }),
      ]),
    });
    const taskCard = createTaskCardFixture(
      {
        status: "open",
        agentWorkflows: {
          spec: { required: false, canSkip: true, available: true, completed: false },
          planner: { required: false, canSkip: true, available: true, completed: false },
          builder: { required: true, canSkip: false, available: true, completed: false },
          qa: { required: false, canSkip: true, available: false, completed: false },
        },
      },
      {},
    );

    await expect(
      executeReuseStart({
        ctx: createStartSessionContextFixture({ role: "qa" }),
        input: {
          sourceSession: {
            externalSessionId: "ext-qa",
            runtimeKind: "opencode",
            workingDirectory: "/tmp/repo/worktree",
          },
        },
        deps: {
          session: sessionDependencies,
          runtime: createRuntimeDependenciesFixture(),
          task: createTaskDependenciesFixture({
            taskRef: { current: [taskCard] },
          }),
          model: createModelDependenciesFixture(),
        },
      }),
    ).rejects.toThrow(unavailableRoleErrorMessage(taskCard, "qa"));
  });
});
