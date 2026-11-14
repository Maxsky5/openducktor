import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import { presentRegularToolCall } from "./agent-chat-test-fixtures";
import { buildMessage } from "@openducktor/frontend-core/test-support/agent-chat-transcript-fixtures";
import type { AgentChatTranscriptRow } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import {
  groupToolRuns,
  readToolRunClassifier,
} from "@openducktor/frontend-core/sessions/transcript/tool-runs";
import { buildToolRunWindowRows, buildTurnItems } from "./agent-chat-tool-run-layout";
import {
  type AgentChatTurnRowProps,
  type AgentChatTurnGroupProps,
  areAgentChatTurnRowPropsEqual,
  areAgentChatTurnGroupPropsEqual,
  isAgentChatTurnRowStreamingAssistant,
} from "./agent-chat-turn-group-comparator";

const NO_FOLDS = { choices: new Map(), keptHidden: new Map() };

const createSessionIdentity = (): AgentSessionIdentity => ({
  externalSessionId: "parent-session",
  runtimeKind: "opencode",
  workingDirectory: "/repo",
});
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
    items: [],
    isActive: false,
    activeStreamingAssistantMessageId: null,
  },
  transcriptTarget: createSessionIdentity(),
  runtimePresentation: {
    runtimeKind: "opencode",
    presentToolCall: presentRegularToolCall,
    supportedApprovalReplyOutcomes: null,
    supportsRunningCommandOutput: false,
  },
  subagentPendingApprovalCountBySessionKey: {},
  subagentPendingQuestionCountBySessionKey: {},
  ...overrides,
});

const baseTurnRowProps = (
  overrides: Partial<AgentChatTurnRowProps> = {},
): AgentChatTurnRowProps => ({
  row: { kind: "message", key: "parent-session:assistant-1", message: createMessage() },
  isStreamingAssistantMessage: false,
  sessionIdentity: createSessionIdentity(),
  runtimePresentation: {
    runtimeKind: "opencode",
    presentToolCall: presentRegularToolCall,
    supportedApprovalReplyOutcomes: null,
    supportsRunningCommandOutput: false,
  },
  subagentPendingApprovalCount: 0,
  subagentPendingQuestionCount: 0,
  ...overrides,
});

