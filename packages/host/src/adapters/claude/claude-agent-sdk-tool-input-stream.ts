import { HostValidationError } from "../../effect/host-errors";
import type { ClaudeDecodedToolUse } from "./claude-agent-sdk-tool-shapes";
import type { ClaudeEventSession } from "./claude-agent-sdk-event-session";
import {
  claudeProtocolObjectSchema,
  type ClaudeProtocolObject,
} from "./claude-agent-sdk-ingress-schemas";
import type { ClaudeToolInput } from "./claude-agent-sdk-types";

type ToolStreamEntry = {
  blockIndex: number;
  partialInputJson: string;
  toolUse: ClaudeDecodedToolUse;
  lastEmittedInputFingerprint?: string;
};

type ToolStreamState = {
  toolsByBlockIndex: Map<number, ToolStreamEntry>;
  toolsByCallId: Map<string, ToolStreamEntry>;
};

type ClaudeToolInputStreamSession = Pick<ClaudeEventSession, "externalSessionId">;

const toolStreamStates = new WeakMap<ClaudeToolInputStreamSession, ToolStreamState>();

const toolStreamStateFor = (session: ClaudeToolInputStreamSession): ToolStreamState => {
  const existing = toolStreamStates.get(session);
  if (existing) {
    return existing;
  }
  const state: ToolStreamState = {
    toolsByBlockIndex: new Map(),
    toolsByCallId: new Map(),
  };
  toolStreamStates.set(session, state);
  return state;
};

const toolInputFingerprint = (input: ClaudeProtocolObject): string => JSON.stringify(input);

export const rememberClaudeStreamToolStart = (
  session: ClaudeToolInputStreamSession,
  blockIndex: number,
  toolUse: ClaudeDecodedToolUse,
): void => {
  const entry: ToolStreamEntry = {
    blockIndex,
    partialInputJson: "",
    toolUse,
  };
  if (toolUse.input) {
    entry.lastEmittedInputFingerprint = toolInputFingerprint(toolUse.input);
  }
  const state = toolStreamStateFor(session);
  const previous = state.toolsByBlockIndex.get(blockIndex);
  if (previous) {
    state.toolsByCallId.delete(previous.toolUse.callId);
  }
  state.toolsByBlockIndex.set(blockIndex, entry);
  state.toolsByCallId.set(toolUse.callId, entry);
};

export const appendClaudeStreamToolInputJson = (
  session: ClaudeToolInputStreamSession,
  blockIndex: number,
  partialJson: string,
): void => {
  const entry = toolStreamStates.get(session)?.toolsByBlockIndex.get(blockIndex);
  if (entry) {
    entry.partialInputJson += partialJson;
  }
};

export const completeClaudeStreamToolInput = (
  session: ClaudeToolInputStreamSession,
  blockIndex: number,
): ClaudeDecodedToolUse | null => {
  const state = toolStreamStates.get(session);
  const entry = state?.toolsByBlockIndex.get(blockIndex);
  if (!state || !entry) {
    return null;
  }
  state.toolsByBlockIndex.delete(blockIndex);
  const json = entry.partialInputJson;
  entry.partialInputJson = "";
  if (json.length === 0) {
    return null;
  }

  // The SDK delivers complete tool input at content_block_stop.
  let parsedInput: ClaudeProtocolObject;
  try {
    parsedInput = claudeProtocolObjectSchema.parse(JSON.parse(json));
  } catch (cause) {
    state.toolsByCallId.delete(entry.toolUse.callId);
    throw new HostValidationError({
      field: "claudeStreamToolInput",
      message: `Claude SDK sent invalid completed tool input for "${entry.toolUse.callId}" (${entry.toolUse.toolName}, block ${blockIndex}). Retry the turn.`,
      cause,
      details: { callId: entry.toolUse.callId, blockIndex, toolName: entry.toolUse.toolName },
    });
  }

  const nextFingerprint = toolInputFingerprint(parsedInput);
  if (entry.lastEmittedInputFingerprint === nextFingerprint) {
    return null;
  }

  entry.lastEmittedInputFingerprint = nextFingerprint;
  entry.toolUse = {
    ...entry.toolUse,
    input: parsedInput,
  };
  return entry.toolUse;
};

export const consumeClaudeStreamEmittedToolInput = (
  session: ClaudeToolInputStreamSession,
  callId: string,
  input: ClaudeToolInput,
): boolean => {
  const state = toolStreamStates.get(session);
  const entry = state?.toolsByCallId.get(callId);
  if (!state || !entry) {
    return false;
  }
  state.toolsByCallId.delete(callId);
  if (state.toolsByBlockIndex.get(entry.blockIndex) === entry) {
    state.toolsByBlockIndex.delete(entry.blockIndex);
  }
  return entry.lastEmittedInputFingerprint === toolInputFingerprint(input);
};

export const discardClaudeStreamToolInputBlocks = (session: ClaudeToolInputStreamSession): void => {
  const state = toolStreamStates.get(session);
  if (!state) {
    return;
  }
  for (const entry of state.toolsByBlockIndex.values()) {
    state.toolsByCallId.delete(entry.toolUse.callId);
  }
  state.toolsByBlockIndex.clear();
};

type ClaudeToolInputStreamTree = ClaudeToolInputStreamSession & {
  subagentEventSessionsByToolUseId?: ReadonlyMap<string, ClaudeToolInputStreamTree>;
};

export const clearClaudeStreamToolInputs = (session: ClaudeToolInputStreamSession): void => {
  toolStreamStates.delete(session);
};

export const clearClaudeStreamToolInputTree = (session: ClaudeToolInputStreamTree): void => {
  clearClaudeStreamToolInputs(session);
  for (const child of session.subagentEventSessionsByToolUseId?.values() ?? []) {
    clearClaudeStreamToolInputTree(child);
  }
};
