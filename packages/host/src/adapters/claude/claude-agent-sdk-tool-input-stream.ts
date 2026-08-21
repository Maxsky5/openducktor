import type { ClaudeDecodedToolUse } from "./claude-agent-sdk-tool-shapes";
import { isRecord } from "./claude-agent-sdk-utils";
import type { JsonValue } from "@openducktor/contracts";

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

const toolStreamStates = new WeakMap<object, ToolStreamState>();

const toolStreamStateFor = (session: object): ToolStreamState => {
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

const tryParseJsonRecord = (json: string): Record<string, JsonValue> | null => {
  try {
    // SAFETY: JSON.parse returns JSON-compatible data for the supplied text.
    const parsed = JSON.parse(json) as JsonValue;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const toolInputFingerprint = (input: Record<string, JsonValue>): string => {
  try {
    return JSON.stringify(input);
  } catch {
    return Object.keys(input).sort().join("\u001f");
  }
};

export const rememberClaudeStreamToolStart = (
  session: object,
  blockIndex: number,
  toolUse: ClaudeDecodedToolUse,
): void => {
  const entry: ToolStreamEntry = {
    blockIndex,
    partialInputJson: "",
    toolUse,
    ...(toolUse.input ? { lastEmittedInputFingerprint: toolInputFingerprint(toolUse.input) } : {}),
  };
  const state = toolStreamStateFor(session);
  state.toolsByBlockIndex.set(blockIndex, entry);
  state.toolsByCallId.set(toolUse.callId, entry);
};

export const appendClaudeStreamToolInputJson = (
  session: object,
  blockIndex: number,
  partialJson: string,
): ClaudeDecodedToolUse | null => {
  const entry = toolStreamStateFor(session).toolsByBlockIndex.get(blockIndex);
  if (!entry) {
    return null;
  }

  entry.partialInputJson += partialJson;
  const parsedInput = tryParseJsonRecord(entry.partialInputJson);
  if (!parsedInput) {
    return null;
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
  session: object,
  callId: string,
  input: Record<string, JsonValue>,
): boolean => {
  const state = toolStreamStateFor(session);
  const entry = state.toolsByCallId.get(callId);
  if (!entry) {
    return false;
  }
  state.toolsByCallId.delete(callId);
  state.toolsByBlockIndex.delete(entry.blockIndex);
  return entry.lastEmittedInputFingerprint === toolInputFingerprint(input);
};
