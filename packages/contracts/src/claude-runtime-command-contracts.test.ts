import { describe, expect, test } from "bun:test";
import { agentModelCatalogSchema, agentSessionHistoryMessageSchema } from "./agent-engine-schemas";
import {
  agentSessionTodoItemSchema,
  agentStreamPartSchema,
  agentUserMessageDisplayPartSchema,
} from "./agent-session-event-schemas";
import {
  CLAUDE_RUNTIME_COMMAND_CONTRACTS,
  CLAUDE_RUNTIME_HOST_COMMAND_NAMES,
  claudeAgentModelCatalogSchema,
  claudeAgentSessionHistoryMessageSchema,
  claudeAgentSessionTodoItemSchema,
  claudeAgentStreamPartSchema,
  claudeAgentUserMessageDisplayPartSchema,
  claudeLoadAgentSessionHistoryInputSchema,
  claudeSearchAgentFilesInputSchema,
} from "./claude-runtime-command-contracts";

describe("Claude runtime command contracts", () => {
  test("keeps public command contracts runtime-owned", () => {
    expect(CLAUDE_RUNTIME_HOST_COMMAND_NAMES.length).toBeGreaterThan(0);
    expect(
      CLAUDE_RUNTIME_HOST_COMMAND_NAMES.every((command) => command.startsWith("claude_runtime_")),
    ).toBe(true);
    expect(CLAUDE_RUNTIME_HOST_COMMAND_NAMES.some((command) => command.includes("agent_sdk"))).toBe(
      false,
    );
    expect(
      Object.values(CLAUDE_RUNTIME_COMMAND_CONTRACTS).some((contract) =>
        Object.keys(contract).includes("clientMethod"),
      ),
    ).toBe(false);
  });

  test("allows empty file-search queries for initial autocomplete", () => {
    expect(
      claudeSearchAgentFilesInputSchema.parse({
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo",
        query: "",
      }),
    ).toEqual({
      repoPath: "/repo",
      runtimeKind: "claude",
      workingDirectory: "/repo",
      query: "",
    });
  });

  test("accepts the selected model carried by a policy-bound history reference", () => {
    expect(
      claudeLoadAgentSessionHistoryInputSchema.parse({
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo",
        externalSessionId: "session-1",
        runtimePolicy: { kind: "claude" },
        model: {
          runtimeKind: "claude",
          providerId: "claude",
          modelId: "claude-sonnet-4-6",
          variant: "high",
        },
      }),
    ).toEqual({
      repoPath: "/repo",
      runtimeKind: "claude",
      workingDirectory: "/repo",
      externalSessionId: "session-1",
      runtimePolicy: { kind: "claude" },
      model: {
        runtimeKind: "claude",
        providerId: "claude",
        modelId: "claude-sonnet-4-6",
        variant: "high",
      },
    });
  });

  test("composes runtime-neutral response schemas instead of redefining them", () => {
    expect(claudeAgentModelCatalogSchema).toBe(agentModelCatalogSchema);
    expect(claudeAgentSessionHistoryMessageSchema).toBe(agentSessionHistoryMessageSchema);
    expect(claudeAgentSessionTodoItemSchema).toBe(agentSessionTodoItemSchema);
    expect(claudeAgentStreamPartSchema).toBe(agentStreamPartSchema);
    expect(claudeAgentUserMessageDisplayPartSchema).toBe(agentUserMessageDisplayPartSchema);
  });
});
