import { REMOTE_STREAM_HEARTBEAT_INTERVAL_MS } from "@openducktor/contracts";

const HEARTBEAT_COMMENT = new TextEncoder().encode(": heartbeat\n\n");

/**
 * Writes an SSE comment on an event stream at the heartbeat interval until the returned stop
 * runs. A network path can drop an idle stream without closing it; the comment keeps the path busy
 * and lets the client see a silent stream. A closed stream or a full queue skips the beat.
 */
export const startStreamHeartbeat = (
  controller: ReadableStreamDefaultController<Uint8Array>,
): (() => void) => {
  const timer = setInterval(() => {
    if ((controller.desiredSize ?? 0) > 0) controller.enqueue(HEARTBEAT_COMMENT);
  }, REMOTE_STREAM_HEARTBEAT_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
};
