import { describe, expect, test } from "bun:test";
import { ODT_MCP_TOOL_NAMES, toOpencodeExposedOdtToolIds } from "@openducktor/contracts";
import { workflowAgentSessionScope } from "@openducktor/core";
import { makeMockClient, OpencodeSdkAdapter, sessionRef, sessionRuntimeRef } from "./test-support";

const repositoryScope = { kind: "repository" } as const;
const runtimePolicy = { kind: "opencode" } as const;

describe("OpencodeSdkAdapter repository sessions", () => {
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
      title: "Repository session",
      sessionAssociation: repositoryScope,
      workingDirectory: "/repo",
    });
    expect(forked).toMatchObject({
      title: "Repository session",
      sessionAssociation: repositoryScope,
    });
    expect(resumed).toMatchObject({
      title: "Repository session",
      sessionAssociation: repositoryScope,
    });
    expect(mock.session.createCalls[0]).toMatchObject({
      directory: "/repo",
      title: "Repository session",
      permission: expect.arrayContaining([
        { permission: "openducktor_*", pattern: "*", action: "deny" },
        { permission: "odt_read_task", pattern: "*", action: "ask" },
        { permission: "odt_create_task", pattern: "*", action: "ask" },
        { permission: "odt_search_tasks", pattern: "*", action: "ask" },
        { permission: "task", pattern: "*", action: "allow" },
      ]),
    });
    expect(mock.session.promptAsyncCalls[0]).toMatchObject({ directory: "/repo" });
    expect(mock.session.updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionID: "repository-fork",
          title: "Repository session",
          permission: expect.arrayContaining([
            { permission: "odt_create_task", pattern: "*", action: "ask" },
          ]),
        }),
        expect.objectContaining({
          sessionID: "repository-resume",
          title: "Repository session",
          permission: expect.arrayContaining([
            { permission: "odt_create_task", pattern: "*", action: "ask" },
          ]),
        }),
      ]),
    );
    const promptTools = (
      mock.session.promptAsyncCalls[0] as {
        tools: Record<string, boolean>;
      }
    ).tools;
    const missingToolIds = ODT_MCP_TOOL_NAMES.flatMap((toolName) =>
      toOpencodeExposedOdtToolIds(toolName),
    ).filter((toolId) => promptTools[toolId] !== true);
    expect(missingToolIds).toEqual([]);
    expect(promptTools).toMatchObject({
      "openducktor_*": false,
      task: true,
      subtask: false,
    });
    expect(mock.mcp.statusCalls.length).toBeGreaterThanOrEqual(5);
    expect(mock.mcp.statusCalls).toEqual(
      expect.arrayContaining([expect.objectContaining({ directory: "/repo" })]),
    );
    expect(mock.mcp.connectCalls).toHaveLength(0);
    expect(mock.tool.idsCalls).toHaveLength(0);
  });

  test("fails before starting a repository session when the trusted MCP stays disconnected", async () => {
    const mock = makeMockClient({
      mcpStatusResponse: { openducktor: { status: "failed", error: "connection closed" } },
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
    ).rejects.toThrow('MCP server "openducktor" stayed unavailable after reconnect');
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
    ).rejects.toThrow("requested workflow scope for task 'task-2' and role 'spec'");
    expect(mock.session.promptAsyncCalls).toHaveLength(promptCount);
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
        title: "BUILD task-1",
        permission: expect.arrayContaining([
          { permission: "odt_build_completed", pattern: "*", action: "allow" },
          { permission: "odt_set_spec", pattern: "*", action: "deny" },
        ]),
      }),
    );
  });

  test("propagates repository session policy update failures", async () => {
    const mock = makeMockClient({
      sessionUpdateResult: { data: undefined, error: new Error("permission update rejected") },
    });
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });

    await expect(
      adapter.resumeSession({
        ...sessionRef("repository-resume"),
        sessionScope: repositoryScope,
        runtimePolicy,
        systemPrompt: "repository system",
      }),
    ).rejects.toThrow(
      "OpenCode request failed: update repository session policy for session 'repository-resume'",
    );
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
    ).rejects.toThrow(
      "OpenCode request failed: update workflow session policy for session 'session-opencode-fork'",
    );
  });

  test("keeps retained model and system prompt when a policy update fails", async () => {
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
    mock.session.updateCalls.length = 0;
    mock.session.updateResult = {
      data: undefined,
      error: new Error("permission update rejected"),
    };

    await expect(
      adapter.resumeSession({
        ...sessionRef(started.externalSessionId),
        sessionScope: repositoryScope,
        runtimePolicy,
        systemPrompt: "replacement system prompt",
        model: { providerId: "openai", modelId: "gpt-5", variant: "high" },
      }),
    ).rejects.toThrow("update repository session policy");
    mock.session.updateResult = { data: { id: started.externalSessionId }, error: undefined };
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
});
