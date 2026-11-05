import { timingSafeEqual } from "node:crypto";

/** The subprotocols that a WebSocket upgrade offers, in order. */
export const offeredSubprotocols = (request: Request): string[] =>
  (request.headers.get("sec-websocket-protocol") ?? "")
    .split(",")
    .map((protocol) => protocol.trim())
    .filter((protocol) => protocol.length > 0);

/** Compares a received token with the expected one in constant time. */
export const tokensMatch = (received: string | undefined, expected: string): boolean =>
  received !== undefined &&
  received.length === expected.length &&
  timingSafeEqual(Buffer.from(received), Buffer.from(expected));
