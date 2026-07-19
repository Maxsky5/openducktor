import { describe, expect, test } from "bun:test";
import { toClaudeHistoryMessages } from "./claude-agent-sdk-history";
import { claudeSessionMessageFixture as toSessionMessage } from "./claude-agent-sdk-test-messages";

describe("claude-agent-sdk-history subagents", () => {
  test("does not hydrate subagent sidechain messages into the parent transcript", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "assistant",
          uuid: "subagent-forwarded-parent-tool",
          session_id: "session-1",
          parent_tool_use_id: "task-tool-1",
          timestamp: "2026-06-26T11:04:13.782Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Forwarded subagent assistant text" }],
          },
        }),
        toSessionMessage({
          type: "user",
          uuid: "subagent-user-parent-tool",
          session_id: "session-1",
          parent_tool_use_id: "task-tool-1",
          timestamp: "2026-06-26T11:04:14.000Z",
          message: {
            role: "user",
            content: "Forwarded subagent user text",
          },
        }),
        toSessionMessage({
          type: "assistant",
          uuid: "subagent-assistant",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:04:14.782Z",
          isSidechain: true,
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Nested worker details" }],
          },
        }),
        toSessionMessage({
          type: "assistant",
          uuid: "subagent-forwarded",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:04:15.020Z",
          subagent_type: "Explore",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Forwarded worker details" }],
          },
        }),
        toSessionMessage({
          type: "assistant",
          uuid: "parent-assistant",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:04:16.254Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Parent response" }],
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
    );

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      messageId: "parent-assistant",
      role: "assistant",
      text: "Parent response",
    });
  });

  test("hydrates Claude task system entries as anchored subagent parts", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-1",
          sessionId: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:04:10.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "task-tool-1",
                name: "Task",
                input: { description: "Run affected web tests" },
              },
            ],
          },
        }),
        {
          type: "system",
          subtype: "task_started",
          uuid: "task-started-1",
          session_id: "session-1",
          timestamp: "2026-06-26T11:04:11.000Z",
          task_id: "task-1",
          tool_use_id: "task-tool-1",
          description: "Run affected web tests",
          subagent_type: "general-purpose",
        },
        {
          type: "system",
          subtype: "task_notification",
          uuid: "task-finished-1",
          session_id: "session-1",
          timestamp: "2026-06-26T11:04:12.000Z",
          task_id: "task-1",
          status: "completed",
          summary: "Tests passed",
        },
      ] as Parameters<typeof toClaudeHistoryMessages>[0],
      () => "2026-06-26T12:00:00.000Z",
    );

    const subagentParts = history.flatMap((message) =>
      message.parts.filter((part) => part.kind === "subagent"),
    );
    expect(subagentParts).toEqual([
      expect.objectContaining({
        kind: "subagent",
        messageId: "assistant-1",
        correlationKey: "task-1",
        status: "running",
        description: "Run affected web tests",
        startedAtMs: Date.parse("2026-06-26T11:04:11.000Z"),
      }),
      expect.objectContaining({
        kind: "subagent",
        messageId: "assistant-1",
        correlationKey: "task-1",
        status: "completed",
        endedAtMs: Date.parse("2026-06-26T11:04:12.000Z"),
      }),
    ]);
    expect(subagentParts[1]).not.toHaveProperty("description");
  });

  test("hydrates Claude Agent tool results with the stored subagent transcript id", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-1",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:04:10.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_agent_1",
                name: "Agent",
                input: {
                  description: "Locate package.json path",
                  subagent_type: "Explore",
                  prompt: "Locate package.json",
                },
              },
            ],
            stop_reason: "tool_use",
          },
        }),
        toSessionMessage({
          type: "user",
          uuid: "agent-result-1",
          sessionId: "session-1",
          timestamp: "2026-06-26T11:04:13.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_agent_1",
                content: [{ type: "text", text: "Found package.json" }],
              },
            ],
          },
          toolUseResult: {
            status: "completed",
            prompt: "Locate package.json",
            agentId: "aef1c17051550cb2b",
            agentType: "Explore",
            content: [{ type: "text", text: "Found package.json" }],
            totalDurationMs: 1200,
            totalTokens: 42,
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
    );

    const subagentParts = history.flatMap((message) =>
      message.parts.filter((part) => part.kind === "subagent"),
    );
    expect(subagentParts).toEqual([
      expect.objectContaining({
        kind: "subagent",
        messageId: "assistant-1",
        partId: "claude-subagent:aef1c17051550cb2b",
        correlationKey: "session:toolu_agent_1:session-1::claude-subagent::aef1c17051550cb2b",
        status: "completed",
        agent: "Explore",
        prompt: "Locate package.json",
        description: "Locate package.json path",
        externalSessionId: "session-1::claude-subagent::aef1c17051550cb2b",
        startedAtMs: Date.parse("2026-06-26T11:04:11.800Z"),
        endedAtMs: Date.parse("2026-06-26T11:04:13.000Z"),
        metadata: expect.objectContaining({
          agentId: "aef1c17051550cb2b",
          sourceToolUseId: "toolu_agent_1",
          totalDurationMs: 1200,
          totalTokens: 42,
        }),
      }),
    ]);
  });

  test("hydrates failed Claude Agent tool results with visible error reasons", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-1",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:04:10.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_agent_failed",
                name: "Agent",
                input: {
                  description: "Locate callback.mjs absolute path",
                  subagent_type: "Explore",
                  prompt: "Locate callback.mjs",
                },
              },
            ],
            stop_reason: "tool_use",
          },
        }),
        toSessionMessage({
          type: "user",
          uuid: "agent-result-failed",
          sessionId: "session-1",
          timestamp: "2026-06-26T11:04:13.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_agent_failed",
                content: [{ type: "text", text: "Agent failed" }],
              },
            ],
          },
          toolUseResult: {
            status: "failed",
            prompt: "Locate callback.mjs",
            agentId: "failed-agent-1",
            agentType: "Explore",
            reason: "Tool permission request failed",
            totalDurationMs: 23,
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
    );

    const subagentParts = history.flatMap((message) =>
      message.parts.filter((part) => part.kind === "subagent"),
    );
    expect(subagentParts).toEqual([
      expect.objectContaining({
        kind: "subagent",
        status: "error",
        error: "Tool permission request failed",
        description: "Locate callback.mjs absolute path",
        externalSessionId: "session-1::claude-subagent::failed-agent-1",
      }),
    ]);
  });

  test("hydrates Claude async Agent launches as running background subagents", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-async",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:14:10.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_agent_async",
                name: "Agent",
                input: {
                  description: "Run background verification",
                  subagent_type: "Explore",
                  prompt: "Verify in the background",
                  run_in_background: true,
                },
              },
            ],
            stop_reason: "tool_use",
          },
        }),
        toSessionMessage({
          type: "user",
          uuid: "agent-result-async",
          sessionId: "session-1",
          timestamp: "2026-06-26T11:14:11.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_agent_async",
                content: [{ type: "text", text: "Background agent launched" }],
              },
            ],
          },
          toolUseResult: {
            status: "async_launched",
            agentId: "async-agent-1",
            description: "Run background verification",
            prompt: "Verify in the background",
            resolvedModel: "claude-haiku-4-5-20251001",
            outputFile: "/tmp/async-agent-1.out",
            canReadOutputFile: true,
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
    );

    const subagentParts = history.flatMap((message) =>
      message.parts.filter((part) => part.kind === "subagent"),
    );
    expect(subagentParts).toEqual([
      expect.objectContaining({
        kind: "subagent",
        messageId: "assistant-async",
        partId: "claude-subagent:async-agent-1",
        correlationKey: "session:toolu_agent_async:session-1::claude-subagent::async-agent-1",
        status: "running",
        executionMode: "background",
        agent: "Explore",
        prompt: "Verify in the background",
        description: "Run background verification",
        externalSessionId: "session-1::claude-subagent::async-agent-1",
        metadata: expect.objectContaining({
          agentId: "async-agent-1",
          sourceToolUseId: "toolu_agent_async",
          resolvedModel: "claude-haiku-4-5-20251001",
          outputFile: "/tmp/async-agent-1.out",
          canReadOutputFile: true,
        }),
      }),
    ]);
    expect(subagentParts[0]).not.toHaveProperty("endedAtMs");
  });
});
