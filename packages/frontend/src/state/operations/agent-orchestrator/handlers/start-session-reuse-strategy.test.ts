import { beforeEach, describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { clearAppQueryClient } from "@/lib/query-client";
import { unavailableRoleErrorMessage } from "@/lib/task-agent-workflows";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { host } from "../../shared/host";
import { executeReuseStart } from "./start-session-reuse-strategy";
import {
  createBuildContinuationTargetFixture,
  createBuildSessionFixture,
  createRuntimeDependenciesFixture,
  createSessionDependenciesFixture,
  createStartSessionContextFixture,
  createTaskDependenciesFixture,
} from "./start-session-strategy-test-fixtures";

const persistedSessionRecord = (
  input: {
    externalSessionId: string;
    role: AgentSessionRecord["role"];
    startedAt: string;
    workingDirectory: string;
    runtimeKind?: AgentSessionRecord["runtimeKind"];
    selectedModel?: AgentSessionRecord["selectedModel"];
  } & Record<string, unknown>,
): AgentSessionRecord => ({
  runtimeKind: input.runtimeKind ?? "opencode",
  externalSessionId: input.externalSessionId,
  role: input.role,
  startedAt: input.startedAt,
  workingDirectory: input.workingDirectory,
  selectedModel: input.selectedModel ?? null,
});

describe("agent-orchestrator/handlers/start-session-reuse-strategy", () => {
  beforeEach(async () => {
    await clearAppQueryClient();
  });

  test("hydrates and returns a persisted reusable session", async () => {
    const originalAgentSessionsList = host.agentSessionsList;
    const sessionsRef = { current: {} as Record<string, AgentSessionState> };
    let loadCalls = 0;
    host.agentSessionsList = async () => [
      persistedSessionRecord({
        externalSessionId: "ext-build",
        role: "build",
        startedAt: "2026-02-22T08:20:00.000Z",
        workingDirectory: "/tmp/repo/worktree",
      }),
    ];

    try {
      const sessionDependencies = createSessionDependenciesFixture({
        sessionsRef,
        loadAgentSessions: async () => {
          loadCalls += 1;
          sessionsRef.current = {
            "ext-build": createBuildSessionFixture({
              externalSessionId: "ext-build",
            }),
          };
        },
      });
      await expect(
        executeReuseStart({
          ctx: createStartSessionContextFixture(),
          input: {
            startMode: "reuse",
            sourceExternalSessionId: "ext-build",
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
      ).resolves.toEqual({
        kind: "reused",
        externalSessionId: "ext-build",
      });
      expect(loadCalls).toBe(1);
    } finally {
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("rejects reuse when the build continuation target no longer matches", async () => {
    const sessionDependencies = createSessionDependenciesFixture({
      sessionsRef: {
        current: {
          "ext-build": createBuildSessionFixture({
            workingDirectory: "/tmp/repo/old-worktree",
          }),
        },
      },
    });

    await expect(
      executeReuseStart({
        ctx: createStartSessionContextFixture(),
        input: {
          startMode: "reuse",
          sourceExternalSessionId: "ext-build",
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
      sessionsRef: {
        current: {
          "ext-qa": createBuildSessionFixture({
            externalSessionId: "ext-qa",
            role: "qa",
          }),
        },
      },
    });

    await expect(
      executeReuseStart({
        ctx: createStartSessionContextFixture({ role: "qa" }),
        input: {
          startMode: "reuse",
          sourceExternalSessionId: "ext-qa",
        },
        deps: {
          session: sessionDependencies,
          runtime: createRuntimeDependenciesFixture({
            resolveTaskWorktree: async () => null,
          }),
          task: createTaskDependenciesFixture({
            taskRef: {
              current: [
                createTaskCardFixture(
                  {
                    status: "ai_review",
                    agentWorkflows: {
                      spec: { required: false, canSkip: true, available: true, completed: false },
                      planner: {
                        required: false,
                        canSkip: true,
                        available: true,
                        completed: false,
                      },
                      builder: { required: true, canSkip: false, available: true, completed: true },
                      qa: { required: false, canSkip: true, available: true, completed: false },
                    },
                  },
                  {},
                ),
              ],
            },
          }),
          model: {
            loadRepoPromptOverrides: async () => ({}),
          },
        },
      }),
    ).rejects.toThrow("Builder continuation cannot start until a builder worktree exists");
  });

  test("rejects qa reuse when the task workflow does not allow qa", async () => {
    const sessionDependencies = createSessionDependenciesFixture({
      sessionsRef: {
        current: {
          "ext-qa": createBuildSessionFixture({
            externalSessionId: "ext-qa",
            role: "qa",
          }),
        },
      },
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
          startMode: "reuse",
          sourceExternalSessionId: "ext-qa",
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
