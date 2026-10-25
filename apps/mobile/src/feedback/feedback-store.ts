import type {
  ClientFeedback,
  ClientFeedbackKind,
} from "@openducktor/frontend-core/platform/client-feedback";
import { createStore } from "zustand/vanilla";

export type FeedbackMessage = {
  id: string;
  kind: ClientFeedbackKind;
  message: string;
  description: string | null;
  /** Milliseconds, or `null` to keep the message until a dismissal. */
  duration: number | null;
};

export type FeedbackState = {
  messages: FeedbackMessage[];
  /**
   * The open windows above the root view that can show the toasts, oldest first. On Android, a
   * React Native `Modal` is its own window and covers the root view.
   */
  windows: string[];
  /** The open menus. A menu sits near its anchor, often under the toasts, so toasts wait for it. */
  menus: number;
};

/** Whether an open menu hides the toasts. */
export const toastsCoveredBy = (state: FeedbackState): boolean => state.menus > 0;

/** The window that shows the toasts: the newest open window, or `null` for the root view. */
export const toastWindowOf = (state: FeedbackState): string | null => state.windows.at(-1) ?? null;

const DEFAULT_DURATION_MS = 4_000;
const ERROR_DURATION_MS = 7_000;
const MAX_VISIBLE = 3;

/**
 * Short in-app feedback for the results of the user's own actions. Host notification events never
 * reach it, because the app creates no notification runtime.
 */
export const createFeedbackStore = () => {
  const store = createStore<FeedbackState>(() => ({ messages: [], windows: [], menus: 0 }));
  let nextId = 1;
  // The messages that a window showed. A toast that moves to another window, as when a sheet
  // closes, then shows there at once and does not enter a second time.
  const presented = new Set<string>();
  const keepPresented = (messages: readonly FeedbackMessage[]) => {
    for (const id of presented) {
      if (!messages.some((entry) => entry.id === id)) presented.delete(id);
    }
  };
  const setMessages = (messages: FeedbackMessage[]) => {
    keepPresented(messages);
    store.setState({ messages });
  };
  const dismiss = (id: string) =>
    setMessages(store.getState().messages.filter((entry) => entry.id !== id));
  const feedback: ClientFeedback = {
    show(kind, message, options) {
      const id = options?.id ?? `feedback-${nextId++}`;
      const duration =
        options?.duration === Infinity
          ? null
          : (options?.duration ?? (kind === "error" ? ERROR_DURATION_MS : DEFAULT_DURATION_MS));
      const entry: FeedbackMessage = {
        id,
        kind,
        message,
        description: options?.description ?? null,
        duration,
      };
      const { messages } = store.getState();
      setMessages(
        [...messages.filter((existing) => existing.id !== id), entry].slice(-MAX_VISIBLE),
      );
    },
    dismiss,
  };
  /** Shows the toasts in the window `id` until the returned function runs. */
  const openWindow = (id: string): (() => void) => {
    store.setState(({ windows }) => ({ windows: [...windows, id] }));
    return () =>
      store.setState(({ windows }) => ({ windows: windows.filter((entry) => entry !== id) }));
  };
  /** Hides the toasts while a menu is open, until the returned function runs. */
  const openMenu = (): (() => void) => {
    store.setState(({ menus }) => ({ menus: menus + 1 }));
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      store.setState(({ menus }) => ({ menus: menus - 1 }));
    };
  };
  /** A window showed the toast of message `id`. */
  const markPresented = (id: string) => {
    if (store.getState().messages.some((entry) => entry.id === id)) presented.add(id);
  };
  /** Whether a window showed the toast of message `id` already. */
  const wasPresented = (id: string): boolean => presented.has(id);
  return { store, feedback, dismiss, openWindow, openMenu, markPresented, wasPresented };
};

export type FeedbackStore = ReturnType<typeof createFeedbackStore>;
