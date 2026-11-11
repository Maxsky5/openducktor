import type { ChatSettings } from "@openducktor/contracts";
import type { ToolPartSession } from "@openducktor/frontend-core/queries/agent-session-tool-part";
import type { SessionMessageOwner } from "@openducktor/frontend-core/sessions/agent-orchestrator/support/messages";
import type { AgentChatRuntimePresentation } from "@openducktor/frontend-core/sessions/send/agent-chat.types";
import {
  createContext,
  type MouseEvent,
  type RefObject,
  useContext,
  useSyncExternalStore,
} from "react";

/** The transcript that shows a tool call, with what the details need to show the call. */
export type ToolCallSource = {
  /** The session of the transcript. */
  key: string;
  workingDirectory: string | null;
  runtimePresentation: AgentChatRuntimePresentation;
  /** Reads the full call when the history cut its details. */
  toolPartSession: ToolPartSession | null;
  /** The chat settings of the transcript, such as the diff style of file edits. */
  chatSettings: ChatSettings | null;
};

export type ToolDetailsState = {
  /** The message of the tool call that the details show. */
  messageId: string | null;
  source: ToolCallSource | null;
  /** The live messages of the source transcript. Its thread keeps them current. */
  session: SessionMessageOwner | null;
  /** The row that showed the call. Focus goes back to it when the details close. */
  trigger: HTMLElement | null;
  /** Counts the presses that showed a call, so the page shows its panel again for each. */
  revision: number;
};

/**
 * The tool call that the details show. A page with session panels has one for all its transcripts
 * and shows the call in its right panel. A transcript without one shows the call beside itself.
 */
export type ToolDetailsStore = {
  read: () => ToolDetailsState;
  subscribe: (listener: () => void) => () => void;
  /** Shows the call. A second press on the row of the shown call closes the details. */
  toggle: (
    messageId: string,
    source: ToolCallSource,
    session: SessionMessageOwner | null,
    trigger: HTMLElement,
  ) => void;
  /**
   * Gives the details the new messages and the new source facts, such as the chat settings, of the
   * transcript of the shown call.
   */
  syncTranscript: (source: ToolCallSource, session: SessionMessageOwner | null) => void;
  close: () => void;
};

const closedState = (revision: number): ToolDetailsState => ({
  messageId: null,
  source: null,
  session: null,
  trigger: null,
  revision,
});

export const createToolDetailsStore = (): ToolDetailsStore => {
  let state = closedState(0);
  const listeners = new Set<() => void>();
  const set = (next: ToolDetailsState): void => {
    state = next;
    for (const listener of listeners) listener();
  };
  return {
    read: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    toggle: (messageId, source, session, trigger) => {
      if (state.messageId === messageId && state.source?.key === source.key) {
        set(closedState(state.revision));
        return;
      }
      set({ messageId, source, session, trigger, revision: state.revision + 1 });
    },
    syncTranscript: (source, session) => {
      if (state.source?.key !== source.key) return;
      if (state.source === source && state.session === session) return;
      set({ ...state, source, session });
    },
    close: () => {
      if (state.messageId !== null) set(closedState(state.revision));
    },
  };
};

/** The tool details of the page or of the transcript. Null where calls have no details, as in the tour. */
export const ToolDetailsStoreContext = createContext<ToolDetailsStore | null>(null);

/**
 * The transcript of the rows. The ref holds its latest messages, so a press gives them to the
 * details without a render of each row on each streamed change.
 */
export type ToolCallSourceContextValue = {
  source: ToolCallSource;
  sessionRef: RefObject<SessionMessageOwner | null>;
};

export const ToolCallSourceContext = createContext<ToolCallSourceContextValue | null>(null);

const subscribeToNothing = (): (() => void) => () => {};

/** What a tool call row needs to show its details. */
export type ToolDetailsRow = {
  isShown: boolean;
  onClick: (event: MouseEvent<HTMLElement>) => void;
};

/**
 * The tool details of the row of `messageId`, or null where calls have no details. Only the rows
 * whose shown state changes render again.
 */
export const useToolDetailsRow = (messageId: string): ToolDetailsRow | null => {
  const store = useContext(ToolDetailsStoreContext);
  const transcript = useContext(ToolCallSourceContext);
  const sourceKey = transcript?.source.key;
  const isShownNow = (): boolean => {
    const state = store?.read();
    return state?.messageId === messageId && state.source?.key === sourceKey;
  };
  const isShown = useSyncExternalStore(
    store?.subscribe ?? subscribeToNothing,
    isShownNow,
    isShownNow,
  );
  if (!store || !transcript) return null;
  return {
    isShown,
    onClick: (event) =>
      store.toggle(
        messageId,
        transcript.source,
        transcript.sessionRef.current,
        event.currentTarget,
      ),
  };
};

/** The state of the details, which renders again on each change. */
export const useToolDetailsState = (store: ToolDetailsStore): ToolDetailsState =>
  useSyncExternalStore(store.subscribe, store.read, store.read);
