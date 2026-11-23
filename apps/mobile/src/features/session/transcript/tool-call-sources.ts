import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import type { AgentChatTranscriptRow } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
import { createContext, use, useCallback, useLayoutEffect, useSyncExternalStore } from "react";
import type { TranscriptRowsContextValue } from "./transcript-rows-context";

/**
 * The live transcript of an open session: the session facts that its rows read, and its rows,
 * which hold the live message of each call.
 */
export type ToolCallSource = {
  context: TranscriptRowsContextValue;
  rows: readonly AgentChatTranscriptRow[];
};

/** A tool call and its message, as the tool call screen shows it. */
export type ShownToolCall = { message: AgentChatMessage; meta: ToolMeta };

/**
 * The live transcripts of the open session screens, by session key. The tool call screen sits
 * above the session screen in the stack, so it reads the transcript that the session screen keeps
 * live under it, and does not load the session again.
 */
export type ToolCallSources = {
  get: (sessionKey: string) => ToolCallSource | undefined;
  publish: (sessionKey: string, source: ToolCallSource) => void;
  /** Removes the source of a session screen that unmounts, unless another screen replaced it. */
  remove: (sessionKey: string, source: ToolCallSource) => void;
  subscribe: (sessionKey: string, listener: () => void) => () => void;
};

export const createToolCallSources = (): ToolCallSources => {
  const sources = new Map<string, ToolCallSource>();
  const listeners = new Map<string, Set<() => void>>();
  const notify = (sessionKey: string) => {
    for (const listener of listeners.get(sessionKey) ?? []) listener();
  };
  return {
    get: (sessionKey) => sources.get(sessionKey),
    publish: (sessionKey, source) => {
      sources.set(sessionKey, source);
      notify(sessionKey);
    },
    remove: (sessionKey, source) => {
      if (sources.get(sessionKey) !== source) return;
      sources.delete(sessionKey);
      notify(sessionKey);
    },
    subscribe: (sessionKey, listener) => {
      const sessionListeners = listeners.get(sessionKey) ?? new Set();
      sessionListeners.add(listener);
      listeners.set(sessionKey, sessionListeners);
      return () => {
        sessionListeners.delete(listener);
        if (sessionListeners.size === 0) listeners.delete(sessionKey);
      };
    },
  };
};

const ToolCallSourcesContext = createContext<ToolCallSources | null>(null);

export const ToolCallSourcesProvider = ToolCallSourcesContext;

const useToolCallSources = (): ToolCallSources => {
  const sources = use(ToolCallSourcesContext);
  if (!sources) throw new Error("Tool call sources need the app stack.");
  return sources;
};

/** Publishes the live transcript of a session screen while the screen shows it. */
export const usePublishToolCallSource = (sessionKey: string, source: ToolCallSource): void => {
  const sources = useToolCallSources();
  useLayoutEffect(() => {
    sources.publish(sessionKey, source);
    return () => sources.remove(sessionKey, source);
  }, [sessionKey, source, sources]);
};

/** The live call that matches in the rows of a transcript, or null when they lack it. */
const findToolCallMatching = (
  rows: readonly AgentChatTranscriptRow[],
  matches: (call: ShownToolCall) => boolean,
): ShownToolCall | null => {
  // Recent calls are near the end, so the search starts there.
  const row = rows.findLast(
    (item) =>
      item.kind === "message" &&
      item.message.meta?.kind === "tool" &&
      matches({ message: item.message, meta: item.message.meta }),
  );
  if (row?.kind !== "message" || row.message.meta?.kind !== "tool") return null;
  return { message: row.message, meta: row.message.meta };
};

/** The live call with this message ID in the rows of a transcript, or null when they lack it. */
export const findToolCall = (
  rows: readonly AgentChatTranscriptRow[],
  messageId: string,
): ShownToolCall | null => findToolCallMatching(rows, ({ message }) => message.id === messageId);

/** The live call with these part and call IDs in the rows of a transcript, or null. */
export const findHtmlPreviewCall = (
  rows: readonly AgentChatTranscriptRow[],
  partId: string,
  callId: string,
): ShownToolCall | null =>
  findToolCallMatching(rows, ({ meta }) => meta.partId === partId && meta.callId === callId);

/** The session facts of a transcript, and the live message of one of its calls. */
export type LiveToolCall = {
  context: TranscriptRowsContextValue | null;
  message: AgentChatMessage | null;
};

/**
 * The session facts of a transcript and the live message of one of its calls. Streamed text
 * changes the rows often, so each value changes only when it changes.
 */
const useLiveToolCall = (
  sessionKey: string,
  findCall: (rows: readonly AgentChatTranscriptRow[]) => ShownToolCall | null,
): LiveToolCall => {
  const sources = useToolCallSources();
  const subscribe = useCallback(
    (listener: () => void) => sources.subscribe(sessionKey, listener),
    [sessionKey, sources],
  );
  const context = useSyncExternalStore(subscribe, () => sources.get(sessionKey)?.context ?? null);
  const message = useSyncExternalStore(subscribe, () => {
    const source = sources.get(sessionKey);
    return source ? (findCall(source.rows)?.message ?? null) : null;
  });
  return { context, message };
};

/** The live message of one call, for the tool call screen. */
export const useToolCallSource = (sessionKey: string, messageId: string): LiveToolCall =>
  useLiveToolCall(sessionKey, (rows) => findToolCall(rows, messageId));

/** The live message of a published HTML preview, addressed by its tool part. */
export const useHtmlPreviewSource = (
  sessionKey: string,
  partId: string,
  callId: string,
): LiveToolCall => useLiveToolCall(sessionKey, (rows) => findHtmlPreviewCall(rows, partId, callId));
