import { createBrowserEndSignal } from "../browser-engine-lifecycle";
import { Buffer } from "node:buffer";
import type { Readable, Writable } from "node:stream";
import { z } from "zod";
import { cdpPayloadSchema } from "../../../ports/browser-cdp-schemas";
import {
  type CdpEvent,
  type CdpPayload,
  CdpProtocolError,
} from "../../../ports/browser-engine-port";
import { errorMessage } from "../../../effect/host-errors";
import type { CdpConnection } from "../cdp/cdp-target-session";

/**
 * Splits a Chrome `--remote-debugging-pipe` byte stream into messages. Chrome ends each JSON
 * message with one NUL byte. A message can span many chunks, and one chunk can hold many messages.
 */
const createNulDelimitedDecoder = (onMessage: (message: string) => void) => {
  let pending: Buffer[] = [];
  return {
    push(chunk: Uint8Array): void {
      const bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      let start = 0;
      let end = bytes.indexOf(0, start);
      while (end !== -1) {
        pending.push(bytes.subarray(start, end));
        const message = Buffer.concat(pending).toString("utf8");
        pending = [];
        onMessage(message);
        start = end + 1;
        end = bytes.indexOf(0, start);
      }
      if (start < bytes.length) {
        pending.push(Buffer.from(bytes.subarray(start)));
      }
    },
  };
};

const cdpResponseSchema = z.object({
  id: z.number().int(),
  result: cdpPayloadSchema.optional(),
  error: z.object({ code: z.number().optional(), message: z.string() }).optional(),
});

const cdpEventMessageSchema = z.object({
  method: z.string(),
  params: cdpPayloadSchema.optional(),
  sessionId: z.string().optional(),
});

const cdpIncomingSchema = z.union([cdpResponseSchema, cdpEventMessageSchema]);

type PendingRequest = {
  method: string;
  resolve(result: CdpPayload): void;
  reject(error: Error): void;
};

export type ChromePipeConnection = CdpConnection & {
  /** Rejects pending requests and ends the connection. */
  close(reason: string): void;
};

/**
 * A CDP connection over the two pipes of `--remote-debugging-pipe`: Chrome reads commands from
 * its fd 3 (`input`) and writes responses and events to its fd 4 (`output`). An empty
 * `sessionId` addresses the root session.
 */
export const createChromePipeConnection = (pipes: {
  input: Writable;
  output: Readable;
}): ChromePipeConnection => {
  const pending = new Map<number, PendingRequest>();
  const listeners = new Set<(event: CdpEvent) => void>();
  const closed = createBrowserEndSignal<string>();
  let nextId = 1;

  const close = (reason: string): void => {
    if (closed.isEnded()) {
      return;
    }
    for (const request of pending.values()) {
      request.reject(
        new CdpProtocolError(request.method, `CDP connection closed: ${reason}`, null),
      );
    }
    pending.clear();
    pipes.input.end();
    closed.end(reason);
    listeners.clear();
  };

  const receive = (text: string): void => {
    const message = cdpIncomingSchema.parse(JSON.parse(text));
    if ("id" in message) {
      const request = pending.get(message.id);
      if (!request) {
        return;
      }
      pending.delete(message.id);
      if (message.error) {
        request.reject(
          new CdpProtocolError(request.method, message.error.message, message.error.code ?? null),
        );
        return;
      }
      request.resolve(message.result ?? {});
      return;
    }
    const event: CdpEvent = {
      method: message.method,
      params: message.params ?? {},
      sessionId: message.sessionId ?? "",
    };
    // One pipe chunk can hold a reply and then events. A reply reaches its caller in a promise
    // job, so events wait for the same queue and keep the order that the browser sent.
    queueMicrotask(() => {
      if (closed.isEnded()) return;
      try {
        for (const listener of Array.from(listeners)) {
          listener(event);
        }
      } catch (cause) {
        close(`An event listener failed: ${errorMessage(cause)}`);
      }
    });
  };

  const decoder = createNulDelimitedDecoder((message) => {
    try {
      receive(message);
    } catch (cause) {
      close(`Chrome sent a DevTools message that OpenDucktor cannot read: ${errorMessage(cause)}`);
    }
  });
  pipes.output.on("data", (chunk: Buffer) => decoder.push(chunk));
  pipes.output.on("close", () => close("Chrome closed the DevTools pipe."));
  pipes.output.on("error", (error) =>
    close(`The DevTools pipe from Chrome failed: ${error.message}`),
  );
  pipes.input.on("error", (error) => close(`The DevTools pipe to Chrome failed: ${error.message}`));

  return {
    request(method, params, sessionId) {
      const closedReason = closed.reason();
      if (closedReason !== null) {
        return Promise.reject(
          new CdpProtocolError(method, `CDP connection closed: ${closedReason}`, null),
        );
      }
      const id = nextId++;
      const message =
        sessionId.length > 0
          ? { id, method, params: params ?? {}, sessionId }
          : { id, method, params: params ?? {} };
      return new Promise((resolve, reject) => {
        pending.set(id, { method, resolve, reject });
        // JSON text never holds a raw NUL byte. When the pipe breaks, the close rejects the request.
        pipes.input.write(`${JSON.stringify(message)}\0`);
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onClose: closed.onEnded,
    isClosed: closed.isEnded,
    close,
  };
};
