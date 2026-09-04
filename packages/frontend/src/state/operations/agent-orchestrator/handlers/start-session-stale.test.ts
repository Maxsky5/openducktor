import { describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import {
  type AgentSessionCollection,
  emptyAgentSessionCollection,
  listAgentSessions,
  replaceAgentSession,
} from "@/state/agent-session-collection";
import { withCapturedConsole } from "@/test-utils/console-capture";
import { host } from "../../shared/host";
import {
  BUILD_SELECTION,
  createStartSessionTestHarness,
  taskFixture,
  workflowSessionStartSummary,
} from "./start-session.test-helpers";

interface SessionsRefContract {
  current: AgentSessionCollection;
}

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

  test("keeps the stored session when workspace becomes stale during initial attachment", async () => {
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" };
    let stopCalls = 0;
    const sessionsRef: SessionsRefContract = {
      current: emptyAgentSessionCollection(),
    };
    const replaceSession = (session: Parameters<typeof replaceAgentSession>[1]) => {
      currentWorkspaceRepoPathRef.current = "/tmp/other";
      sessionsRef.current = replaceAgentSession(sessionsRef.current, session);
    };

    const adapter = new OpencodeSdkAdapter();
    const originalStopSession = adapter.stopSession;
    adapter.stopSession = async () => {
      stopCalls += 1;
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const { start } = createStartSessionTestHarness({
      adapter,
      replaceSession,
      sessionsRef,
      taskRef: { current: [taskFixture] },
      currentWorkspaceRepoPathRef,
      startWorkflowSession: async (input) =>
        workflowSessionStartSummary(input, { externalSessionId: "external-created" }),
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
      expect(listAgentSessions(sessionsRef.current)).toEqual([
        expect.objectContaining({ externalSessionId: "external-created" }),
      ]);
      expect(stopCalls).toBe(1);
    } finally {
      adapter.stopSession = originalStopSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("rolls back started remote session when workspace becomes stale after start", async () => {
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" };
    let stopCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalStopSession = adapter.stopSession;
    adapter.stopSession = async () => {
      stopCalls += 1;
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const { start } = createStartSessionTestHarness({
      adapter,
      taskRef: { current: [taskFixture] },
      currentWorkspaceRepoPathRef,
      startWorkflowSession: async (input) => {
        currentWorkspaceRepoPathRef.current = "/tmp/other";
        return workflowSessionStartSummary(input, { externalSessionId: "external-created" });
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
      adapter.stopSession = originalStopSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("rolls back a host-started session when the workspace becomes stale", async () => {
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" };
    let stopCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalStopSession = adapter.stopSession;
    adapter.stopSession = async () => {
      stopCalls += 1;
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const { start } = createStartSessionTestHarness({
      adapter,
      taskRef: { current: [taskFixture] },
      currentWorkspaceRepoPathRef,
      startWorkflowSession: async (input) => {
        currentWorkspaceRepoPathRef.current = "/tmp/other";
        return workflowSessionStartSummary(input, { externalSessionId: "external-created" });
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
      adapter.stopSession = originalStopSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("surfaces stale-start cleanup failures instead of masking them", async () => {
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" };

    const adapter = new OpencodeSdkAdapter();
    const originalStopSession = adapter.stopSession;
    adapter.stopSession = async () => {
      throw new Error("stop boom");
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const { start } = createStartSessionTestHarness({
      adapter,
      taskRef: { current: [taskFixture] },
      currentWorkspaceRepoPathRef,
      startWorkflowSession: async (input) => {
        currentWorkspaceRepoPathRef.current = "/tmp/other";
        return workflowSessionStartSummary(input, { externalSessionId: "external-created" });
      },
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
          "Workspace changed while starting session. Failed to stop the started session during rollback: stop boom. Cleanup was not continued.",
        );
        expect(calls).toHaveLength(1);
        expect(String(calls[0]?.[1] ?? "")).toBe("start-session-stop-on-stale-after-start");
      });
    } finally {
      adapter.stopSession = originalStopSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });
});
