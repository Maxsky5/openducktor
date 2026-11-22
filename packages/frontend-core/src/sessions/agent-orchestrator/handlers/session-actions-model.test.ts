import { describe, expect, test } from "bun:test";
import { AgentRuntimeTestAdapter } from "../../../test-support/agent-runtime-test-adapter";
import { createOpenCodeAgentEngineTestAdapter } from "./opencode-agent-engine.test-support";
import { createAgentSessionsStore } from "../../agent-sessions-store";
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
    const adapter = new AgentRuntimeTestAdapter();
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
    const adapter = new AgentRuntimeTestAdapter();
    const originalUpdateSessionModel = adapter.updateSessionModel;
    const modelCalls: Array<Parameters<AgentRuntimeTestAdapter["updateSessionModel"]>[0]> = [];
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
    const adapter = new AgentRuntimeTestAdapter();
    const originalUpdateSessionModel = adapter.updateSessionModel;
    const modelCalls: Array<Parameters<AgentRuntimeTestAdapter["updateSessionModel"]>[0]> = [];
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
          profileId: "build",
        },
      });
      expect(getSession(sessionsRef)?.selectedModel?.modelId).toBe("gpt-5");
      expect(getSession(sessionsRef)?.selectedModel?.profileId).toBe("build");
    } finally {
      adapter.updateSessionModel = originalUpdateSessionModel;
    }
  });

  test("keeps the durable model unchanged when host runtime sync fails", async () => {
    const adapter = new AgentRuntimeTestAdapter();
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
    const adapter = new AgentRuntimeTestAdapter();
    const modelCalls: Array<Parameters<AgentRuntimeTestAdapter["updateSessionModel"]>[0]> = [];
    adapter.updateSessionModel = async (input) => {
      modelCalls.push(input);
    };
    const sessionsRef = createSessionsRef([
      buildSession({
        sessionAssociation: { kind: "repository", workspaceId: "workspace-1" },
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
    const adapter = new AgentRuntimeTestAdapter();
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
    const adapter = new AgentRuntimeTestAdapter();
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
    const adapter = new AgentRuntimeTestAdapter();
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

  test("shows a model change before the runtime answers", async () => {
    const adapter = new AgentRuntimeTestAdapter();
    const runtimeAnswer = Promise.withResolvers<void>();
    adapter.updateSessionModel = () => runtimeAnswer.promise;
    const sessionsRef = createSessionsRef([buildSession()]);
    const actions = createSessionActions({ adapter, sessionsRef });

    const update = actions.updateAgentSessionModel(getSession(sessionsRef), {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
    });

    expect(getSession(sessionsRef)?.selectedModel?.modelId).toBe("gpt-5");
    runtimeAnswer.resolve();
    await update;
    expect(getSession(sessionsRef)?.selectedModel?.modelId).toBe("gpt-5");
  });

  test("shows the confirmed model again when the last pending write fails", async () => {
    const adapter = new AgentRuntimeTestAdapter();
    const answers = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    let calls = 0;
    adapter.updateSessionModel = () => {
      calls += 1;
      return answers[calls - 1]?.promise ?? Promise.resolve();
    };
    const sessionsRef = createSessionsRef([buildSession()]);
    const actions = createSessionActions({ adapter, sessionsRef });
    const change = (modelId: string) =>
      actions
        .updateAgentSessionModel(getSession(sessionsRef), {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId,
        })
        .catch((cause: unknown) => cause);

    const first = change("gpt-5");
    const second = change("gpt-5-mini");
    expect(getSession(sessionsRef)?.selectedModel?.modelId).toBe("gpt-5-mini");
    answers[0]?.resolve();
    await first;
    // The writes run in order, so the second write starts after the first answers.
    expect(calls).toBe(2);
    answers[1]?.reject(new Error("Unknown model"));

    expect(await second).toEqual(new Error("Unknown model"));
    expect(getSession(sessionsRef)?.selectedModel?.modelId).toBe("gpt-5");
  });

  test("sends a message after the pending model write, and not after a failed one", async () => {
    const adapter = createOpenCodeAgentEngineTestAdapter(new AgentRuntimeTestAdapter());
    const runtimeAnswer = Promise.withResolvers<void>();
    adapter.updateSessionModel = () => runtimeAnswer.promise;
    const submitted: string[] = [];
    adapter.submitUserMessage = async (input) => {
      submitted.push(input.submissionId);
      return { kind: "acknowledged", outcome: "accepted", submissionId: input.submissionId };
    };
    const sessionsRef = createSessionsRef([buildSession({ status: "idle" })]);
    const actions = createSessionActions({ adapter, sessionsRef });

    const update = actions
      .updateAgentSessionModel(getSession(sessionsRef), {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
      })
      .catch((cause: unknown) => cause);
    const sent = actions
      .sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "Hello" }])
      .catch((cause: unknown) => cause);
    await Promise.resolve();
    expect(submitted).toEqual([]);

    runtimeAnswer.reject(new Error("Unknown model"));
    await update;
    expect(String(await sent)).toContain("The model change failed, so the message was not sent.");
    expect(submitted).toEqual([]);
  });

  test("fails instead of silently ignoring model changes for an unloaded session", async () => {
    const adapter = new AgentRuntimeTestAdapter();
    const originalUpdateSessionModel = adapter.updateSessionModel;
    const modelCalls: Array<Parameters<AgentRuntimeTestAdapter["updateSessionModel"]>[0]> = [];
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
