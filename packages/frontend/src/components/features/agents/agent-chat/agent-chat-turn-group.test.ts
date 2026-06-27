import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { buildMessage } from "./agent-chat-test-fixtures";
import {
  type AgentChatThreadMotionRowProps,
  type AgentChatTurnGroupProps,
  areAgentChatThreadMotionRowPropsEqual,
  areAgentChatTurnGroupPropsEqual,
} from "./agent-chat-turn-group-comparator";

const createSessionIdentity = (): AgentSessionIdentity => ({
  externalSessionId: "parent-session",
  runtimeKind: "opencode",
  workingDirectory: "/repo",
});
const resolveRowRef = () => () => {};
const createSubagentSessionKey = (): string =>
  agentSessionIdentityKey({
    ...createSessionIdentity(),
    externalSessionId: "child-session",
  });
const createMessage = () => buildMessage("assistant", "Answer", { id: "assistant-1" });
const createSubagentMessage = () =>
  buildMessage("system", "Subagent", {
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
    rows: [{ kind: "message", key: "parent-session:assistant-1", message: createMessage() }],
    isActive: false,
    activeStreamingAssistantMessageId: null,
  },
  sessionAgentColors: {},
  sessionIdentity: createSessionIdentity(),
  subagentPendingApprovalCountBySessionKey: {},
  subagentPendingQuestionCountBySessionKey: {},
  resolveRowRef,
  allowTurnContainment: true,
  ...overrides,
});

const baseMotionRowProps = (
  overrides: Partial<AgentChatThreadMotionRowProps> = {},
): AgentChatThreadMotionRowProps => ({
  row: { kind: "message", key: "parent-session:assistant-1", message: createMessage() },
  isStreamingAssistantMessage: false,
  sessionAgentColors: { build: "text-sky-700" },
  sessionIdentity: createSessionIdentity(),
  subagentPendingApprovalCount: 0,
  subagentPendingQuestionCount: 0,
  resolveRowRef,
  ...overrides,
});

describe("areAgentChatTurnGroupPropsEqual", () => {
  test("skips rerender for unchanged row identities and equivalent rows", () => {
    const previousProps = baseProps();

    expect(areAgentChatTurnGroupPropsEqual(previousProps, { ...previousProps })).toBe(true);
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
      areAgentChatTurnGroupPropsEqual(previousProps, {
        ...previousProps,
        turn: { ...previousProps.turn, activeStreamingAssistantMessageId: null },
      }),
    ).toBe(true);
  });

  test("recreated pending count maps with unchanged row counts compare equal", () => {
    const props = baseProps({
      turn: {
        key: "turn-subagent",
        rows: [
          { kind: "message", key: "parent-session:subagent-1", message: createSubagentMessage() },
        ],
        isActive: false,
        activeStreamingAssistantMessageId: null,
      },
      subagentPendingApprovalCountBySessionKey: { [createSubagentSessionKey()]: 2 },
      subagentPendingQuestionCountBySessionKey: { [createSubagentSessionKey()]: 1 },
    });

    expect(
      areAgentChatTurnGroupPropsEqual(
        props,
        baseProps({
          ...props,
          subagentPendingApprovalCountBySessionKey: { [createSubagentSessionKey()]: 2 },
          subagentPendingQuestionCountBySessionKey: { [createSubagentSessionKey()]: 1 },
        }),
      ),
    ).toBe(true);
  });

  test("changed subagent pending count for a row in the turn compares unequal", () => {
    const props = baseProps({
      turn: {
        key: "turn-subagent",
        rows: [
          { kind: "message", key: "parent-session:subagent-1", message: createSubagentMessage() },
        ],
        isActive: false,
        activeStreamingAssistantMessageId: null,
      },
      subagentPendingApprovalCountBySessionKey: { [createSubagentSessionKey()]: 2 },
    });

    expect(
      areAgentChatTurnGroupPropsEqual(
        props,
        baseProps({
          ...props,
          subagentPendingApprovalCountBySessionKey: { [createSubagentSessionKey()]: 3 },
        }),
      ),
    ).toBe(false);
  });

  test("rebuilt equal colors and identities do not invalidate turn groups", () => {
    const props = baseProps({ sessionAgentColors: { build: "text-sky-700" } });

    expect(
      areAgentChatTurnGroupPropsEqual(
        props,
        baseProps({
          ...props,
          sessionAgentColors: { build: "text-sky-700" },
          sessionIdentity: createSessionIdentity(),
        }),
      ),
    ).toBe(true);
  });

  test("changed color values invalidate turn groups", () => {
    const props = baseProps({ sessionAgentColors: { build: "text-sky-700" } });

    expect(
      areAgentChatTurnGroupPropsEqual(
        props,
        baseProps({ ...props, sessionAgentColors: { build: "text-rose-700" } }),
      ),
    ).toBe(false);
  });

  test("motion row comparator accepts rebuilt equal colors and identities", () => {
    const props = baseMotionRowProps();

    expect(
      areAgentChatThreadMotionRowPropsEqual(
        props,
        baseMotionRowProps({
          ...props,
          sessionAgentColors: { build: "text-sky-700" },
          sessionIdentity: createSessionIdentity(),
        }),
      ),
    ).toBe(true);
  });

  test("motion row comparator rejects changed color values", () => {
    const props = baseMotionRowProps();

    expect(
      areAgentChatThreadMotionRowPropsEqual(
        props,
        baseMotionRowProps({ ...props, sessionAgentColors: { build: "text-rose-700" } }),
      ),
    ).toBe(false);
  });
});
