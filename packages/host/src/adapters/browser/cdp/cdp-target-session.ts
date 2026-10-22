import { createBrowserEndSignal } from "../browser-engine-lifecycle";
import type { Effect } from "effect";
import { z } from "zod";
import {
  type CdpCommandError,
  type CdpEvent,
  type CdpPayload,
  CdpProtocolError,
  type CdpSession,
  sendCdp,
} from "../../../ports/browser-engine-port";
import { targetSessionEventSchema } from "../../../ports/browser-cdp-schemas";

/**
 * One flat CDP connection: a Chrome pipe, or the Electron debugger of one guest page.
 * `sessionId` addresses a flat session. An empty `sessionId` addresses the root session.
 */
export type CdpConnection = {
  request(method: string, params: CdpPayload | undefined, sessionId: string): Promise<CdpPayload>;
  subscribe(listener: (event: CdpEvent) => void): () => void;
  onClose(listener: (reason: string) => void): () => void;
  isClosed(): boolean;
};

/** Sends one command on a connection as an Effect. An empty `sessionId` addresses the root. */
export const cdpCommand = (
  connection: CdpConnection,
  sessionId: string,
  method: string,
  params?: CdpPayload,
): Effect.Effect<CdpPayload, CdpCommandError> =>
  sendCdp(() => connection.request(method, params, sessionId));

const attachResultSchema = z.object({ sessionId: z.string().min(1) });

export type ClosableCdpSession = CdpSession & {
  /** Detaches the session. Later calls do nothing. */
  close(): Promise<void>;
};

/**
 * Attaches one flat session to a target. The session tracks the child sessions that it
 * auto-attaches, such as out-of-process frames and workers, and reports their events too.
 */
export const attachCdpTargetSession = async (
  connection: CdpConnection,
  input: { targetId: string; parentSessionId: string },
): Promise<ClosableCdpSession> => {
  const attached = await connection.request(
    "Target.attachToTarget",
    { targetId: input.targetId, flatten: true },
    input.parentSessionId,
  );
  const { sessionId } = attachResultSchema.parse(attached);

  const children = new Set<string>();
  const listeners = new Set<(event: CdpEvent) => void>();
  const detached = createBrowserEndSignal<string>();

  const markDetached = (reason: string): void => {
    if (detached.isEnded()) {
      return;
    }
    unsubscribe();
    unsubscribeClose();
    detached.end(reason);
    listeners.clear();
  };

  const ownsSession = (candidate: string): boolean =>
    candidate === sessionId || children.has(candidate);

  const unsubscribe = connection.subscribe((event) => {
    const isTargetEvent =
      event.method === "Target.attachedToTarget" || event.method === "Target.detachedFromTarget";
    const eventSessionId = isTargetEvent
      ? targetSessionEventSchema.parse(event.params).sessionId
      : null;
    if (
      event.method === "Target.detachedFromTarget" &&
      event.sessionId === input.parentSessionId &&
      eventSessionId === sessionId
    ) {
      markDetached("target_detached");
      return;
    }
    if (!ownsSession(event.sessionId)) {
      return;
    }
    if (event.method === "Target.attachedToTarget" && eventSessionId !== null) {
      children.add(eventSessionId);
    } else if (event.method === "Target.detachedFromTarget" && eventSessionId !== null) {
      children.delete(eventSessionId);
    }
    for (const listener of Array.from(listeners)) {
      listener(event);
    }
  });
  const unsubscribeClose = connection.onClose((reason) => markDetached(reason));

  const request: CdpSession["request"] = (method, params, childSessionId) => {
    const detachedReason = detached.reason();
    if (detachedReason !== null) {
      return Promise.reject(
        new CdpProtocolError(method, `CDP session ended: ${detachedReason}`, null),
      );
    }
    if (childSessionId !== undefined && !children.has(childSessionId)) {
      return Promise.reject(
        new CdpProtocolError(method, `Session ${childSessionId} is not a child session.`, null),
      );
    }
    return connection.request(method, params, childSessionId ?? sessionId);
  };

  const session: ClosableCdpSession = {
    sessionId,
    targetId: input.targetId,
    request,
    send: (method, params, childSessionId) =>
      sendCdp(() => request(method, params, childSessionId)),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onDetached: detached.onEnded,
    ownsSession,
    async close() {
      if (detached.isEnded()) {
        return;
      }
      markDetached("closed");
      if (connection.isClosed()) {
        return;
      }
      // The target can end first. The detach then has nothing to do.
      await connection
        .request("Target.detachFromTarget", { sessionId }, input.parentSessionId)
        .catch(() => undefined);
    },
  };
  return session;
};
