import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { type AddressInfo, type Socket } from "node:net";
import { Readable, type Duplex } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { createGzip } from "node:zlib";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { nodeReadableStream } from "./node-readable-stream";

const MIN_GZIP_BYTES = 1024;
/** The server pings each WebSocket peer at this interval. */
const PEER_CHECK_INTERVAL_MS = 15_000;
/** A peer that sends no byte for this many checks went away without a close. */
const PEER_SILENT_CHECKS = 3;

/**
 * Ends a socket whose peer went away without a close, as a phone that lost its network does. TCP
 * keeps such a socket for many minutes, and the host would keep its admission and leases. A live
 * peer answers each ping, and a peer that uploads a large message sends bytes too, so only a gone
 * peer reads as silent.
 */
const watchPeer = (nativeSocket: WebSocket, connection: Socket): void => {
  let bytesRead = connection.bytesRead;
  let silentChecks = 0;
  const timer = setInterval(() => {
    if (connection.bytesRead !== bytesRead) {
      bytesRead = connection.bytesRead;
      silentChecks = 0;
    } else if (++silentChecks >= PEER_SILENT_CHECKS) {
      nativeSocket.terminate();
      return;
    }
    nativeSocket.ping();
  }, PEER_CHECK_INTERVAL_MS);
  timer.unref();
  nativeSocket.once("close", () => clearInterval(timer));
};

export type NodeServerSocket<Data> = {
  data: Data;
  close(code: number, reason: string): void;
  /**
   * Queues one binary frame. Returns the frame size, -1 when the socket buffers data, or 0 when the
   * socket cannot send. `compress` applies per-message deflate when the client negotiated it.
   */
  send(frame: Uint8Array, compress?: boolean): number;
  /** The bytes that the socket queued and did not send yet. */
  bufferedAmount(): number;
};

export type NodeWebSocketHandler<Data> = {
  perMessageDeflate: boolean;
  maxPayloadLength: number;
  open?(socket: NodeServerSocket<Data>): void;
  message(socket: NodeServerSocket<Data>, data: string | Buffer): void;
  drain(socket: NodeServerSocket<Data>): void;
  close(socket: NodeServerSocket<Data>): void;
};

export type NodeFetchServer<Data> = {
  readonly port: number;
  stop(force: boolean): Promise<void>;
  /** Ends this HTTP response on abort without stopping the listener or host work. */
  bindResponseLifetime(signal: AbortSignal): void;
  upgrade(options: { data: Data }): boolean;
};

export type StartNodeFetchServerInput<Data> = {
  hostname: string;
  port: number;
  idleTimeoutSeconds?: number;
  fetch(
    request: Request,
    server: NodeFetchServer<Data>,
  ): Response | Promise<Response | undefined> | undefined;
  websocket?: NodeWebSocketHandler<Data>;
  onError(cause: unknown): void;
  onListenerError?(cause: unknown): void;
  /** Runs after bind and before request delivery. A thrown error closes the listener. */
  onListening?(server: NodeFetchServer<Data>): void;
};

