import { beforeEach, describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { AgentModelSelection } from "@openducktor/core";
import { clearAppQueryClient } from "@/lib/query-client";
import type {
  AgentSessionCollection,
  AgentSessionCollectionUpdater,
} from "@/state/agent-session-collection";
import { host } from "../../shared/host";
import {
  BUILD_SELECTION,
  continuationTarget,
  createAgentSessionCollection,
  createSessionsRef,
  createStartSessionTestHarness,
  getSession,
  PLANNER_SELECTION,
  persistedSessionRecord,
  sessionFixture,
  setPersistedSessionListFixture,
  taskFixture,
} from "./start-session.test-helpers";

describe("agent-orchestrator/handlers/start-session reuse", () => {
  beforeEach(async () => {
    await clearAppQueryClient();
  });

  test("reuses most recent in-memory session for same task and role", async () => {
    let persistedListCalls = 0;
    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => {
      persistedListCalls += 1;
      return [];
    };

    const { start } = createStartSessionTestHarness({
      sessionsRef: createSessionsRef([
        sessionFixture({
          externalSessionId: "external-newer",
          startedAt: "2026-02-22T08:10:00.000Z",
        }),
      ]),
      resolveTaskWorktree: async () => continuationTarget("/tmp/repo/worktree"),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: "runtime-2",
        workingDirectory: "/tmp/repo",
      }),
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "reuse",
          sourceSession: {
            externalSessionId: "external-newer",
            runtimeKind: "opencode",
            workingDirectory: "/tmp/repo/worktree",
          },
        }),
      ).resolves.toEqual(expect.objectContaining({ externalSessionId: "external-newer" }));
      expect(persistedListCalls).toBe(0);
    } finally {
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("reuses the explicitly selected in-memory session instead of the latest one", async () => {
    let persistedListCalls = 0;
    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => {
      persistedListCalls += 1;
      return [];
    };

    const { start } = createStartSessionTestHarness({
      sessionsRef: createSessionsRef([
        sessionFixture({
          externalSessionId: "external-latest",
          startedAt: "2026-02-22T08:10:00.000Z",
        }),
        sessionFixture({
          externalSessionId: "external-chosen",
          startedAt: "2026-02-22T08:00:00.000Z",
        }),
      ]),
      resolveTaskWorktree: async () => continuationTarget("/tmp/repo/worktree"),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: "runtime-2",
        workingDirectory: "/tmp/repo",
      }),
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "reuse",
          sourceSession: {
            externalSessionId: "external-chosen",
            runtimeKind: "opencode",
            workingDirectory: "/tmp/repo/worktree",
          },
        }),
      ).resolves.toEqual(expect.objectContaining({ externalSessionId: "external-chosen" }));
      expect(persistedListCalls).toBe(0);
    } finally {
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("starts a fresh build session instead of reusing an in-memory session when the continuation target changed", async () => {
    let persistedListCalls = 0;
    let startCalls = 0;
    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => {
      persistedListCalls += 1;
      return [];
    };

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async (input) => {
      startCalls += 1;
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: "external-fresh-build-session",
        startedAt: "2026-02-22T08:20:00.000Z",
        role: input.role,
        status: "idle",
      };
    };

    const { start } = createStartSessionTestHarness({
      adapter,
      sessionsRef: createSessionsRef([
        sessionFixture({
          externalSessionId: "external-stale",
          startedAt: "2026-02-22T08:10:00.000Z",
          workingDirectory: "/tmp/repo/old-worktree",
        }),
      ]),
      taskRef: { current: [taskFixture] },
      resolveTaskWorktree: async () => continuationTarget("/tmp/repo/new-worktree"),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: "runtime-2",
        workingDirectory: "/tmp/repo/new-worktree",
      }),
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        }),
      ).resolves.toEqual(
        expect.objectContaining({ externalSessionId: "external-fresh-build-session" }),
      );
      expect(startCalls).toBe(1);
      expect(persistedListCalls).toBe(0);
    } finally {
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("reuses an in-memory build session when the continuation target only differs by trailing slash", async () => {
    let persistedListCalls = 0;
    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => {
      persistedListCalls += 1;
      return [];
    };

    const { start } = createStartSessionTestHarness({
      sessionsRef: createSessionsRef([
        sessionFixture({
          externalSessionId: "external-chosen",
          startedAt: "2026-02-22T08:10:00.000Z",
          selectedModel: BUILD_SELECTION,
        }),
      ]),
      taskRef: { current: [taskFixture] },
      resolveTaskWorktree: async () => continuationTarget("/tmp/repo/worktree/"),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo/worktree",
      }),
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "reuse",
          sourceSession: {
            externalSessionId: "external-chosen",
            runtimeKind: "opencode",
            workingDirectory: "/tmp/repo/worktree",
          },
        }),
      ).resolves.toEqual(expect.objectContaining({ externalSessionId: "external-chosen" }));
      expect(persistedListCalls).toBe(0);
    } finally {
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("keeps existing selected model when reusing an in-memory session", async () => {
    let persistedSessions = 0;
    const existingSelectedModel: AgentModelSelection = {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "medium",
      profileId: "Sisyphus",
    };
    const sessionsRef: { current: AgentSessionCollection } = {
      current: createAgentSessionCollection([
        sessionFixture({
          externalSessionId: "external-reused",
          startedAt: "2026-02-22T08:10:00.000Z",
          selectedModel: existingSelectedModel,
        }),
      ]),
    };
    const setSessionCollection = (updater: AgentSessionCollectionUpdater) => {
      sessionsRef.current = updater(sessionsRef.current);
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const { start } = createStartSessionTestHarness({
      setSessionCollection,
      sessionsRef,
      resolveTaskWorktree: async () => continuationTarget("/tmp/repo/worktree"),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: "runtime-2",
        workingDirectory: "/tmp/repo",
      }),
      persistSessionRecord: async () => {
        persistedSessions += 1;
      },
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "reuse",
          sourceSession: {
            externalSessionId: "external-reused",
            runtimeKind: "opencode",
            workingDirectory: "/tmp/repo/worktree",
          },
        }),
      ).resolves.toEqual(expect.objectContaining({ externalSessionId: "external-reused" }));
      expect(getSession(sessionsRef.current, "external-reused")?.selectedModel).toEqual(
        existingSelectedModel,
      );
      expect(persistedSessions).toBe(0);
    } finally {
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("reuses in-memory session even when selected runtime differs", async () => {
    const selectedModel: AgentModelSelection = {
      runtimeKind: "opencode",
      providerId: "anthropic",
      modelId: "claude-3-7-sonnet",
      profileId: "Hephaestus",
    };
    let startCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async (input) => {
      startCalls += 1;
      expect(input.model).toEqual(selectedModel);
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: "fresh-runtime-external",
        startedAt: "2026-02-22T08:30:00.000Z",
        role: "build",
        status: "idle",
      };
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const { start } = createStartSessionTestHarness({
      adapter,
      sessionsRef: createSessionsRef([
        sessionFixture({
          externalSessionId: "external-reused",
          startedAt: "2026-02-22T08:10:00.000Z",
          selectedModel: {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5",
            profileId: "Ares",
          },
        }),
      ]),
      taskRef: { current: [taskFixture] },
      resolveTaskWorktree: async () => continuationTarget("/tmp/repo/worktree"),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: "runtime-claude",
        workingDirectory: "/tmp/repo/worktree",
      }),
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "reuse",
          sourceSession: {
            externalSessionId: "external-reused",
            runtimeKind: "opencode",
            workingDirectory: "/tmp/repo/worktree",
          },
        }),
      ).resolves.toEqual(expect.objectContaining({ externalSessionId: "external-reused" }));
      expect(startCalls).toBe(0);
    } finally {
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("reuses in-memory session even when selected agent profile differs", async () => {
    const selectedModel: AgentModelSelection = {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "Hephaestus",
    };
    let startCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async (input) => {
      startCalls += 1;
      expect(input.model).toEqual(selectedModel);
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: "fresh-profile-external",
        startedAt: "2026-02-22T08:35:00.000Z",
        role: "build",
        status: "idle",
      };
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const { start } = createStartSessionTestHarness({
      adapter,
      sessionsRef: createSessionsRef([
        sessionFixture({
          externalSessionId: "external-reused",
          startedAt: "2026-02-22T08:10:00.000Z",
          selectedModel: {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5",
            variant: "high",
            profileId: "Sisyphus",
          },
        }),
      ]),
      taskRef: { current: [taskFixture] },
      resolveTaskWorktree: async () => continuationTarget("/tmp/repo/worktree"),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: "runtime-2",
        workingDirectory: "/tmp/repo",
      }),
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "reuse",
          sourceSession: {
            externalSessionId: "external-reused",
            runtimeKind: "opencode",
            workingDirectory: "/tmp/repo/worktree",
          },
        }),
      ).resolves.toEqual(expect.objectContaining({ externalSessionId: "external-reused" }));
      expect(startCalls).toBe(0);
    } finally {
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("startMode fresh bypasses same-role reuse and starts a new session", async () => {
    let startCalls = 0;
    let persistedListCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async (input) => {
      startCalls += 1;
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: "fresh-ext",
        startedAt: "2026-02-22T09:00:00.000Z",
        role: "build",
        status: "idle",
      };
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => {
      persistedListCalls += 1;
      return [
        persistedSessionRecord({
          runtimeKind: "opencode",
          externalSessionId: "persisted-build-ext",
          taskId: "task-1",
          role: "build",
          status: "idle",
          startedAt: "2026-02-22T08:20:00.000Z",
          updatedAt: "2026-02-22T08:20:00.000Z",
          runtimeId: "runtime-1",
          workingDirectory: "/tmp/repo/worktree",
        }),
      ];
    };

    const { start } = createStartSessionTestHarness({
      adapter,
      sessionsRef: createSessionsRef([
        sessionFixture({
          externalSessionId: "existing-build-ext",
          startedAt: "2026-02-22T08:10:00.000Z",
        }),
      ]),
      taskRef: { current: [taskFixture] },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        }),
      ).resolves.toEqual(expect.objectContaining({ externalSessionId: "fresh-ext" }));
      expect(startCalls).toBe(1);
      expect(persistedListCalls).toBe(0);
    } finally {
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("does not reuse in-memory session from a different role", async () => {
    let startCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async (input) => {
      startCalls += 1;
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: "planner-ext",
        startedAt: "2026-02-22T08:30:00.000Z",
        role: "planner",
        status: "idle",
      };
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const sessionsRef: { current: AgentSessionCollection } = {
      current: createAgentSessionCollection([
        sessionFixture({
          externalSessionId: "existing-spec-ext",
          role: "spec",
          startedAt: "2026-02-22T08:10:00.000Z",
        }),
      ]),
    };

    const { start } = createStartSessionTestHarness({
      adapter,
      sessionsRef,
      taskRef: { current: [taskFixture] },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
    });

    try {
      const externalSessionId = await start({
        taskId: "task-1",
        role: "planner",
        startMode: "fresh",
        selectedModel: PLANNER_SELECTION,
      });
      expect(externalSessionId).toEqual(
        expect.objectContaining({ externalSessionId: "planner-ext" }),
      );
      expect(startCalls).toBe(1);
    } finally {
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("returns the requested persisted session for the same role and loads it when missing from memory", async () => {
    let loadAgentSessionsCalls = 0;

    setPersistedSessionListFixture("/tmp/repo", "task-1", [
      persistedSessionRecord({
        runtimeKind: "opencode",
        externalSessionId: "external-2",
        taskId: "task-1",
        role: "build",
        startedAt: "2026-02-22T08:20:00.000Z",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo/worktree",
      }),
      persistedSessionRecord({
        runtimeKind: "opencode",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        status: "idle",
        startedAt: "2026-02-22T08:10:00.000Z",
        updatedAt: "2026-02-22T08:10:00.000Z",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo/worktree",
      }),
      persistedSessionRecord({
        runtimeKind: "opencode",
        externalSessionId: "external-build-newer",
        taskId: "task-1",
        role: "build",
        status: "idle",
        startedAt: "2026-02-22T08:30:00.000Z",
        updatedAt: "2026-02-22T08:30:00.000Z",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo/worktree",
      }),
    ]);

    const sessionsRef = createSessionsRef();
    const { start } = createStartSessionTestHarness({
      sessionsRef,
      loadAgentSessions: async () => {
        loadAgentSessionsCalls += 1;
        sessionsRef.current = createAgentSessionCollection([
          sessionFixture({
            externalSessionId: "external-build-newer",
            startedAt: "2026-02-22T08:30:00.000Z",
          }),
        ]);
      },
    });

    const externalSessionId = await start({
      taskId: "task-1",
      role: "build",
      startMode: "reuse",
      sourceSession: {
        externalSessionId: "external-build-newer",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      },
    });
    expect(externalSessionId).toEqual(
      expect.objectContaining({ externalSessionId: "external-build-newer" }),
    );
    expect(loadAgentSessionsCalls).toBe(1);
  });

  test("reuses persisted session when selected model differs", async () => {
    const selectedModel: AgentModelSelection = {
      runtimeKind: "opencode",
      providerId: "anthropic",
      modelId: "claude-3-7-sonnet",
      profileId: "Hephaestus",
    };
    let loadAgentSessionsCalls = 0;
    let startCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async (input) => {
      startCalls += 1;
      expect(input.model).toEqual(selectedModel);
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: "fresh-runtime-external",
        startedAt: "2026-02-22T08:40:00.000Z",
        role: "build",
        status: "idle",
      };
    };

    setPersistedSessionListFixture("/tmp/repo", "task-1", [
      persistedSessionRecord({
        runtimeKind: "opencode",
        externalSessionId: "external-opencode",
        taskId: "task-1",
        role: "build",
        startedAt: "2026-02-22T08:20:00.000Z",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo/worktree",
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          profileId: "Ares",
        },
      }),
    ]);

    const sessionsRef = createSessionsRef();
    const { start } = createStartSessionTestHarness({
      adapter,
      sessionsRef,
      taskRef: { current: [taskFixture] },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: "runtime-claude",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadAgentSessions: async () => {
        loadAgentSessionsCalls += 1;
        sessionsRef.current = createAgentSessionCollection([
          sessionFixture({
            externalSessionId: "external-opencode",
            startedAt: "2026-02-22T08:20:00.000Z",
            selectedModel: {
              runtimeKind: "opencode",
              providerId: "openai",
              modelId: "gpt-5",
              profileId: "Ares",
            },
          }),
        ]);
      },
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "reuse",
          sourceSession: {
            externalSessionId: "external-opencode",
            runtimeKind: "opencode",
            workingDirectory: "/tmp/repo/worktree",
          },
        }),
      ).resolves.toEqual(expect.objectContaining({ externalSessionId: "external-opencode" }));
      expect(loadAgentSessionsCalls).toBe(1);
      expect(startCalls).toBe(0);
    } finally {
      adapter.startSession = originalStartSession;
    }
  });

  test("reuses the requested persisted session when runtime kind is only present on selected model", async () => {
    let loadAgentSessionsCalls = 0;
    let startCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async (input) => {
      startCalls += 1;
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: "fresh-runtime-external",
        startedAt: "2026-02-22T08:40:00.000Z",
        role: "build",
        status: "idle",
      };
    };

    setPersistedSessionListFixture("/tmp/repo", "task-1", [
      {
        externalSessionId: "external-claude",
        runtimeKind: "opencode",
        role: "build",
        startedAt: "2026-02-22T08:20:00.000Z",
        workingDirectory: "/tmp/repo/worktree",
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "anthropic",
          modelId: "claude-3-7-sonnet",
          profileId: "Hephaestus",
        },
      },
    ]);

    const sessionsRef = createSessionsRef();
    const { start } = createStartSessionTestHarness({
      adapter,
      sessionsRef,
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: "runtime-claude",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadAgentSessions: async () => {
        loadAgentSessionsCalls += 1;
        sessionsRef.current = createAgentSessionCollection([
          sessionFixture({
            externalSessionId: "external-claude",
            startedAt: "2026-02-22T08:20:00.000Z",
            selectedModel: {
              runtimeKind: "opencode",
              providerId: "anthropic",
              modelId: "claude-3-7-sonnet",
              profileId: "Hephaestus",
            },
          }),
        ]);
      },
    });

    try {
      const externalSessionId = await start({
        taskId: "task-1",
        role: "build",
        startMode: "reuse",
        sourceSession: {
          externalSessionId: "external-claude",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
        },
      });
      expect(externalSessionId).toEqual(
        expect.objectContaining({ externalSessionId: "external-claude" }),
      );
      expect(loadAgentSessionsCalls).toBe(1);
      expect(startCalls).toBe(0);
    } finally {
      adapter.startSession = originalStartSession;
    }
  });
});
