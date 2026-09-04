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
  test("keeps an accepted model update when the selected model is unchanged", async () => {
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
    const actions = createSessionActions({
      adapter,
      readSessionSnapshot: store.getSessionSnapshot,
      updateSession: store.updateSession,
    });

    await actions.updateAgentSessionModel(session, selection);

    expect(store.getSessionSnapshot(session)?.selectedModel).toEqual(selection);
  });

  test("updates the host session and local state for an idle session", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalUpdateSessionModel = adapter.updateSessionModel;
    const modelCalls: Array<Parameters<OpencodeSdkAdapter["updateSessionModel"]>[0]> = [];
    adapter.updateSessionModel = async (input) => {
      modelCalls.push(input);
    };

    const sessionsRef = createSessionsRef([buildSession({ status: "idle" })]);
    const actions = createSessionActions({
      adapter,
      sessionsRef,
    });

    try {
      await actions.updateAgentSessionModel(getSession(sessionsRef), {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
      });

      expect(modelCalls).toHaveLength(1);
      expect(getSession(sessionsRef)?.selectedModel?.modelId).toBe("gpt-5");
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
    const actions = createSessionActions({
      adapter,
      sessionsRef,
    });

    try {
      await actions.updateAgentSessionModel(getSession(sessionsRef), {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        profileId: "build",
      });

      expect(modelCalls).toHaveLength(1);
      expect(modelCalls[0]).toEqual({
        externalSessionId: "session-1",
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        model: {
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
        },
      });
      expect(getSession(sessionsRef)?.selectedModel?.modelId).toBe("gpt-5");
      expect(getSession(sessionsRef)?.selectedModel?.profileId).toBe("build");
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
        workingDirectory: "/tmp/repo/repository-chat",
      }),
    ]);
    const actions = createSessionActions({
      adapter,
      sessionsRef,
      workspaceRepoPath: "/tmp/active-workspace",
    });

    await actions.updateAgentSessionModel(getSession(sessionsRef), {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
    });

    expect(modelCalls).toEqual([
      {
        externalSessionId: "session-1",
        repoPath: "/tmp/active-workspace",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/repository-chat",
        model: {
          providerId: "openai",
          modelId: "gpt-5",
        },
      },
    ]);
    expect(getSession(sessionsRef).selectedModel?.modelId).toBe("gpt-5");
  });

  test("keeps local state unchanged when the host rejects the stored model update", async () => {
    const adapter = new OpencodeSdkAdapter();
    adapter.updateSessionModel = async () => {
      throw new Error("task session persistence failed");
    };
    const sessionsRef = createSessionsRef([buildSession()]);
    const actions = createSessionActions({
      adapter,
      sessionsRef,
    });

    await expect(
      actions.updateAgentSessionModel(getSession(sessionsRef), {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
      }),
    ).rejects.toThrow("task session persistence failed");
    expect(getSession(sessionsRef)?.selectedModel).toBeNull();
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

  test("rejects a runtime change before calling the host", async () => {
    const adapter = new OpencodeSdkAdapter();
    let runtimeCalls = 0;
    adapter.updateSessionModel = async () => {
      runtimeCalls += 1;
    };
    const sessionsRef = createSessionsRef([buildSession()]);
    const actions = createSessionActions({ adapter, sessionsRef });

    await expect(
      actions.updateAgentSessionModel(getSession(sessionsRef), {
        runtimeKind: "codex",
        providerId: "openai",
        modelId: "gpt-5",
      }),
    ).rejects.toThrow("Session 'session-1' cannot move from 'opencode' to 'codex'.");
    expect(runtimeCalls).toBe(0);
  });

  test("reports a stale model operation when the session disappears after runtime update", async () => {
    const adapter = new OpencodeSdkAdapter();
    let runtimeCalls = 0;
    adapter.updateSessionModel = async () => {
      runtimeCalls += 1;
    };
    const sessionsRef = createSessionsRef([buildSession()]);
    const actions = createSessionActions({
      adapter,
      sessionsRef,
      updateSession: () => {
        sessionsRef.current = createSessionsRef().current;
        return null;
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