/** Binds the host and owns its sockets. A forced stop ends active connections. */
export const startNodeFetchServer = async <Data>({
  hostname,
  port,
  idleTimeoutSeconds,
  fetch,
  websocket,
  onError,
  onListenerError,
  onListening,
}: StartNodeFetchServerInput<Data>): Promise<NodeFetchServer<Data>> => {
  const sockets = new Set<WebSocket>();
  const connections = new Set<Duplex>();
  const webSocketServer = websocket
    ? new WebSocketServer({
        noServer: true,
        perMessageDeflate: websocket.perMessageDeflate,
        maxPayload: websocket.maxPayloadLength,
      })
    : null;
  const server = createServer();
  server.on("connection", (socket) => {
    connections.add(socket);
    socket.on("close", () => connections.delete(socket));
  });
  if (idleTimeoutSeconds !== undefined) server.timeout = idleTimeoutSeconds * 1000;

  const stop = async (force: boolean): Promise<void> => {
    const closed = new Promise<void>((resolve, reject) => {
      server.close((cause) => (cause ? reject(cause) : resolve()));
    });
    if (force) {
      for (const socket of sockets) socket.terminate();
      server.closeAllConnections();
      for (const connection of connections) connection.destroy();
    }
    await closed;
    webSocketServer?.close();
  };

  const makeRequestServer = (
    outgoing: ServerResponse | null,
    upgrade: ((options: { data: Data }) => boolean) | null,
  ): NodeFetchServer<Data> => ({
    get port() {
      // SAFETY: this server exposes its port only after listen succeeds.
      return (server.address() as AddressInfo).port;
    },
    stop,
    bindResponseLifetime: (signal) => {
      if (!outgoing) return;
      const close = () => outgoing.destroy();
      signal.addEventListener("abort", close, { once: true });
      outgoing.once("close", () => signal.removeEventListener("abort", close));
      if (signal.aborted) close();
    },
    upgrade: (options) => upgrade?.(options) ?? false,
  });

  server.on("request", (incoming, outgoing) => {
    const abort = new AbortController();
    outgoing.on("close", () => abort.abort());
    void (async () => {
      const request = toRequest(incoming, hostname, abort.signal, outgoing);
      const response = await fetch(request, makeRequestServer(outgoing, null));
      if (!response) throw new Error("HTTP request did not produce a response.");
      if (abort.signal.aborted) {
        await response.body?.cancel();
        return;
      }
      await writeResponse(request, outgoing, response);
    })().catch((cause: unknown) => {
      if (abort.signal.aborted || outgoing.destroyed) return;
      onError(cause);
      if (outgoing.headersSent) outgoing.destroy(cause instanceof Error ? cause : undefined);
      else {
        outgoing.writeHead(500);
        outgoing.end("Internal server error.");
      }
    });
  });

  /** The requests of open upgraded sockets. Terminal presence follows their abort signals. */
  const upgradedRequests = new Set<Request>();
  server.on("upgrade", (incoming, socket, head) => {
    void (async () => {
      const abort = new AbortController();
      const request = toRequest(incoming, hostname, abort.signal);
      // The Request signal follows `abort` only while the Request lives. An upgraded socket outlives
      // the handler, so the server holds the Request until the socket closes.
      upgradedRequests.add(request);
      socket.once("close", () => {
        abort.abort();
        upgradedRequests.delete(request);
      });
      let upgraded = false;
      const requestServer = makeRequestServer(null, (options) => {
        if (!webSocketServer || !websocket) return false;
        webSocketServer.handleUpgrade(incoming, socket, head, (nativeSocket) => {
          upgraded = true;
          sockets.add(nativeSocket);
          // SAFETY: an HTTP server emits `upgrade` with the TCP socket of the connection.
          watchPeer(nativeSocket, socket as Socket);
          let backpressured = false;
          const wrapped: NodeServerSocket<Data> = {
            data: options.data,
            close: (code, reason) => nativeSocket.close(code, reason),
            bufferedAmount: () => nativeSocket.bufferedAmount,
            send: (frame, compress = false) => {
              if (nativeSocket.readyState !== WebSocket.OPEN) return 0;
              try {
                nativeSocket.send(frame, { binary: true, compress }, (cause) => {
                  if (cause) {
                    onError(cause);
                    nativeSocket.terminate();
                    return;
                  }
                  // Only a socket that reported a buffer waits for its drain.
                  if (!backpressured) return;
                  queueMicrotask(() => {
                    if (
                      backpressured &&
                      nativeSocket.readyState === WebSocket.OPEN &&
                      nativeSocket.bufferedAmount === 0
                    ) {
                      backpressured = false;
                      websocket.drain(wrapped);
                    }
                  });
                });
                if (nativeSocket.bufferedAmount === 0) return frame.byteLength;
                backpressured = true;
                return -1;
              } catch (cause) {
                onError(cause);
                return 0;
              }
            },
          };
          websocket.open?.(wrapped);
          nativeSocket.on("message", (data, binary) =>
            websocket.message(wrapped, toMessage(data, binary)),
          );
          nativeSocket.on("close", () => {
            sockets.delete(nativeSocket);
            websocket.close(wrapped);
          });
          nativeSocket.on("error", onError);
        });
        return true;
      });
      const response = await fetch(request, requestServer);
      if (!upgraded) {
        await writeUpgradeResponse(
          socket,
          response ?? new Response("WebSocket upgrade failed.", { status: 500 }),
        );
      }
    })().catch((cause: unknown) => {
      onError(cause);
      socket.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    const failed = (cause: Error): void => reject(cause);
    server.once("error", failed);
    server.listen(port, hostname, () => {
      server.on("error", onListenerError ?? onError);
      server.off("error", failed);
      try {
        onListening?.(makeRequestServer(null, null));
        resolve();
      } catch (cause) {
        void stop(true).then(
          () => reject(cause),
          (cleanup) =>
            reject(new AggregateError([cause, cleanup], "Listener setup and cleanup failed.")),
        );
      }
    });
  });
  return makeRequestServer(null, null);
};

const toRequest = (
  incoming: IncomingMessage,
  hostname: string,
  signal: AbortSignal,
  outgoing?: ServerResponse,
): Request => {
  const headers = new Headers();
  for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
    const name = incoming.rawHeaders[index];
    const value = incoming.rawHeaders[index + 1];
    if (name && value !== undefined) headers.append(name, value);
  }
  if (!headers.has("host") && incoming.headers.host) headers.set("host", incoming.headers.host);
  const method = incoming.method ?? "GET";
  const url = new URL(incoming.url ?? "/", `http://${incoming.headers.host ?? hostname}`);
  const hasBody = method !== "GET" && method !== "HEAD";
  const request = new Request(url, {
    method,
    headers,
    signal,
    ...(hasBody && {
      body: nodeReadableStream(incoming, () => {
        if (!outgoing) {
          incoming.destroy();
          return;
        }
        // Let HTTP close the socket after flushing the response. Destroying it here can reset it.
        incoming.pause();
        outgoing.shouldKeepAlive = false;
      }),
      duplex: "half" as const,
    }),
  });
  for (const [name, value] of headers) request.headers.set(name, value);
  return request;
};

const writeResponse = async (
  request: Request,
  outgoing: ServerResponse,
  response: Response,
): Promise<void> => {
  const headers = new Headers(Object.fromEntries(response.headers.entries()));
  const eligible = canCompress(response);
  const length = headers.get("content-length");
  let gzip =
    eligible && acceptsGzip(request) && (length === null || Number(length) >= MIN_GZIP_BYTES);
  if (gzip && request.method === "HEAD" && length === null) {
    // Omit metadata that needs a GET body read to choose.
    gzip = false;
    headers.delete("etag");
  }
  // SAFETY: Node uses the standard stream API; Bun adds unused helper types.
  let body =
    request.method !== "HEAD" && response.body
      ? Readable.fromWeb(response.body as typeof response.body & NodeReadableStream<Uint8Array>, {
          signal: request.signal,
        })
      : null;
  if (gzip && body && length === null) {
    const prefix = await readPrefix(body);
    gzip = prefix.size >= MIN_GZIP_BYTES;
    body = prefix.body;
    if (!gzip) headers.set("content-length", String(prefix.size));
  }
  if (eligible) {
    const vary = headers.get("vary");
    const fields = vary?.split(",").map((field) => field.trim().toLowerCase()) ?? [];
    if (!fields.includes("*") && !fields.includes("accept-encoding")) {
      headers.set("vary", vary ? `${vary}, Accept-Encoding` : "Accept-Encoding");
    }
  }
  if (gzip) {
    headers.set("content-encoding", "gzip");
    headers.delete("content-length");
    // Gzip changes the bytes, so the original ETag must be weak.
    const etag = headers.get("etag");
    if (etag && !etag.startsWith("W/")) headers.set("etag", `W/${etag}`);
  }
  outgoing.writeHead(response.status, Object.fromEntries(headers.entries()));
  if (!body) {
    await response.body?.cancel();
    outgoing.end();
    return;
  }
  if (gzip) await pipeline(body, createGzip(), outgoing);
  else await pipeline(body, outgoing);
};

// Stop once gzip is worth considering instead of buffering the whole response.
const readPrefix = async (body: Readable): Promise<{ size: number; body: Readable }> => {
  const iterator = body[Symbol.asyncIterator]();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MIN_GZIP_BYTES) {
    const next = await iterator.next();
    if (next.done) break;
    chunks.push(next.value);
    size += next.value.byteLength;
  }
  async function* replay(): AsyncGenerator<Uint8Array> {
    try {
      yield* chunks;
      yield* iterator;
    } finally {
      body.destroy();
    }
  }
  return { size, body: Readable.from(replay(), { objectMode: false }) };
};

