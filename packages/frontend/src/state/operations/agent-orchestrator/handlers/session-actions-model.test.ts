import { describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import {
  buildSession,
  createSessionActions,
  createSessionsRef,
  getSession,
} from "./session-actions.test-helpers";

describe("agent-orchestrator/handlers/session-actions model", () => {
  test("persists an accepted model update when the selected model is unchanged", async () => {
    const session = buildSession({
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
      },
    });
    const selection = session.selectedModel;
    const store = createAgentSessionsStore("/tmp/repo");
    store.replaceSession(session);
    const adapter = new OpencodeSdkAdapter();
    adapter.updateSessionModel = async () => {};
    let persistenceCalls = 0;
    const actions = createSessionActions({
      adapter,
      readSessionSnapshot: store.getSessionSnapshot,
      updateSession: store.updateSession,
      persistSessionRecord: async () => {
        persistenceCalls += 1;
      },
    });

    await actions.updateAgentSessionModel(session, selection);

    expect(store.getSessionSnapshot(session)?.selectedModel).toEqual(selection);
    expect(persistenceCalls).toBe(1);
  });

  test("updates the host session and persists the selected model for an idle session", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalUpdateSessionModel = adapter.updateSessionModel;
    const modelCalls: Array<Parameters<OpencodeSdkAdapter["updateSessionModel"]>[0]> = [];
    adapter.updateSessionModel = async (input) => {
      modelCalls.push(input);
    };

    const sessionsRef = createSessionsRef([
      buildSession({ status: "idle", repoPath: "/tmp/session-repo" }),
    ]);
    const persistedModels: Array<{
      repoPath: string;
      taskId: string;
      modelId: string | undefined;
    }> = [];

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      persistSessionRecord: async (repoPath, taskId, record) => {
        persistedModels.push({ repoPath, taskId, modelId: record.selectedModel?.modelId });
      },
    });

    try {
      await actions.updateAgentSessionModel(getSession(sessionsRef), {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
      });

      expect(modelCalls).toHaveLength(1);
      expect(getSession(sessionsRef)?.selectedModel?.modelId).toBe("gpt-5");
      expect(persistedModels).toEqual([
        { repoPath: "/tmp/session-repo", taskId: "task-1", modelId: "gpt-5" },
      ]);
    } finally {
      adapter.updateSessionModel = originalUpdateSessionModel;
    }
  });

  test("syncs selected model to the runtime for an observed live session", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalUpdateSessionModel = adapter.updateSessionModel;
    const modelCalls: Array<Parameters<OpencodeSdkAdapter["updateSessionModel"]>[0]> = [];
    adapter.updateSessionModel = async (input) => {
      modelCalls.push(input);
    };

    const sessionsRef = createSessionsRef([buildSession()]);
    let persistenceCalls = 0;

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      persistSessionRecord: async () => {
        persistenceCalls += 1;
      },
    });

    try {
      await actions.updateAgentSessionModel(getSession(sessionsRef), {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
      });

      expect(modelCalls).toHaveLength(1);
      expect(modelCalls[0]).toEqual({
        externalSessionId: "session-1",
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        model: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
        },
      });
      expect(getSession(sessionsRef)?.selectedModel?.modelId).toBe("gpt-5");
      expect(persistenceCalls).toBe(1);
    } finally {
      adapter.updateSessionModel = originalUpdateSessionModel;
    }
  });

  test("keeps the durable model unchanged when host runtime sync fails", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalUpdateSessionModel = adapter.updateSessionModel;
    adapter.updateSessionModel = async () => {
      throw new Error("Unknown session: session-1");
    };

    const sessionsRef = createSessionsRef([buildSession()]);
    const actions = createSessionActions({
      adapter,
      sessionsRef,
    });

    try {
      await expect(
        actions.updateAgentSessionModel(getSession(sessionsRef), {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
        }),
      ).rejects.toThrow("Unknown session: session-1");
      expect(getSession(sessionsRef)?.selectedModel).toBeNull();
    } finally {
      adapter.updateSessionModel = originalUpdateSessionModel;
    }
  });

  test("changes a repository session model without task persistence", async () => {
    const adapter = new OpencodeSdkAdapter();
    const modelCalls: Array<Parameters<OpencodeSdkAdapter["updateSessionModel"]>[0]> = [];
    adapter.updateSessionModel = async (input) => {
      modelCalls.push(input);
    };
    const sessionsRef = createSessionsRef([
      buildSession({
        sessionAssociation: { kind: "repository" },
        repoPath: "/tmp/session-repository",
        workingDirectory: "/tmp/repo/repository-chat",
      }),
    ]);
    let persistenceCalls = 0;
    const actions = createSessionActions({
      adapter,
      sessionsRef,
      workspaceRepoPath: "/tmp/active-workspace",
      persistSessionRecord: async () => {
        persistenceCalls += 1;
      },
    });

    await actions.updateAgentSessionModel(getSession(sessionsRef), {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
    });

    expect(modelCalls).toEqual([
      {
        externalSessionId: "session-1",
        repoPath: "/tmp/session-repository",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/repository-chat",
        model: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
        },
      },
    ]);
    expect(getSession(sessionsRef).selectedModel?.modelId).toBe("gpt-5");
    expect(persistenceCalls).toBe(0);
  });

  test("reports workflow model persistence failure after the runtime accepts the change", async () => {
    const adapter = new OpencodeSdkAdapter();
    let runtimeCalls = 0;
    adapter.updateSessionModel = async () => {
      runtimeCalls += 1;
    };
    const sessionsRef = createSessionsRef([buildSession()]);
    let persistenceCalls = 0;
    const actions = createSessionActions({
      adapter,
      sessionsRef,
      persistSessionRecord: async () => {
        persistenceCalls += 1;
        throw new Error("task session persistence failed");
      },
    });

    await expect(
      actions.updateAgentSessionModel(getSession(sessionsRef), {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
      }),
    ).rejects.toThrow("task session persistence failed");
    expect(runtimeCalls).toBe(1);
    expect(persistenceCalls).toBe(1);
  });

  test("rejects an unbound model change before calling the runtime", async () => {
    const adapter = new OpencodeSdkAdapter();
    let runtimeCalls = 0;
    adapter.updateSessionModel = async () => {
      runtimeCalls += 1;
    };
    const sessionsRef = createSessionsRef([
      buildSession({ sessionAssociation: { kind: "unbound" } }),
    ]);
    const actions = createSessionActions({ adapter, sessionsRef });

    await expect(
      actions.updateAgentSessionModel(getSession(sessionsRef), {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
      }),
    ).rejects.toThrow(
      "Cannot change model for unbound session 'session-1'; repository or workflow context is required.",
    );
    expect(runtimeCalls).toBe(0);
  });

  test("reports a stale model operation when the session disappears after runtime update", async () => {
    const adapter = new OpencodeSdkAdapter();
    let runtimeCalls = 0;
    adapter.updateSessionModel = async () => {
      runtimeCalls += 1;
    };
    const sessionsRef = createSessionsRef([buildSession()]);
    let persistenceCalls = 0;
    const actions = createSessionActions({
      adapter,
      sessionsRef,
      updateSession: () => {
        sessionsRef.current = createSessionsRef().current;
        return null;
      },
      persistSessionRecord: async () => {
        persistenceCalls += 1;
      },
    });

    await expect(
      actions.updateAgentSessionModel(getSession(sessionsRef), {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
      }),
    ).rejects.toThrow("Session 'session-1' became unavailable after its model changed.");
    expect(runtimeCalls).toBe(1);
    expect(persistenceCalls).toBe(0);
  });

  test("fails instead of silently ignoring model changes for an unloaded session", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalUpdateSessionModel = adapter.updateSessionModel;
    const modelCalls: Array<Parameters<OpencodeSdkAdapter["updateSessionModel"]>[0]> = [];
    adapter.updateSessionModel = async (input) => {
      modelCalls.push(input);
    };

    const actions = createSessionActions({
      adapter,
      sessionsRef: createSessionsRef([]),
    });

    try {
      await expect(
        actions.updateAgentSessionModel(
          {
            externalSessionId: "missing-session",
            runtimeKind: "opencode",
            workingDirectory: "/repo/worktree",
          },
          {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5",
          },
        ),
      ).rejects.toThrow("Session 'missing-session' is not loaded.");
      expect(modelCalls).toHaveLength(0);
    } finally {
      adapter.updateSessionModel = originalUpdateSessionModel;
    }
  });
});
