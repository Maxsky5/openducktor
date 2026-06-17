import { describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import {
  type AgentSessionCollection,
  type AgentSessionCollectionUpdater,
  emptyAgentSessionCollection,
  listAgentSessions,
} from "@/state/agent-session-collection";
import { withCapturedConsole } from "@/test-utils/console-capture";
import { host } from "../../shared/host";
import {
  BUILD_SELECTION,
  createStartSessionTestHarness,
  taskFixture,
} from "./start-session.test-helpers";

describe("agent-orchestrator/handlers/start-session stale workspace", () => {
  test("fails fast on stale repo before any side effects", async () => {
    let persistedListCalls = 0;

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => {
      persistedListCalls += 1;
      return [];
    };

    const { start } = createStartSessionTestHarness({
      taskRef: { current: [taskFixture] },
      currentWorkspaceRepoPathRef: { current: "/tmp/other" },
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        }),
      ).rejects.toThrow("Workspace changed while starting session.");
      expect(persistedListCalls).toBe(0);
    } finally {
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("does not diverge ref/state when workspace becomes stale during initial session commit", async () => {
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };
    let sessionsState: AgentSessionCollection = emptyAgentSessionCollection();
    const sessionsRef: { current: AgentSessionCollection } = {
      current: emptyAgentSessionCollection(),
    };
    const setSessionCollection = (updater: AgentSessionCollectionUpdater) => {
      currentWorkspaceRepoPathRef.current = "/tmp/other";
      sessionsState = typeof updater === "function" ? updater(sessionsState) : updater;
    };

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "external-created",
      startedAt: "2026-02-22T08:00:10.000Z",
      role: "build",
      status: "idle",
    });

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const { start } = createStartSessionTestHarness({
      adapter,
      setSessionCollection,
      sessionsRef,
      taskRef: { current: [taskFixture] },
      currentWorkspaceRepoPathRef,
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        }),
      ).rejects.toThrow("Workspace changed while starting session.");
      expect(listAgentSessions(sessionsRef.current)).toEqual([]);
      expect(listAgentSessions(sessionsState)).toEqual([]);
    } finally {
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("rolls back started remote session when workspace becomes stale after start", async () => {
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };
    let stopCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    const originalStopSession = adapter.stopSession;
    adapter.startSession = async (input) => {
      currentWorkspaceRepoPathRef.current = "/tmp/other";
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: "external-created",
        startedAt: "2026-02-22T08:00:10.000Z",
        role: "build",
        status: "idle",
      };
    };
    adapter.stopSession = async () => {
      stopCalls += 1;
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const { start } = createStartSessionTestHarness({
      adapter,
      taskRef: { current: [taskFixture] },
      currentWorkspaceRepoPathRef,
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        }),
      ).rejects.toThrow("Workspace changed while starting session.");
      expect(stopCalls).toBe(1);
    } finally {
      adapter.startSession = originalStartSession;
      adapter.stopSession = originalStopSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("rolls back started remote session when workspace becomes stale after observer start", async () => {
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };
    let stopCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    const originalStopSession = adapter.stopSession;
    adapter.startSession = async (input) => {
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: "external-created",
        startedAt: "2026-02-22T08:00:10.000Z",
        role: "build",
        status: "idle",
      };
    };
    adapter.stopSession = async () => {
      stopCalls += 1;
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const { start } = createStartSessionTestHarness({
      adapter,
      taskRef: { current: [taskFixture] },
      currentWorkspaceRepoPathRef,
      observeAgentSession: async () => {
        currentWorkspaceRepoPathRef.current = "/tmp/other";
        return true;
      },
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        }),
      ).rejects.toThrow("Workspace changed while starting session.");
      expect(stopCalls).toBe(1);
    } finally {
      adapter.startSession = originalStartSession;
      adapter.stopSession = originalStopSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("surfaces stale-start cleanup failures instead of masking them", async () => {
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    const originalStopSession = adapter.stopSession;
    adapter.startSession = async (input) => {
      currentWorkspaceRepoPathRef.current = "/tmp/other";
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: "external-created",
        startedAt: "2026-02-22T08:00:10.000Z",
        role: "build",
        status: "idle",
      };
    };
    adapter.stopSession = async () => {
      throw new Error("stop boom");
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const { start } = createStartSessionTestHarness({
      adapter,
      taskRef: { current: [taskFixture] },
      currentWorkspaceRepoPathRef,
    });

    try {
      await withCapturedConsole("error", async (calls) => {
        await expect(
          start({
            taskId: "task-1",
            role: "build",
            startMode: "fresh",
            selectedModel: BUILD_SELECTION,
          }),
        ).rejects.toThrow(
          "Workspace changed while starting session. Failed to stop stale started session 'external-created': stop boom",
        );
        expect(calls).toHaveLength(1);
        expect(String(calls[0]?.[1] ?? "")).toBe("start-session-stop-on-stale-after-start");
      });
    } finally {
      adapter.startSession = originalStartSession;
      adapter.stopSession = originalStopSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });
});