const writeUpgradeResponse = async (socket: Duplex, response: Response): Promise<void> => {
  const body = Buffer.from(await response.arrayBuffer());
  const headers = [...response.headers.entries(), ["content-length", String(body.byteLength)]];
  const lines = [
    `HTTP/1.1 ${response.status} ${response.statusText || "Request rejected"}`,
    ...headers.map(([name, value]) => `${name}: ${value}`),
    "connection: close",
    "",
    "",
  ];
  socket.end(Buffer.concat([Buffer.from(lines.join("\r\n")), body]));
};

const toMessage = (data: RawData, binary: boolean): string | Buffer => {
  const bytes = Array.isArray(data)
    ? Buffer.concat(data)
    : data instanceof ArrayBuffer
      ? Buffer.from(data)
      : data;
  return binary ? bytes : bytes.toString("utf8");
};

const acceptsGzip = (request: Request): boolean => {
  const weights = new Map<string, number>();
  for (const entry of (request.headers.get("accept-encoding") ?? "").split(",")) {
    const [encoding, ...parameters] = entry.trim().toLowerCase().split(";");
    if (!encoding) continue;
    const parameter = parameters.find((value) => /^\s*q\s*=/.test(value));
    let weight = 1;
    if (parameter !== undefined) {
      const match = parameter.match(/^\s*q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)\s*$/);
      weight = match ? Number(match[1]) : 0;
    }
    weights.set(encoding.trim(), weight);
  }
  const gzipWeight = weights.get("gzip") ?? weights.get("*") ?? 0;
  return gzipWeight > 0 && gzipWeight >= (weights.get("identity") ?? 0);
};

const canCompress = (response: Response): boolean => {
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  return (
    contentType !== undefined &&
    // Gzip buffers its output, which would hold back the events of a stream.
    contentType !== "text/event-stream" &&
    (contentType.startsWith("text/") ||
      /^(?:application\/(?:json|javascript|[^/]+\+json)|image\/svg\+xml)$/.test(contentType)) &&
    !response.headers.has("content-encoding") &&
    !response.headers.has("content-range") &&
    response.status !== 206 &&
    response.status !== 204 &&
    response.status !== 205 &&
    !/(?:^|,)\s*no-transform\s*(?:,|$)/i.test(response.headers.get("cache-control") ?? "")
  );
};
