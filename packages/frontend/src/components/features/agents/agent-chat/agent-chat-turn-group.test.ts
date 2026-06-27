import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { buildMessage } from "./agent-chat-test-fixtures";
import {
  type AgentChatTurnGroupProps,
  areAgentChatTurnGroupPropsEqual,
} from "./agent-chat-turn-group";

const sessionIdentity: AgentSessionIdentity = {
  externalSessionId: "parent-session",
  runtimeKind: "opencode",
  workingDirectory: "/repo",
};
const sessionAgentColors: Record<string, string> = {};
const resolveRowRef = () => () => {};
const subagentSessionKey = agentSessionIdentityKey({
  ...sessionIdentity,
  externalSessionId: "child-session",
});
const message = buildMessage("assistant", "Answer", { id: "assistant-1" });
const subagentMessage = buildMessage("system", "Subagent", {
  id: "subagent-1",
  meta: {
    kind: "subagent",
    partId: "part-subagent-1",
    correlationKey: "part:subagent-1",
    status: "running",
    externalSessionId: "child-session",
  },
});

const baseProps = (overrides: Partial<AgentChatTurnGroupProps> = {}): AgentChatTurnGroupProps => ({
  turn: {
    key: "turn-1",
    rows: [{ kind: "message", key: "parent-session:assistant-1", message }],
    isActive: false,
    activeStreamingAssistantMessageId: null,
  },
  sessionAgentColors,
  sessionIdentity,
  subagentPendingApprovalCountBySessionKey: {},
  subagentPendingQuestionCountBySessionKey: {},
  resolveRowRef,
  allowTurnContainment: true,
  ...overrides,
});

describe("areAgentChatTurnGroupPropsEqual", () => {
  test("skips rerender for unchanged row identities and equivalent rows", () => {
    const previousProps = baseProps();

    expect(areAgentChatTurnGroupPropsEqual(previousProps, baseProps())).toBe(true);
    expect(
      areAgentChatTurnGroupPropsEqual(
        baseProps({
          turn: {
            key: "turn-duration",
            rows: [{ kind: "turn_duration", key: "duration-1", durationMs: 1_000 }],
            isActive: false,
            activeStreamingAssistantMessageId: null,
          },
        }),
        baseProps({
          turn: {
            key: "turn-duration",
            rows: [{ kind: "turn_duration", key: "duration-1", durationMs: 1_000 }],
            isActive: false,
            activeStreamingAssistantMessageId: null,
          },
        }),
      ),
    ).toBe(true);
  });

  test("active streaming assistant id differences only invalidate the affected turn", () => {
    const previousProps = baseProps();

    expect(
      areAgentChatTurnGroupPropsEqual(
        previousProps,
        baseProps({
          turn: { ...previousProps.turn, activeStreamingAssistantMessageId: "assistant-1" },
        }),
      ),
    ).toBe(false);
    expect(
      areAgentChatTurnGroupPropsEqual(
        previousProps,
        baseProps({
          turn: { ...previousProps.turn, activeStreamingAssistantMessageId: null },
        }),
      ),
    ).toBe(true);
  });

  test("recreated pending count maps with unchanged row counts compare equal", () => {
    const props = baseProps({
      turn: {
        key: "turn-subagent",
        rows: [{ kind: "message", key: "parent-session:subagent-1", message: subagentMessage }],
        isActive: false,
        activeStreamingAssistantMessageId: null,
      },
      subagentPendingApprovalCountBySessionKey: { [subagentSessionKey]: 2 },
      subagentPendingQuestionCountBySessionKey: { [subagentSessionKey]: 1 },
    });

    expect(
      areAgentChatTurnGroupPropsEqual(
        props,
        baseProps({
          ...props,
          subagentPendingApprovalCountBySessionKey: { [subagentSessionKey]: 2 },
          subagentPendingQuestionCountBySessionKey: { [subagentSessionKey]: 1 },
        }),
      ),
    ).toBe(true);
  });

  test("changed subagent pending count for a row in the turn compares unequal", () => {
    const props = baseProps({
      turn: {
        key: "turn-subagent",
        rows: [{ kind: "message", key: "parent-session:subagent-1", message: subagentMessage }],
        isActive: false,
        activeStreamingAssistantMessageId: null,
      },
      subagentPendingApprovalCountBySessionKey: { [subagentSessionKey]: 2 },
    });

    expect(
      areAgentChatTurnGroupPropsEqual(
        props,
        baseProps({
          ...props,
          subagentPendingApprovalCountBySessionKey: { [subagentSessionKey]: 3 },
        }),
      ),
    ).toBe(false);
  });
});
