import { describe, expect, test } from "bun:test";
import { toClaudeHistoryMessages } from "./claude-agent-sdk-history";
import { claudeSessionMessageFixture as toSessionMessage } from "./claude-agent-sdk-test-messages";

describe("claude-agent-sdk-history subagents", () => {
  test("places a completed subagent response after tool work that followed its forwarded text", () => {
    // SAFETY: This test controls the fixture and supplies `Parameters<typeof toClaudeHistoryMessages>[0]` used by this case.
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-forwarded-text",
          session_id: "session-1",
          parent_tool_use_id: "task-tool-1",
          timestamp: "2026-06-26T11:04:10.000Z",
          message: {
            id: "response-1",
            role: "assistant",
            content: [{ type: "text", text: "Repository review complete." }],
            stop_reason: null,
          },
        }),
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-read",
          session_id: "session-1",
          parent_tool_use_id: "task-tool-1",
          timestamp: "2026-06-26T11:04:11.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "read-1",
                name: "Read",
                input: { file_path: "/repo/package.json" },
              },
            ],
            stop_reason: "tool_use",
          },
        }),
        toSessionMessage({
          type: "user",
          uuid: "read-result-1",
          session_id: "session-1",
          parent_tool_use_id: "task-tool-1",
          timestamp: "2026-06-26T11:04:12.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "read-1",
                content: "package contents",
              },
            ],
          },
        }),
        {
          type: "result",
          uuid: "result-1",
          timestamp: "2026-06-26T11:04:13.000Z",
          subtype: "success",
          is_error: false,
          result: "Repository review complete.",
          stop_reason: "end_turn",
          terminal_reason: "completed",
          usage: { input_tokens: 2, output_tokens: 3 },
        },
      ] as Parameters<typeof toClaudeHistoryMessages>[0],
      () => "2026-06-26T12:00:00.000Z",
      [],
      { includeNestedEntries: true },
    );

    const finalIndex = history.findIndex(
      (message) =>
        message.role === "assistant" &&
        message.parts.some((part) => part.kind === "step" && part.phase === "finish"),
    );
    const toolIndex = history.findIndex(
      (message) =>
        message.role === "assistant" &&
        message.parts.some((part) => part.kind === "tool" && part.callId === "read-1"),
    );
    expect(toolIndex).toBeGreaterThanOrEqual(0);
    expect(finalIndex).toBeGreaterThan(toolIndex);
    expect(history[finalIndex]).toMatchObject({
      messageId: "response-1",
      timestamp: "2026-06-26T11:04:13.000Z",
      text: "Repository review complete.",
    });
  });

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
    // SAFETY: This test controls the fixture and supplies `Parameters<typeof toClaudeHistoryMessages>[0]` used by this case.
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
          description: "Runtime progress description",
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
        correlationKey: "task-tool-1",
        status: "completed",
        description: "Run affected web tests",
        startedAtMs: Date.parse("2026-06-26T11:04:11.000Z"),
        endedAtMs: Date.parse("2026-06-26T11:04:12.000Z"),
      }),
    ]);
  });

  test("anchors nested Claude task system entries to the selected subagent transcript", () => {
    const parentExternalSessionId = "session-1::claude-subagent::parent-agent";
    // SAFETY: This test controls the fixture and supplies `Parameters<typeof toClaudeHistoryMessages>[0]` used by this case.
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
                id: "task-tool-1",
                name: "Agent",
                input: { description: "Inspect nested behavior" },
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
          task_id: "child-agent",
          tool_use_id: "task-tool-1",
          description: "Inspect nested behavior",
          subagent_type: "Explore",
        },
        {
          type: "system",
          subtype: "task_notification",
          uuid: "task-finished-1",
          session_id: "session-1",
          timestamp: "2026-06-26T11:04:12.000Z",
          task_id: "child-agent",
          status: "completed",
          output_file: "/tmp/child-agent.output",
          summary: "Nested inspection complete",
        },
      ] as Parameters<typeof toClaudeHistoryMessages>[0],
      () => "2026-06-26T12:00:00.000Z",
      [],
      {
        includeNestedEntries: true,
        transcriptExternalSessionId: parentExternalSessionId,
      },
    );

    const subagentParts = history.flatMap((message) =>
      message.parts.filter((part) => part.kind === "subagent"),
    );
    expect(subagentParts).toEqual([
      expect.objectContaining({
        kind: "subagent",
        externalSessionId: `${parentExternalSessionId}::claude-subagent::child-agent`,
        status: "completed",
      }),
    ]);
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
        partId: "claude-subagent:toolu_agent_1",
        correlationKey: "toolu_agent_1",
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

  test("completes a hydrated background Agent from the SDK task notification", () => {
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
                id: "agent-tool-1",
                name: "Agent",
                input: {
                  description: "Review spec compliance",
                  subagent_type: "general-purpose",
                  run_in_background: true,
                  prompt: "Review the spec",
                },
              },
            ],
            stop_reason: "tool_use",
          },
        }),
        toSessionMessage({
          type: "user",
          uuid: "agent-launch-1",
          session_id: "session-1",
          timestamp: "2026-06-26T11:04:11.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "agent-tool-1",
                content: "Agent launched",
              },
            ],
          },
          toolUseResult: {
            status: "async_launched",
            agentId: "agent-1",
          },
        }),
        toSessionMessage({
          type: "user",
          uuid: "00000000-0000-4000-8000-000000000001",
          session_id: "session-1",
          timestamp: "2026-06-26T11:04:12.000Z",
          message: {
            role: "user",
            content: `<task-notification>
<task-id>agent-1</task-id>
<tool-use-id>agent-tool-1</tool-use-id>
<output-file>/tmp/agent-1.output</output-file>
<status>completed</status>
<summary>Agent "Review spec compliance" finished</summary>
</task-notification>`,
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
    );

    expect(
      history
        .flatMap((message) => message.parts)
        .filter((part) => part.kind === "subagent")
        .map((part) => part.status),
    ).toEqual(["completed"]);
  });

  test("updates the original card when a resumed subagent completes through SendMessage", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-agent",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:04:10.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "agent-tool-1",
                name: "Agent",
                input: {
                  description: "Review spec compliance",
                  subagent_type: "general-purpose",
                  run_in_background: true,
                  prompt: "Review the spec",
                },
              },
            ],
            stop_reason: "tool_use",
          },
        }),
        toSessionMessage({
          type: "user",
          uuid: "agent-launch-1",
          session_id: "session-1",
          timestamp: "2026-06-26T11:04:11.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "agent-tool-1",
                content: "Agent launched",
              },
            ],
          },
          toolUseResult: {
            status: "async_launched",
            agentId: "agent-1",
          },
        }),
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-send",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:05:10.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "send-tool-1",
                name: "SendMessage",
                input: {
                  to: "agent-1",
                  message: "Check one more detail.",
                },
              },
            ],
            stop_reason: "tool_use",
          },
        }),
        toSessionMessage({
          type: "user",
          uuid: "00000000-0000-4000-8000-000000000002",
          session_id: "session-1",
          timestamp: "2026-06-26T11:05:12.000Z",
          message: {
            role: "user",
            content: `<task-notification>
<task-id>agent-1</task-id>
<tool-use-id>send-tool-1</tool-use-id>
<output-file>/tmp/agent-1.output</output-file>
<status>completed</status>
<summary>Agent "Review spec compliance" finished</summary>
</task-notification>`,
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
    );

    const subagentEntries = history.flatMap((message) =>
      message.parts.filter((part) => part.kind === "subagent").map((part) => ({ message, part })),
    );
    expect(subagentEntries).toHaveLength(1);
    expect(subagentEntries[0]).toMatchObject({
      message: {
        messageId: "assistant-agent",
        timestamp: "2026-06-26T11:04:10.000Z",
      },
      part: {
        messageId: "assistant-agent",
        partId: "claude-subagent:agent-tool-1",
        correlationKey: "agent-tool-1",
        status: "completed",
        description: "Review spec compliance",
        externalSessionId: "session-1::claude-subagent::agent-1",
        metadata: {
          agentId: "agent-1",
          sourceToolUseId: "agent-tool-1",
          outputFile: "/tmp/agent-1.output",
        },
      },
    });
  });

  test("settles every background Agent in a grouped stopped notification", () => {
    // SAFETY: This test controls the fixture and supplies `Parameters<typeof toClaudeHistoryMessages>[0]` used by this case.
    const history = toClaudeHistoryMessages(
      [
        ...["agent-1", "agent-2"].flatMap((_agentId, index) => {
          const toolUseId = `agent-tool-${index + 1}`;
          return [
            toSessionMessage({
              type: "assistant",
              uuid: `assistant-${index + 1}`,
              session_id: "session-1",
              parent_tool_use_id: null,
              timestamp: `2026-06-26T11:04:1${index}.000Z`,
              message: {
                role: "assistant",
                content: [
                  {
                    type: "tool_use",
                    id: toolUseId,
                    name: "Agent",
                    input: {
                      description: `Review ${index + 1}`,
                      run_in_background: true,
                    },
                  },
                ],
                stop_reason: "tool_use",
              },
            }),
            toSessionMessage({
              type: "user",
              uuid: `agent-launch-${index + 1}`,
              session_id: "session-1",
              timestamp: `2026-06-26T11:04:2${index}.000Z`,
              message: {
                role: "user",
                content: [{ type: "tool_result", tool_use_id: toolUseId, content: "Launched" }],
              },
            }),
          ];
        }),
        toSessionMessage({
          type: "user",
          uuid: "00000000-0000-4000-8000-000000000003",
          session_id: "session-1",
          timestamp: "2026-06-26T11:04:30.000Z",
          message: {
            role: "user",
            content: `<task-notification>
<task-id>agent-1</task-id>
<task-id>agent-2</task-id>
<status>stopped</status>
</task-notification>`,
          },
        }),
      ] as Parameters<typeof toClaudeHistoryMessages>[0],
      () => "2026-06-26T12:00:00.000Z",
      [],
      {
        subagentAgentIdsByToolUseId: new Map([
          ["agent-tool-1", "agent-1"],
          ["agent-tool-2", "agent-2"],
        ]),
      },
    );

    expect(
      history
        .flatMap((message) => message.parts)
        .filter((part) => part.kind === "subagent")
        .map((part) => [part.externalSessionId, part.status, part.description]),
    ).toEqual([
      ["session-1::claude-subagent::agent-1", "cancelled", "Review 1"],
      ["session-1::claude-subagent::agent-2", "cancelled", "Review 2"],
    ]);
  });

  test("anchors an imported nested subagent to its parent Agent tool call", () => {
    const parentExternalSessionId = "session-1::claude-subagent::parent-agent";
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-1",
          session_id: "session-1",
          parent_tool_use_id: "root-agent-tool",
          timestamp: "2026-06-26T11:04:10.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "nested-agent-tool",
                name: "Agent",
                input: {
                  description: "Inspect nested behavior",
                  subagent_type: "Explore",
                  prompt: "Inspect the nested flow",
                },
              },
            ],
            stop_reason: "tool_use",
          },
        }),
        toSessionMessage({
          type: "user",
          uuid: "agent-result-1",
          session_id: "session-1",
          parent_tool_use_id: "root-agent-tool",
          timestamp: "2026-06-26T11:04:11.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "nested-agent-tool",
                content: "Request interrupted by user",
                is_error: true,
              },
            ],
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
      [],
      {
        includeNestedEntries: true,
        subagentAgentIdsByToolUseId: new Map([["nested-agent-tool", "child-agent"]]),
        transcriptExternalSessionId: parentExternalSessionId,
      },
    );

    const nestedPart = history
      .flatMap((message) => message.parts)
      .find((part) => part.kind === "subagent");
    expect(nestedPart).toMatchObject({
      kind: "subagent",
      messageId: "assistant-1",
      status: "running",
      description: "Inspect nested behavior",
      externalSessionId: `${parentExternalSessionId}::claude-subagent::child-agent`,
      metadata: {
        agentId: "child-agent",
        sourceToolUseId: "nested-agent-tool",
      },
    });
    expect(history.find((message) => message.messageId === "assistant-1")?.parts).toEqual([
      expect.objectContaining({ kind: "tool", callId: "nested-agent-tool" }),
      expect.objectContaining({ kind: "subagent", partId: "claude-subagent:nested-agent-tool" }),
    ]);
  });

  test("hydrates a nested background Agent from the SDK launch text", () => {
    const parentExternalSessionId = "session-1::claude-subagent::parent-agent";
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
                id: "agent-tool-1",
                name: "Agent",
                input: {
                  description: "Review diff standards",
                  subagent_type: "general-purpose",
                  run_in_background: true,
                  prompt: "Review the diff",
                },
              },
            ],
            stop_reason: "tool_use",
          },
        }),
        toSessionMessage({
          type: "user",
          uuid: "agent-launch-1",
          session_id: "session-1",
          timestamp: "2026-06-26T11:04:11.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "agent-tool-1",
                content: [
                  {
                    type: "text",
                    text: `Async agent launched successfully. (internal metadata)
agentId: child-agent (internal ID - do not mention to user.)
The agent is working in the background.
output_file: /tmp/child-agent.output`,
                  },
                ],
              },
            ],
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
      [],
      {
        includeNestedEntries: true,
        transcriptExternalSessionId: parentExternalSessionId,
      },
    );

    expect(
      history.flatMap((message) => message.parts).find((part) => part.kind === "subagent"),
    ).toMatchObject({
      kind: "subagent",
      status: "running",
      externalSessionId: `${parentExternalSessionId}::claude-subagent::child-agent`,
      metadata: {
        agentId: "child-agent",
        outputFile: "/tmp/child-agent.output",
        sourceToolUseId: "agent-tool-1",
      },
    });
  });

  test("anchors nested Claude Agent results to the selected subagent transcript", () => {
    const parentExternalSessionId = "session-1::claude-subagent::parent-agent";
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
                  description: "Inspect nested behavior",
                  subagent_type: "Explore",
                  prompt: "Inspect nested behavior",
                },
              },
            ],
            stop_reason: "tool_use",
          },
        }),
        toSessionMessage({
          type: "user",
          uuid: "agent-result-1",
          session_id: "session-1",
          timestamp: "2026-06-26T11:04:13.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_agent_1",
                content: [{ type: "text", text: "Nested inspection complete" }],
              },
            ],
          },
          toolUseResult: {
            status: "completed",
            prompt: "Inspect nested behavior",
            agentId: "child-agent",
            agentType: "Explore",
            content: [{ type: "text", text: "Nested inspection complete" }],
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
      [],
      {
        includeNestedEntries: true,
        transcriptExternalSessionId: parentExternalSessionId,
      },
    );

    expect(
      history.flatMap((message) => message.parts).find((part) => part.kind === "subagent"),
    ).toMatchObject({
      kind: "subagent",
      externalSessionId: `${parentExternalSessionId}::claude-subagent::child-agent`,
    });
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
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-2",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:04:14.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_agent_failed_without_reason",
                name: "Agent",
                input: {
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
          uuid: "agent-result-failed-without-reason",
          sessionId: "session-1",
          timestamp: "2026-06-26T11:04:15.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_agent_failed_without_reason",
              },
            ],
          },
          toolUseResult: {
            status: "failed",
            prompt: "Locate callback.mjs",
            agentId: "failed-agent-2",
            agentType: "Explore",
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
      expect.objectContaining({
        kind: "subagent",
        status: "error",
        error: "Claude subagent failed-agent-2 failed.",
        externalSessionId: "session-1::claude-subagent::failed-agent-2",
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
        partId: "claude-subagent:toolu_agent_async",
        correlationKey: "toolu_agent_async",
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

  test("hydrates a successful TaskStop result as the original subagent card being cancelled", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-agent",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:14:10.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "agent-tool",
                name: "Agent",
                input: {
                  description: "Audit API changes",
                  subagent_type: "Explore",
                  prompt: "Audit the API changes",
                  run_in_background: true,
                },
              },
            ],
            stop_reason: "tool_use",
          },
        }),
        toSessionMessage({
          type: "user",
          uuid: "agent-result",
          sessionId: "session-1",
          timestamp: "2026-06-26T11:14:11.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "agent-tool",
                content: "Background agent launched",
              },
            ],
          },
          toolUseResult: {
            agentId: "agent-1",
            status: "async_launched",
          },
        }),
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-stop",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:14:12.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "stop-tool",
                name: "TaskStop",
                input: { task_id: "agent-1" },
              },
            ],
            stop_reason: "tool_use",
          },
        }),
        toSessionMessage({
          type: "user",
          uuid: "stop-result",
          sessionId: "session-1",
          timestamp: "2026-06-26T11:14:13.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "stop-tool",
                content: JSON.stringify({
                  message: "Successfully stopped task",
                  task_id: "agent-1",
                  task_type: "local_agent",
                }),
              },
            ],
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
        messageId: "assistant-agent",
        partId: "claude-subagent:agent-tool",
        correlationKey: "agent-tool",
        status: "cancelled",
        description: "Audit API changes",
        prompt: "Audit the API changes",
        externalSessionId: "session-1::claude-subagent::agent-1",
        endedAtMs: Date.parse("2026-06-26T11:14:13.000Z"),
      }),
    ]);
    const agentIndex = history.findIndex((message) => message.messageId === "assistant-agent");
    const stopIndex = history.findIndex((message) =>
      message.parts.some((part) => part.kind === "tool" && part.callId === "stop-tool"),
    );
    expect(stopIndex).toBeGreaterThan(agentIndex);
  });
});