describe("areAgentChatTurnGroupPropsEqual", () => {
  test("marks only the live assistant row as streaming when duplicate ids share a turn", () => {
    const finalizedRow = {
      kind: "message" as const,
      key: "session:0:assistant-1",
      message: buildMessage("assistant", "Finalized", {
        id: "assistant-1",
        meta: { kind: "assistant", isFinal: true },
      }),
    };
    const liveRow = {
      kind: "message" as const,
      key: "session:1:assistant-1",
      message: buildMessage("assistant", "Live", {
        id: "assistant-1",
        meta: { kind: "assistant", isFinal: false },
      }),
    };

    expect(isAgentChatTurnRowStreamingAssistant(finalizedRow, "assistant-1")).toBe(false);
    expect(isAgentChatTurnRowStreamingAssistant(liveRow, "assistant-1")).toBe(true);
  });

  test("skips rerender for unchanged row identities and equivalent rows", () => {
    const previousProps = baseProps();
    const runtimePresentation = previousProps.runtimePresentation;

    expect(areAgentChatTurnGroupPropsEqual(previousProps, { ...previousProps })).toBe(true);
    expect(
      areAgentChatTurnGroupPropsEqual(
        baseProps({
          runtimePresentation,
          turn: {
            key: "turn-duration",
            rows: [{ kind: "turn_duration", key: "duration-1", durationMs: 1_000 }],
            items: [],
            isActive: false,
            activeStreamingAssistantMessageId: null,
          },
        }),
        baseProps({
          runtimePresentation,
          turn: {
            key: "turn-duration",
            rows: [{ kind: "turn_duration", key: "duration-1", durationMs: 1_000 }],
            items: [],
            isActive: false,
            activeStreamingAssistantMessageId: null,
          },
        }),
      ),
    ).toBe(true);
  });

  test("runtime presentation changes invalidate turn groups", () => {
    const props = baseProps();

    expect(
      areAgentChatTurnGroupPropsEqual(
        props,
        baseProps({
          ...props,
          runtimePresentation: {
            ...props.runtimePresentation,
            presentToolCall: (toolName) => ({
              kind: "workflow",
              displayName: toolName,
              odtTool: null,
            }),
          },
        }),
      ),
    ).toBe(false);
  });

  test("scope changes invalidate turn groups", () => {
    const previousProps = baseProps({
      transcriptTarget: {
        ...createSessionIdentity(),
        sessionScope: {
          kind: "workflow",
          workspaceId: "workspace-1",
          taskId: "task-1",
          role: "spec",
        },
      },
    });

    expect(
      areAgentChatTurnGroupPropsEqual(previousProps, {
        ...previousProps,
        transcriptTarget: {
          ...createSessionIdentity(),
          sessionScope: {
            kind: "workflow",
            workspaceId: "workspace-1",
            taskId: "task-1",
            role: "planner",
          },
        },
      }),
    ).toBe(false);
  });

  test("recreated equivalent workflow scopes keep turn groups stable", () => {
    const previousProps = baseProps({
      transcriptTarget: {
        ...createSessionIdentity(),
        sessionScope: {
          kind: "workflow",
          workspaceId: "workspace-1",
          taskId: "task-1",
          role: "spec",
        },
      },
    });

    expect(
      areAgentChatTurnGroupPropsEqual(previousProps, {
        ...previousProps,
        transcriptTarget: {
          ...createSessionIdentity(),
          sessionScope: {
            kind: "workflow",
            workspaceId: "workspace-1",
            taskId: "task-1",
            role: "spec",
          },
        },
      }),
    ).toBe(true);
  });

  test("changed message row identity invalidates turn groups", () => {
    const message = createMessage();
    const props = baseProps({
      turn: {
        key: "turn-message",
        rows: [{ kind: "message", key: "message-row", message }],
        items: [],
        isActive: false,
        activeStreamingAssistantMessageId: null,
      },
    });

    expect(
      areAgentChatTurnGroupPropsEqual(
        props,
        baseProps({
          ...props,
          turn: {
            ...props.turn,
            rows: [{ kind: "message", key: "changed-message-row", message }],
          },
        }),
      ),
    ).toBe(false);
    expect(
      areAgentChatTurnGroupPropsEqual(
        props,
        baseProps({
          ...props,
          turn: {
            ...props.turn,
            rows: [{ kind: "turn_duration", key: "message-row", durationMs: 1_000 }],
          },
        }),
      ),
    ).toBe(false);
    expect(
      areAgentChatTurnGroupPropsEqual(
        props,
        baseProps({
          ...props,
          turn: {
            ...props.turn,
            rows: [{ kind: "message", key: "message-row", message: createMessage() }],
          },
        }),
      ),
    ).toBe(false);
  });

  test("a changed call of a tool run invalidates the turn of the run", () => {
    const classify = readToolRunClassifier(presentRegularToolCall);
    const shellRow = (id: string, status: "running" | "completed"): AgentChatTranscriptRow => ({
      kind: "message",
      key: `parent-session:${id}`,
      message: buildMessage("tool", `Tool ${id}`, {
        id,
        meta: {
          kind: "tool",
          partId: `${id}-part`,
          callId: `${id}-call`,
          tool: "bash",
          toolType: "bash",
          status,
          input: { command: "bun test" },
        },
      }),
    });
    const shown = shellRow("bash-1", "completed");
    const running = shellRow("bash-2", "running");
    // The run is one row of the row window: its first call.
    const turnOf = (rows: AgentChatTranscriptRow[]) => {
      const windowRows = buildToolRunWindowRows(rows, groupToolRuns(rows, classify));
      return {
        ...baseProps().turn,
        rows: windowRows.rows,
        items: buildTurnItems(windowRows.rows, windowRows, NO_FOLDS, false),
      };
    };
    const props = baseProps({ turn: turnOf([shown, running]) });

    expect(
      areAgentChatTurnGroupPropsEqual(
        props,
        baseProps({ ...props, turn: turnOf([shown, running]) }),
      ),
    ).toBe(true);
    expect(
      areAgentChatTurnGroupPropsEqual(
        props,
        baseProps({ ...props, turn: turnOf([shown, shellRow("bash-2", "completed")]) }),
      ),
    ).toBe(false);
  });

  test("changed turn duration values invalidate turn groups", () => {
    const props = baseProps({
      turn: {
        key: "turn-duration",
        rows: [{ kind: "turn_duration", key: "duration-1", durationMs: 1_000 }],
        items: [],
        isActive: false,
        activeStreamingAssistantMessageId: null,
      },
    });

    expect(
      areAgentChatTurnGroupPropsEqual(
        props,
        baseProps({
          ...props,
          turn: {
            ...props.turn,
            rows: [{ kind: "turn_duration", key: "duration-1", durationMs: 2_000 }],
          },
        }),
      ),
    ).toBe(false);
  });

  test("compaction rows stay stable until their status, label, or context changes", () => {
    const props = baseProps({
      turn: {
        key: "turn-compaction",
        rows: [
          {
            kind: "compaction",
            key: "compaction-1",
            status: "completed",
            label: "Compacted",
            context: "Summary",
          },
        ],
        items: [],
        isActive: false,
        activeStreamingAssistantMessageId: null,
      },
    });

    expect(
      areAgentChatTurnGroupPropsEqual(
        props,
        baseProps({
          // Keep the same runtimePresentation object so only the row changes.
          ...props,
          turn: {
            ...props.turn,
            rows: [
              {
                kind: "compaction",
                key: "compaction-1",
                status: "completed",
                label: "Compacted",
                context: "Summary",
              },
            ],
          },
        }),
      ),
    ).toBe(true);
    expect(
      areAgentChatTurnGroupPropsEqual(
        props,
        baseProps({
          ...props,
          turn: {
            ...props.turn,
            rows: [
              {
                kind: "compaction",
                key: "compaction-1",
                status: "running",
                label: "Compacted",
                context: "Summary",
              },
            ],
          },
        }),
      ),
    ).toBe(false);
    expect(
      areAgentChatTurnGroupPropsEqual(
        props,
        baseProps({
          ...props,
          turn: {
            ...props.turn,
            rows: [
              {
                kind: "compaction",
                key: "compaction-1",
                status: "completed",
                label: "Session compacted.",
                context: "Summary",
              },
            ],
          },
        }),
      ),
    ).toBe(false);
    expect(
      areAgentChatTurnGroupPropsEqual(
        props,
        baseProps({
          ...props,
          turn: {
            ...props.turn,
            rows: [
              {
                kind: "compaction",
                key: "compaction-1",
                status: "completed",
                label: "Compacted",
                context: "Other",
              },
            ],
          },
        }),
      ),
    ).toBe(false);
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

  test("changed non-null active streaming assistant id invalidates turn groups", () => {
    const props = baseProps({
      turn: {
        ...baseProps().turn,
        activeStreamingAssistantMessageId: "assistant-1",
      },
    });

    expect(
      areAgentChatTurnGroupPropsEqual(
        props,
        baseProps({
          ...props,
          turn: { ...props.turn, activeStreamingAssistantMessageId: "assistant-2" },
        }),
      ),
    ).toBe(false);
  });

  test("recreated pending count maps with unchanged row counts compare equal", () => {
    const props = baseProps({
      turn: {
        key: "turn-subagent",
        rows: [
          { kind: "message", key: "parent-session:subagent-1", message: createSubagentMessage() },
        ],
        items: [],
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
        items: [],
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

  test("rebuilt equal identities do not invalidate turn groups", () => {
    const props = baseProps({});

    expect(
      areAgentChatTurnGroupPropsEqual(
        props,
        baseProps({
          ...props,
          transcriptTarget: createSessionIdentity(),
        }),
      ),
    ).toBe(true);
  });

  test("changed model catalogs invalidate turn groups", () => {
    const props = baseProps();

    expect(
      areAgentChatTurnGroupPropsEqual(
        props,
        baseProps({
          ...props,
          modelCatalog: {
            models: [],
            defaultModelsByProvider: {},
          },
        }),
      ),
    ).toBe(false);
  });

  test("turn row comparator accepts rebuilt equal identities", () => {
    const props = baseTurnRowProps();

    expect(
      areAgentChatTurnRowPropsEqual(
        props,
        baseTurnRowProps({
          ...props,
          sessionIdentity: createSessionIdentity(),
        }),
      ),
    ).toBe(true);
  });
});
