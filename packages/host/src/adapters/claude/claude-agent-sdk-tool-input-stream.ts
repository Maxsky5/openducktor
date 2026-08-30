import type { ClaudeDecodedToolUse } from "./claude-agent-sdk-tool-shapes";
import type { ClaudeEventSession } from "./claude-agent-sdk-event-session";
import { jsonObjectSchema, type JsonObject } from "@openducktor/contracts";
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

const tryParseJsonRecord = (json: string) => {
  try {
    const parsed = jsonObjectSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const toolInputFingerprint = (input: JsonObject): string => JSON.stringify(input);

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
  state.toolsByBlockIndex.set(blockIndex, entry);
  state.toolsByCallId.set(toolUse.callId, entry);
};

export const appendClaudeStreamToolInputJson = (
  session: ClaudeToolInputStreamSession,
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
  session: ClaudeToolInputStreamSession,
  callId: string,
  input: ClaudeToolInput,
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
