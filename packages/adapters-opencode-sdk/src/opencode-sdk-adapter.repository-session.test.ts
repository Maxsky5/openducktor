import { describe, expect, test } from "bun:test";
import { workflowAgentSessionScope } from "@openducktor/core";
import { makeMockClient, OpencodeSdkAdapter, sessionRef, sessionRuntimeRef } from "./test-support";

const repositoryScope = { kind: "repository", title: "Fairnest" } as const;
const runtimePolicy = { kind: "opencode" } as const;

describe("OpencodeSdkAdapter repository sessions", () => {
  test("validates a cold child's native identity before returning its parent", async () => {
    const mock = makeMockClient({ sessionId: "child" });
    const get = mock.client.session.get;
    mock.client.session.get = async (...args) => {
      const result = await get(...args);
      return { ...result, data: { ...result.data!, id: "child", parentID: "root" } };
    };
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    await expect(adapter.resolveSessionParent(sessionRef("child"))).resolves.toBe("root");
    expect(mock.session.getCalls).toEqual([{ sessionID: "child", directory: "/repo" }]);
    await expect(adapter.resolveSessionParent(sessionRef("different"))).rejects.toMatchObject({
      code: "scope_mismatch",
    });
    expect(mock.session.createCalls).toEqual([]);
    expect(mock.session.updateCalls).toEqual([]);
    expect(mock.session.promptCalls).toEqual([]);
  });
  test("preserves native title and permissions when resuming an imported chat without a role", async () => {
    const mock = makeMockClient({ sessionId: "native" });
    const get = mock.client.session.get;
    mock.client.session.get = async (...args) => {
      const result = await get(...args);
      return { ...result, data: { ...result.data!, title: "External native title" } };
    };
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const input = {
      ...sessionRef("native"),
      sessionScope: { kind: "repository" } as const,
      runtimePolicy,
    };
    expect((await adapter.resumeSession(input)).title).toBe("External native title");
    await adapter.resumeSession(input);
    await adapter.sendUserMessage({ ...input, parts: [{ kind: "text", text: "Continue" }] });
    expect(mock.session.updateCalls).toEqual([]);
    expect(mock.session.createCalls).toEqual([]);
    expect(mock.session.promptAsyncCalls).toHaveLength(1);
    await adapter.releaseSession(input);
  });

  test("applies the durable title when resuming a role-less repository session", async () => {
    const mock = makeMockClient({ sessionId: "repository-resume" });
    const get = mock.client.session.get;
    mock.client.session.get = async (...args) => {
      const result = await get(...args);
      return { ...result, data: { ...result.data!, title: "External native title" } };
    };
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const input = {
      ...sessionRef("repository-resume"),
      sessionScope: repositoryScope,
      runtimePolicy,
    };

    const resumed = await adapter.resumeSession(input);

    expect(resumed.title).toBe("Fairnest");
    expect(mock.session.updateCalls).toContainEqual({
      directory: "/repo",
      sessionID: "repository-resume",
      title: "Fairnest",
    });
    await adapter.releaseSession(input);
  });

  test("sets the saved title when an attached role-less repository session resumes", async () => {
    const mock = makeMockClient({ sessionId: "repository-resume" });
    const get = mock.client.session.get;
    mock.client.session.get = async (...args) => {
      const result = await get(...args);
      return { ...result, data: { ...result.data!, title: "External native title" } };
    };
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const input = {
      ...sessionRef("repository-resume"),
      sessionScope: repositoryScope,
      runtimePolicy,
    };
    await adapter.resumeSession({ ...input, sessionScope: { kind: "repository" } });
    mock.session.updateCalls.length = 0;

    const resumed = await adapter.resumeSession(input);

    expect(resumed.title).toBe("Fairnest");
    expect(mock.session.updateCalls).toContainEqual({
      directory: "/repo",
      sessionID: "repository-resume",
      title: "Fairnest",
    });
    await adapter.releaseSession(input);
  });

  test("keeps the native title when a role-less repository resume cannot apply the durable title", async () => {
    const mock = makeMockClient({ sessionId: "repository-resume" });
    const get = mock.client.session.get;
    mock.client.session.get = async (...args) => {
      const result = await get(...args);
      return { ...result, data: { ...result.data!, title: "External native title" } };
    };
    mock.client.session.update = async () => {
      throw new Error("update rejected");
    };
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const input = {
      ...sessionRef("repository-resume"),
      sessionScope: repositoryScope,
      runtimePolicy,
    };

    expect((await adapter.resumeSession(input)).title).toBe("External native title");
    await adapter.releaseSession(input);
  });

  test("connects the trusted MCP and applies its full catalog across the repository lifecycle", async () => {
    const mock = makeMockClient({
      sessionId: "repository-session",
      forkSessionId: "repository-fork",
    });
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });

    const started = await adapter.startSession({
      repoPath: "/repo",
      workingDirectory: "/repo",
      runtimeKind: "opencode",
      sessionScope: repositoryScope,
      runtimePolicy,
      systemPrompt: "repository system",
    });
    expect(mock.session.deleteCalls).toEqual([]);
    await adapter.sendUserMessage({
      ...sessionRuntimeRef(started.externalSessionId, { sessionScope: repositoryScope }),
      parts: [{ kind: "text", text: "Inspect the repository" }],
    });
    await adapter.loadSessionHistory(
      sessionRuntimeRef(started.externalSessionId, { sessionScope: repositoryScope }),
    );
    const forked = await adapter.forkSession({
      repoPath: "/repo",
      workingDirectory: "/repo",
      runtimeKind: "opencode",
      parentExternalSessionId: started.externalSessionId,
      sessionScope: repositoryScope,
      runtimePolicy,
      systemPrompt: "repository system",
    });
    const resumed = await adapter.resumeSession({
      ...sessionRef("repository-resume"),
      sessionScope: repositoryScope,
      runtimePolicy,
      systemPrompt: "repository system",
    });

    expect(started).toMatchObject({
      title: "Fairnest",
      sessionAssociation: repositoryScope,
      workingDirectory: "/repo",
    });
    expect(forked).toMatchObject({
      title: "Fairnest",
      sessionAssociation: repositoryScope,
    });
    expect(resumed).toMatchObject({
      title: "Fairnest",
      sessionAssociation: repositoryScope,
    });
    expect(mock.session.createCalls[0]).toMatchObject({
      directory: "/repo",
      title: "Fairnest",
      permission: expect.arrayContaining([
        { permission: "openducktor_*", pattern: "*", action: "deny" },
        { permission: "odt_read_task", pattern: "*", action: "allow" },
        { permission: "odt_create_task", pattern: "*", action: "allow" },
        { permission: "odt_search_tasks", pattern: "*", action: "allow" },
      ]),
    });
    expect(mock.session.promptAsyncCalls[0]).toMatchObject({ directory: "/repo" });
    expect(mock.session.updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionID: "repository-fork",
          permission: expect.arrayContaining([
            { permission: "odt_create_task", pattern: "*", action: "allow" },
          ]),
        }),
        expect.objectContaining({ sessionID: "repository-resume", title: "Fairnest" }),
      ]),
    );
    expect(
      mock.session.updateCalls
        .filter((call) => call.sessionID === "repository-resume")
        .every((call) => call.permission === undefined),
    ).toBe(true);
    expect(mock.session.promptAsyncCalls[0]).not.toHaveProperty("tools");
    expect(mock.mcp.addCalls).toEqual([
      expect.objectContaining({ directory: "/repo", name: "openducktor" }),
    ]);
    expect(mock.mcp.statusCalls).toHaveLength(3);
    expect(mock.mcp.statusCalls).toEqual(
      expect.arrayContaining([expect.objectContaining({ directory: "/repo" })]),
    );
    expect(mock.mcp.connectCalls).toHaveLength(0);
    expect(mock.tool.idsCalls).toHaveLength(0);
  });

  test("renames a live repository session and keeps its association title", async () => {
    const mock = makeMockClient();
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const started = await adapter.startSession({
      repoPath: "/repo",
      workingDirectory: "/repo",
      runtimeKind: "opencode",
      sessionScope: repositoryScope,
      runtimePolicy,
      systemPrompt: "repository system",
    });

    const renamed = await adapter.updateSessionTitle({
      ...sessionRuntimeRef(started.externalSessionId, { sessionScope: repositoryScope }),
      title: "Renamed",
    });

    expect(renamed).toMatchObject({
      status: "renamed",
      summary: {
        title: "Renamed",
        sessionAssociation: { kind: "repository", title: "Renamed" },
      },
    });
    expect(mock.session.updateCalls).toContainEqual(
      expect.objectContaining({
        directory: "/repo",
        sessionID: started.externalSessionId,
        title: "Renamed",
      }),
    );
  });

  test("reports a title update for an unknown OpenCode session as not attached", async () => {
    const mock = makeMockClient();
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const updateCallCount = mock.session.updateCalls.length;

    expect(
      await adapter.updateSessionTitle({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
        externalSessionId: "missing",
        title: "Renamed",
      }),
    ).toEqual({ status: "not_attached" });
    expect(mock.session.updateCalls).toHaveLength(updateCallCount);
  });

  test("refuses to rename a repository session from another working directory", async () => {
    const mock = makeMockClient();
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const started = await adapter.startSession({
      repoPath: "/repo",
      workingDirectory: "/repo",
      runtimeKind: "opencode",
      sessionScope: repositoryScope,
      runtimePolicy,
      systemPrompt: "repository system",
    });
    const updateCallCount = mock.session.updateCalls.length;

    await expect(
      adapter.updateSessionTitle({
        ...sessionRuntimeRef(started.externalSessionId, {
          sessionScope: repositoryScope,
          workingDirectory: "/repo/worktrees/stale",
        }),
        title: "Renamed",
      }),
    ).rejects.toThrow("registered session belongs");

    expect(mock.session.updateCalls).toHaveLength(updateCallCount);
  });

  test("preserves native policy when sending from a retained unbound repository session", async () => {
    const mock = makeMockClient();
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const unsubscribe = await adapter.subscribeEvents(
      sessionRuntimeRef("session-opencode-1", { sessionScope: undefined }),
      () => {},
    );
    expect(mock.session.updateCalls).toHaveLength(0);

    await adapter.sendUserMessage({
      ...sessionRuntimeRef("session-opencode-1", { sessionScope: repositoryScope }),
      parts: [{ kind: "text", text: "Inspect the repository" }],
    });

    expect(mock.session.updateCalls).toContainEqual(
      expect.objectContaining({
        sessionID: "session-opencode-1",
        title: "Fairnest",
      }),
    );
    expect(mock.session.promptAsyncCalls).toHaveLength(1);
    unsubscribe();
  });

  test("reads scoped history of a retained unbound session without mutation", async () => {
    const mock = makeMockClient();
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const unsubscribe = await adapter.subscribeEvents(
      sessionRuntimeRef("session-opencode-1", { sessionScope: undefined }),
      () => {},
    );
    await expect(
      adapter.loadSessionHistory(
        sessionRuntimeRef("session-opencode-1", { sessionScope: repositoryScope }),
      ),
    ).resolves.toEqual([]);
    expect(mock.session.updateCalls).toHaveLength(0);
    expect(mock.session.todoCalls).toHaveLength(0);
    unsubscribe();
  });

  test("reads scoped todos of a retained unbound session without mutation", async () => {
    const mock = makeMockClient();
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const unsubscribe = await adapter.subscribeEvents(
      sessionRuntimeRef("session-opencode-1", { sessionScope: undefined }),
      () => {},
    );
    await expect(
      adapter.loadSessionTodos(
        sessionRuntimeRef("session-opencode-1", { sessionScope: repositoryScope }),
      ),
    ).resolves.toEqual([]);
    expect(mock.session.updateCalls).toHaveLength(0);
    expect(mock.session.todoCalls).toHaveLength(1);
    unsubscribe();
  });

  test("preserves native policy when subscribing to a retained unbound repository session", async () => {
    const mock = makeMockClient();
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const unsubscribeUnbound = await adapter.subscribeEvents(
      sessionRuntimeRef("session-opencode-1", { sessionScope: undefined }),
      () => {},
    );

    const unsubscribeRepository = await adapter.subscribeEvents(
      sessionRuntimeRef("session-opencode-1", { sessionScope: repositoryScope }),
      () => {},
    );

    expect(mock.session.updateCalls).toContainEqual(
      expect.objectContaining({
        sessionID: "session-opencode-1",
        title: "Fairnest",
      }),
    );
    unsubscribeRepository();
    unsubscribeUnbound();
  });

  test("rejects a mismatched scope before subscribing to a loaded session", async () => {
    const mock = makeMockClient();
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const unsubscribeWorkflow = await adapter.subscribeEvents(
      sessionRuntimeRef("session-opencode-1", {
        sessionScope: workflowAgentSessionScope("task-1", "build"),
      }),
      () => {},
    );
    const updateCallCount = mock.session.updateCalls.length;

    await expect(
      adapter.subscribeEvents(
        sessionRuntimeRef("session-opencode-1", { sessionScope: repositoryScope }),
        () => {},
      ),
    ).rejects.toThrow(
      "registered workflow scope for task 'task-1' and role 'build' does not match the requested repository scope",
    );

    expect(mock.session.updateCalls).toHaveLength(updateCallCount);
    unsubscribeWorkflow();
  });

  test("rejects a mismatched scope before reading todos from a loaded session", async () => {
    const mock = makeMockClient();
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const unsubscribeWorkflow = await adapter.subscribeEvents(
      sessionRuntimeRef("session-opencode-1", {
        sessionScope: workflowAgentSessionScope("task-1", "build"),
      }),
      () => {},
    );

    await expect(
      adapter.loadSessionTodos(
        sessionRuntimeRef("session-opencode-1", { sessionScope: repositoryScope }),
      ),
    ).rejects.toThrow("does not belong to the requested scope");

    expect(mock.session.todoCalls).toHaveLength(0);
    unsubscribeWorkflow();
  });

  test("keeps a loaded session unbound when subscription policy binding fails", async () => {
    const mock = makeMockClient();
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const unsubscribeUnbound = await adapter.subscribeEvents(
      sessionRuntimeRef("session-opencode-1", { sessionScope: undefined }),
      () => {},
    );
    mock.session.updateResult = {
      data: undefined,
      error: new Error("permission update rejected"),
    };
    const repositorySessionRef = sessionRuntimeRef("session-opencode-1", {
      sessionScope: workflowAgentSessionScope("task-1", "build"),
    });

    await expect(adapter.subscribeEvents(repositorySessionRef, () => {})).rejects.toThrow(
      "install permissions",
    );

    mock.session.updateResult = {};
    const unsubscribeRepository = await adapter.subscribeEvents(repositorySessionRef, () => {});

    expect(mock.session.updateCalls.filter((call) => call.permission !== undefined)).toHaveLength(
      2,
    );
    unsubscribeRepository();
    unsubscribeUnbound();
  });

  test("keeps a loaded session unbound when approval policy binding fails", async () => {
    const mock = makeMockClient();
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const unsubscribe = await adapter.subscribeEvents(
      sessionRuntimeRef("session-opencode-1", { sessionScope: undefined }),
      () => {},
    );
    mock.session.updateResult = {
      data: undefined,
      error: new Error("permission update rejected"),
    };
    const replyInput = {
      ...sessionRuntimeRef("session-opencode-1", {
        sessionScope: workflowAgentSessionScope("task-1", "build"),
      }),
      requestId: "permission-1",
      outcome: "approve_once" as const,
    };

    await expect(adapter.replyApproval(replyInput)).rejects.toThrow("install permissions");
    expect(mock.permission.replyCalls).toHaveLength(0);

    mock.session.updateResult = {};
    await adapter.replyApproval(replyInput);

    expect(mock.session.updateCalls.filter((call) => call.permission !== undefined)).toHaveLength(
      2,
    );
    expect(mock.permission.replyCalls).toHaveLength(1);
    unsubscribe();
  });

  test("rejects a stale working directory before replying to a retained repository approval", async () => {
    const mock = makeMockClient();
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const started = await adapter.startSession({
      repoPath: "/repo",
      workingDirectory: "/repo",
      runtimeKind: "opencode",
      sessionScope: repositoryScope,
      runtimePolicy,
      systemPrompt: "repository system",
    });

    await expect(
      adapter.replyApproval({
        ...sessionRuntimeRef(started.externalSessionId, {
          sessionScope: repositoryScope,
          workingDirectory: "/repo/worktrees/stale",
        }),
        requestId: "permission-1",
        outcome: "approve_once",
      }),
    ).rejects.toThrow("registered session belongs");

    expect(mock.permission.replyCalls).toHaveLength(0);
  });

  test("rejects a stale repository before replying to a retained repository question", async () => {
    const mock = makeMockClient();
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const started = await adapter.startSession({
      repoPath: "/repo",
      workingDirectory: "/repo",
      runtimeKind: "opencode",
      sessionScope: repositoryScope,
      runtimePolicy,
      systemPrompt: "repository system",
    });

    await expect(
      adapter.replyQuestion({
        ...sessionRuntimeRef(started.externalSessionId, {
          repoPath: "/other-repo",
          sessionScope: repositoryScope,
        }),
        requestId: "question-1",
        answers: [["Continue"]],
      }),
    ).rejects.toThrow("registered session belongs");

    expect(mock.question.replyCalls).toHaveLength(0);
  });

  test("fails before starting a repository session when the trusted MCP does not connect", async () => {
    const mock = makeMockClient({
      mcpAddResponse: { openducktor: { status: "failed", error: "connection closed" } },
    });
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });

    await expect(
      adapter.startSession({
        repoPath: "/repo",
        workingDirectory: "/repo",
        runtimeKind: "opencode",
        sessionScope: repositoryScope,
        runtimePolicy,
        systemPrompt: "repository system",
      }),
    ).rejects.toThrow('Status is "failed" (connection closed)');
    expect(mock.session.createCalls).toHaveLength(0);
  });

  test("rejects repository and workflow scope changes for a bound session", async () => {
    const mock = makeMockClient();
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const started = await adapter.startSession({
      repoPath: "/repo",
      workingDirectory: "/repo",
      runtimeKind: "opencode",
      sessionScope: repositoryScope,
      runtimePolicy,
      systemPrompt: "repository system",
    });

    await expect(
      adapter.resumeSession({
        ...sessionRef(started.externalSessionId),
        sessionScope: workflowAgentSessionScope("task-1", "build"),
        runtimePolicy,
        systemPrompt: "workflow system",
      }),
    ).rejects.toThrow("registered repository scope does not match the requested workflow scope");
    await expect(
      adapter.sendUserMessage({
        ...sessionRuntimeRef(started.externalSessionId, {
          sessionScope: workflowAgentSessionScope("task-1", "build"),
        }),
        parts: [{ kind: "text", text: "Continue" }],
      }),
    ).rejects.toThrow("registered repository scope does not match the requested workflow scope");
    expect(mock.session.promptAsyncCalls).toHaveLength(0);
  });

  test("rejects a different workflow task or role for a bound session", async () => {
    const mock = makeMockClient();
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const started = await adapter.startSession({
      repoPath: "/repo",
      workingDirectory: "/repo",
      runtimeKind: "opencode",
      sessionScope: workflowAgentSessionScope("task-1", "spec"),
      runtimePolicy,
      systemPrompt: "system",
    });
    const promptCount = mock.session.promptAsyncCalls.length;

    await expect(
      adapter.resumeSession({
        ...sessionRef(started.externalSessionId),
        sessionScope: workflowAgentSessionScope("task-2", "build"),
        runtimePolicy,
        systemPrompt: "system",
      }),
    ).rejects.toThrow("registered workflow scope for task 'task-1' and role 'spec'");
    await expect(
      adapter.sendUserMessage({
        ...sessionRuntimeRef(started.externalSessionId, {
          sessionScope: workflowAgentSessionScope("task-1", "build"),
        }),
        parts: [{ kind: "text", text: "Continue" }],
      }),
    ).rejects.toThrow("requested workflow scope for task 'task-1' and role 'build'");
    await expect(
      adapter.loadSessionHistory(
        sessionRuntimeRef(started.externalSessionId, {
          sessionScope: workflowAgentSessionScope("task-2", "spec"),
        }),
      ),
    ).rejects.toThrow("does not belong to the requested scope");
    expect(mock.session.promptAsyncCalls).toHaveLength(promptCount);
  });

  test("rejects stale history identity before changing a retained repository session", async () => {
    const mock = makeMockClient();
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const started = await adapter.startSession({
      repoPath: "/repo",
      workingDirectory: "/repo",
      runtimeKind: "opencode",
      sessionScope: repositoryScope,
      runtimePolicy,
      systemPrompt: "original system prompt",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
    const mcpStatusCallCount = mock.mcp.statusCalls.length;

    await expect(
      adapter.loadSessionHistory(
        sessionRuntimeRef(started.externalSessionId, {
          sessionScope: repositoryScope,
          workingDirectory: "/repo/worktrees/stale",
          systemPrompt: "replacement system prompt",
          model: { providerId: "openai", modelId: "gpt-5", variant: "high" },
        }),
      ),
    ).rejects.toThrow("The registered session belongs to another repository");
    expect(mock.mcp.statusCalls).toHaveLength(mcpStatusCallCount);
    expect(mock.session.messagesCalls).toHaveLength(0);

    await adapter.sendUserMessage({
      ...sessionRuntimeRef(started.externalSessionId, {
        sessionScope: repositoryScope,
        systemPrompt: undefined,
      }),
      parts: [{ kind: "text", text: "Continue" }],
    });
    expect(mock.session.promptAsyncCalls[0]).toMatchObject({
      system: "original system prompt",
      model: { providerID: "openai", modelID: "gpt-5" },
      variant: "medium",
    });
  });

  test("allows an explicit workflow role change when forking", async () => {
    const mock = makeMockClient();
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const started = await adapter.startSession({
      repoPath: "/repo",
      workingDirectory: "/repo",
      runtimeKind: "opencode",
      sessionScope: workflowAgentSessionScope("task-1", "spec"),
      runtimePolicy,
      systemPrompt: "system",
    });

    await expect(
      adapter.forkSession({
        repoPath: "/repo",
        workingDirectory: "/repo",
        runtimeKind: "opencode",
        parentExternalSessionId: started.externalSessionId,
        sessionScope: workflowAgentSessionScope("task-1", "build"),
        runtimePolicy,
        systemPrompt: "system",
      }),
    ).resolves.toMatchObject({
      title: "BUILD task-1",
      sessionAssociation: workflowAgentSessionScope("task-1", "build"),
    });
    expect(mock.session.updateCalls).toContainEqual(
      expect.objectContaining({
        sessionID: "session-opencode-fork",
        permission: expect.arrayContaining([
          { permission: "odt_build_completed", pattern: "*", action: "allow" },
          { permission: "odt_set_spec", pattern: "*", action: "deny" },
        ]),
      }),
    );
  });

  test("preserves imported permissions even when the permission update API would fail", async () => {
    const mock = makeMockClient({
      sessionUpdateResult: { error: new Error("permission update rejected") },
    });
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    await adapter.resumeSession({
      ...sessionRef("repository-resume"),
      sessionScope: { kind: "repository" },
      runtimePolicy,
      systemPrompt: "repository system",
    });
    expect(mock.session.updateCalls).toEqual([]);
  });

  test("propagates workflow fork policy update failures", async () => {
    const mock = makeMockClient({
      sessionUpdateResult: { data: undefined, error: new Error("permission update rejected") },
    });
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const started = await adapter.startSession({
      repoPath: "/repo",
      workingDirectory: "/repo",
      runtimeKind: "opencode",
      sessionScope: workflowAgentSessionScope("task-1", "spec"),
      runtimePolicy,
      systemPrompt: "system",
    });

    await expect(
      adapter.forkSession({
        repoPath: "/repo",
        workingDirectory: "/repo",
        runtimeKind: "opencode",
        parentExternalSessionId: started.externalSessionId,
        sessionScope: workflowAgentSessionScope("task-1", "build"),
        runtimePolicy,
        systemPrompt: "system",
      }),
    ).rejects.toThrow("install permissions for OpenCode session 'session-opencode-fork'");
  });

  test("deletes a fork when applying its workflow policy fails", async () => {
    const mock = makeMockClient({
      sessionUpdateResult: { data: undefined, error: new Error("permission update rejected") },
    });
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const started = await adapter.startSession({
      repoPath: "/repo",
      workingDirectory: "/repo",
      runtimeKind: "opencode",
      sessionScope: workflowAgentSessionScope("task-1", "spec"),
      runtimePolicy,
      systemPrompt: "system",
    });

    await expect(
      adapter.forkSession({
        repoPath: "/repo",
        workingDirectory: "/repo",
        runtimeKind: "opencode",
        parentExternalSessionId: started.externalSessionId,
        sessionScope: workflowAgentSessionScope("task-1", "build"),
        runtimePolicy,
        systemPrompt: "system",
      }),
    ).rejects.toThrow("install permissions");
    expect(mock.session.deleteCalls).toEqual([
      { directory: "/repo", sessionID: "session-opencode-fork" },
    ]);
  });

  test("keeps retained model and system prompt when a policy update fails", async () => {
    const mock = makeMockClient();
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const started = await adapter.startSession({
      repoPath: "/repo",
      workingDirectory: "/repo",
      runtimeKind: "opencode",
      sessionScope: workflowAgentSessionScope("task-1", "build"),
      runtimePolicy,
      systemPrompt: "original system prompt",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
    mock.session.updateCalls.length = 0;
    await mock.client.session.update({
      sessionID: started.externalSessionId,
      directory: "/repo",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    });
    mock.session.updateResult = {
      data: undefined,
      error: new Error("permission update rejected"),
    };

    await expect(
      adapter.resumeSession({
        ...sessionRef(started.externalSessionId),
        sessionScope: workflowAgentSessionScope("task-1", "build"),
        runtimePolicy,
        systemPrompt: "replacement system prompt",
        model: { providerId: "openai", modelId: "gpt-5", variant: "high" },
      }),
    ).rejects.toThrow("install permissions");
    mock.session.updateResult = {};
    await adapter.resumeSession({
      ...sessionRuntimeRef(started.externalSessionId, {
        sessionScope: workflowAgentSessionScope("task-1", "build"),
        systemPrompt: undefined,
      }),
    });
    await adapter.sendUserMessage({
      ...sessionRuntimeRef(started.externalSessionId, {
        sessionScope: workflowAgentSessionScope("task-1", "build"),
        systemPrompt: undefined,
      }),
      parts: [{ kind: "text", text: "Continue" }],
    });

    expect(mock.session.promptAsyncCalls[0]).toMatchObject({
      system: "original system prompt",
      model: { providerID: "openai", modelID: "gpt-5" },
      variant: "medium",
    });
  });
});
