import type { TerminalLifecycle } from "@openducktor/contracts";
import type { TerminalFrameScheduler } from "@openducktor/frontend-core/terminals/terminal-viewport-policy";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  createTerminalSession,
  type TerminalSession,
  type TerminalSessionState,
  type TerminalSessionTransport,
} from "./terminal-session";

const DISPLAY_FRAMES: TerminalFrameScheduler = {
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (frameId) => cancelAnimationFrame(frameId),
};

export type TerminalSessionHandlers = {
  onLifecycle: (lifecycle: TerminalLifecycle) => void;
  onTitle: (title: string) => void;
  onForgotten: (message: string) => void;
  onCopy: (text: string) => void;
  onLink: (url: string) => void;
  onModifiersConsumed: () => void;
};

export type TerminalViewSession = {
  session: TerminalSession | null;
  /** Changes with each new session, so the view can load a new page for it. */
  generation: number;
  state: TerminalSessionState;
};

const NO_SUBSCRIPTION = () => () => {};
const DETACHED_STATE: TerminalSessionState = {
  hydrated: false,
  lifecycle: null,
  exit: null,
  attention: null,
  forgotten: null,
  inputNotice: null,
  inputEnabled: false,
  hasSelection: false,
};
const readDetached = () => DETACHED_STATE;

/**
 * One terminal session for the terminal view while it shows `terminalId` and `active` is true. The
 * session state is a small external store, so output frames never render React.
 *
 * The transport attaches a terminal only for its first listener, so a second view of the same
 * terminal would get no screen. A view is active only while its screen has focus. A blurred view
 * detaches, and its next session attaches again and gets the full screen.
 */
export const useTerminalSession = ({
  controller,
  terminalId,
  active,
  commandsOpen,
  handlers,
}: {
  controller: TerminalSessionTransport | null;
  terminalId: string;
  active: boolean;
  commandsOpen: boolean;
  handlers: TerminalSessionHandlers;
}): TerminalViewSession => {
  const latest = useRef({ handlers, commandsOpen });
  useEffect(() => {
    latest.current = { handlers, commandsOpen };
  });
  const [current, setCurrent] = useState<{ session: TerminalSession; generation: number } | null>(
    null,
  );
  // Each session gets a new generation, also after a blur, so a view never reuses a page key.
  const generations = useRef(0);
  useEffect(() => {
    if (controller === null || !active) return;
    const created = createTerminalSession({
      terminalId,
      transport: controller,
      frames: DISPLAY_FRAMES,
      commandsOpen: latest.current.commandsOpen,
      onLifecycle: (lifecycle) => latest.current.handlers.onLifecycle(lifecycle),
      onTitle: (title) => latest.current.handlers.onTitle(title),
      onForgotten: (message) => latest.current.handlers.onForgotten(message),
      onCopy: (text) => latest.current.handlers.onCopy(text),
      onLink: (url) => latest.current.handlers.onLink(url),
      onModifiersConsumed: () => latest.current.handlers.onModifiersConsumed(),
    });
    generations.current += 1;
    setCurrent({ session: created, generation: generations.current });
    return () => {
      created.dispose();
      setCurrent((previous) => (previous?.session === created ? null : previous));
    };
  }, [active, controller, terminalId]);
  const session = current?.session ?? null;
  useEffect(() => {
    session?.setCommandsOpen(commandsOpen);
  }, [commandsOpen, session]);
  const state = useSyncExternalStore(
    session?.subscribe ?? NO_SUBSCRIPTION,
    session?.read ?? readDetached,
    session?.read ?? readDetached,
  );
  return { session, generation: current?.generation ?? 0, state };
};
