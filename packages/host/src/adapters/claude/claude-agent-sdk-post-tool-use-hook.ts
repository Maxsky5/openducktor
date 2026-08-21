import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "@openducktor/core";
import {
  type ClaudeEventSession,
  findClaudeSubagentSessionByAgentId,
} from "./claude-agent-sdk-event-session";
import { isClaudeFileEditTool } from "./claude-agent-sdk-file-edits";
import {
  type ClaudePostToolUseIngress,
  parseClaudeFileEditToolResponse,
  parseClaudePostToolUseIngress,
} from "./claude-agent-sdk-ingress-schemas";
import { timestampMs } from "./claude-agent-sdk-tool-shapes";
import { createClaudeCompletedToolPart } from "./claude-agent-sdk-transcript-parts";
import type { ClaudeSession } from "./claude-agent-sdk-types";
import { readStringProp } from "./claude-agent-sdk-utils";
import type { JsonValue } from "@openducktor/contracts";

type ClaudePostToolUseSession = ClaudeEventSession & Pick<ClaudeSession, "toolEndedAtMsByCallId">;

const hookResponseText = (response: Record<string, JsonValue>): string =>
  readStringProp(response, "message") ?? readStringProp(response, "content") ?? "";

const emitFileEditResult = ({
  emit,
  input,
  session,
  timestamp,
}: {
  emit: (event: AgentEvent) => void;
  input: Extract<ClaudePostToolUseIngress, { hook_event_name: "PostToolUse" }>;
  session: ClaudePostToolUseSession;
  timestamp: string;
}): void => {
  if (input.agent_id || !isClaudeFileEditTool(input.tool_name)) {
    return;
  }
  const toolResponse = parseClaudeFileEditToolResponse(input.tool_response);
  const toolInput = input.tool_input;
  const startedAtMs = session.toolStartedAtMsByCallId.get(input.tool_use_id);
  const endedAtMs = session.toolEndedAtMsByCallId.get(input.tool_use_id) ?? timestampMs(timestamp);
  const part = createClaudeCompletedToolPart({
    callId: input.tool_use_id,
    endedAtMs,
    isError: false,
    messageId: session.toolMessageIdsByCallId.get(input.tool_use_id) ?? input.tool_use_id,
    raw: toolResponse,
    text: hookResponseText(toolResponse),
    tool: input.tool_name,
    ...(toolInput ? { input: toolInput } : {}),
    ...(typeof startedAtMs === "number" ? { startedAtMs } : {}),
  });
  if (!part.fileDiffs) {
    return;
  }

  emit({
    type: "assistant_part",
    externalSessionId: session.externalSessionId,
    timestamp,
    part,
  });
};

const recordClaudeToolExecutionTiming = (
  input: ClaudePostToolUseIngress,
  session: ClaudePostToolUseSession,
  timestamp: string,
): void => {
  if (input.duration_ms === undefined) {
    return;
  }
  const timingSession = input.agent_id
    ? findClaudeSubagentSessionByAgentId(session, input.agent_id)
    : session;
  if (!timingSession) {
    return;
  }
  const endedAtMs = timestampMs(timestamp);
  timingSession.toolStartedAtMsByCallId.set(
    input.tool_use_id,
    Math.max(0, endedAtMs - input.duration_ms),
  );
  timingSession.toolEndedAtMsByCallId ??= new Map();
  timingSession.toolEndedAtMsByCallId.set(input.tool_use_id, endedAtMs);
};

export const createClaudePostToolUseHook =
  ({
    emit,
    now,
    session,
  }: {
    emit: (event: AgentEvent) => void;
    now: () => string;
    session: ClaudePostToolUseSession;
  }): HookCallback =>
  async (input) => {
    const postToolUseInput = parseClaudePostToolUseIngress(input);
    const timestamp = now();
    recordClaudeToolExecutionTiming(postToolUseInput, session, timestamp);
    if (postToolUseInput.hook_event_name === "PostToolUse") {
      emitFileEditResult({ emit, input: postToolUseInput, session, timestamp });
    }
    return {};
  };
