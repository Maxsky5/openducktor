import type { HookCallback, PostToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "@openducktor/core";
import { isClaudeFileEditTool } from "./claude-agent-sdk-file-edits";
import { timestampMs } from "./claude-agent-sdk-tool-shapes";
import { createClaudeCompletedToolPart } from "./claude-agent-sdk-transcript-parts";
import type { ClaudeSession } from "./claude-agent-sdk-types";
import { isRecord, readStringProp } from "./claude-agent-sdk-utils";

type ClaudePostToolUseSession = Pick<
  ClaudeSession,
  "externalSessionId" | "toolInputsByCallId" | "toolMessageIdsByCallId" | "toolStartedAtMsByCallId"
>;

const hookResponseText = (response: Record<string, unknown>): string =>
  readStringProp(response, "message") ?? readStringProp(response, "content") ?? "";

const emitFileEditResult = ({
  emit,
  input,
  now,
  session,
}: {
  emit: (event: AgentEvent) => void;
  input: PostToolUseHookInput;
  now: () => string;
  session: ClaudePostToolUseSession;
}): void => {
  if (input.agent_id || !isClaudeFileEditTool(input.tool_name) || !isRecord(input.tool_response)) {
    return;
  }
  const timestamp = now();
  const toolInput = isRecord(input.tool_input)
    ? input.tool_input
    : session.toolInputsByCallId.get(input.tool_use_id);
  const startedAtMs =
    session.toolStartedAtMsByCallId.get(input.tool_use_id) ??
    (typeof input.duration_ms === "number"
      ? Math.max(0, timestampMs(timestamp) - input.duration_ms)
      : undefined);
  const part = createClaudeCompletedToolPart({
    callId: input.tool_use_id,
    endedAtMs: timestampMs(timestamp),
    isError: false,
    messageId: session.toolMessageIdsByCallId.get(input.tool_use_id) ?? input.tool_use_id,
    raw: input.tool_response,
    text: hookResponseText(input.tool_response),
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
    if (input.hook_event_name === "PostToolUse") {
      emitFileEditResult({ emit, input, now, session });
    }
    return {};
  };
