import { Effect } from "effect";
import {
  CdpCommandError,
  type CdpEvent,
  type CdpPayload,
  type CdpSession,
} from "../ports/browser-engine-port";

/**
 * A CDP session of one page for host service tests. It answers the commands that the host tab
 * session sends when it starts, answers other commands with an empty result, and lets a test hold
 * the reply of a method and send page events.
 */
export const createBrowserPageSessionTestDouble = (url = "about:blank") => {
  const listeners = new Set<(event: CdpEvent) => void>();
  const sent: Array<{ method: string; params: CdpPayload | undefined }> = [];
  const held = new Map<string, Array<() => void>>();
  const holding = new Set<string>();

  const answer = (method: string): CdpPayload => {
    switch (method) {
      case "Page.getFrameTree":
        return { frameTree: { frame: { id: "T1", url } } };
      case "Page.getNavigationHistory":
        return { currentIndex: 0, entries: [{ id: 1, url, title: "" }] };
      default:
        return {};
    }
  };

  const request = (method: string, params?: CdpPayload): Promise<CdpPayload> => {
    sent.push({ method, params });
    if (!holding.has(method)) {
      return Promise.resolve(answer(method));
    }
    return new Promise<CdpPayload>((resolve) => {
      held.set(method, [...(held.get(method) ?? []), () => resolve(answer(method))]);
    });
  };

  const session: CdpSession = {
    sessionId: "S1",
    targetId: "T1",
    request,
    send: (method, params) =>
      Effect.tryPromise({
        try: () => request(method, params),
        catch: (cause) => new CdpCommandError({ message: String(cause), cause }),
      }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onDetached: () => () => {},
    ownsSession: (sessionId) => sessionId === "S1",
  };

  return {
    session,
    sent,
    /** Holds the replies of the method until `release`. */
    hold: (method: string): void => {
      holding.add(method);
    },
    release: (method: string): void => {
      holding.delete(method);
      for (const answerRequest of held.get(method) ?? []) answerRequest();
      held.delete(method);
    },
    emit: (method: string, params: CdpPayload): void => {
      for (const listener of Array.from(listeners)) listener({ method, params, sessionId: "S1" });
    },
  };
};
