import { describe, expect, test } from "bun:test";
import { unavailableRoleErrorMessage } from "@/lib/task-agent-workflows";
import { createAgentSessionCollection } from "@/state/agent-session-collection";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
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

describe("agent-orchestrator/handlers/start-session-reuse-strategy", () => {
  test("loads and returns a persisted reusable session", async () => {
    const sessionsRef = createSessionsRef();
    let loadCalls = 0;

    const sessionDependencies = createSessionDependenciesFixture({
      sessionsRef,
      loadAgentSessions: async () => {
        loadCalls += 1;
        sessionsRef.current = createAgentSessionCollection([
          createBuildSessionFixture({
            externalSessionId: "ext-build",
          }),
        ]);
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
          model: {
            loadRepoPromptOverrides: async () => ({}),
          },
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

  test("rejects reuse when the build continuation target no longer matches", async () => {
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
          model: {
            loadRepoPromptOverrides: async () => ({}),
          },
        },
      }),
    ).rejects.toThrow("it does not match the current builder continuation target");
  });

  test("fails fast for qa reuse when no builder continuation target exists", async () => {
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
          model: {
            loadRepoPromptOverrides: async () => ({}),
          },
        },
      }),
    ).rejects.toThrow("Builder continuation cannot start until a builder worktree exists");
  });

  test("rejects qa reuse when the builder continuation target changed", async () => {
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
          model: {
            loadRepoPromptOverrides: async () => ({}),
          },
        },
      }),
    ).rejects.toThrow("it does not match the required builder worktree for this QA session");
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
          model: {
            loadRepoPromptOverrides: async () => ({}),
          },
        },
      }),
    ).rejects.toThrow(unavailableRoleErrorMessage(taskCard, "qa"));
  });
});
