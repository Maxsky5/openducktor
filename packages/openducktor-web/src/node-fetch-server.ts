import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { type AddressInfo } from "node:net";
import { Readable, type Duplex } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { createGzip } from "node:zlib";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { nodeReadableStream } from "./node-readable-stream";

const MIN_GZIP_BYTES = 1024;

export type NodeServerSocket<Data> = {
  data: Data;
  close(code: number, reason: string): void;
  send(frame: Uint8Array): number;
};

export type NodeWebSocketHandler<Data> = {
  perMessageDeflate: boolean;
  maxPayloadLength: number;
  message(socket: NodeServerSocket<Data>, data: string | Buffer): void;
  drain(socket: NodeServerSocket<Data>): void;
  close(socket: NodeServerSocket<Data>): void;
};

export type NodeFetchServer<Data> = {
  readonly port: number;
  stop(force: boolean): Promise<void>;
  timeout(request: Request, seconds: number): void;
  upgrade(options: { data: Data }): boolean;
};

export type StartNodeFetchServerInput<Data> = {
  hostname: string;
  port: number;
  idleTimeoutSeconds?: number;
  fetch(request: Request, server: NodeFetchServer<Data>): Response | Promise<Response> | undefined;
  websocket?: NodeWebSocketHandler<Data>;
  onError(cause: unknown): void;
};

/** Binds the host and owns its sockets. A forced stop ends active connections. */
export const startNodeFetchServer = async <Data>({
  hostname,
  port,
  idleTimeoutSeconds,
  fetch,
  websocket,
  onError,
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
    timeout: (_request, seconds) => outgoing?.setTimeout(seconds * 1000),
    upgrade: (options) => upgrade?.(options) ?? false,
  });

  server.on("request", (incoming, outgoing) => {
    const abort = new AbortController();
    outgoing.on("close", () => {
      if (!outgoing.writableEnded) abort.abort();
    });
    void (async () => {
      const request = toRequest(incoming, hostname, abort.signal);
      const response = await fetch(request, makeRequestServer(outgoing, null));
      if (!response) throw new Error("HTTP request did not produce a response.");
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

  server.on("upgrade", (incoming, socket, head) => {
    void (async () => {
      const request = toRequest(incoming, hostname, new AbortController().signal);
      let upgraded = false;
      const requestServer = makeRequestServer(null, (options) => {
        if (!webSocketServer || !websocket) return false;
        webSocketServer.handleUpgrade(incoming, socket, head, (nativeSocket) => {
          upgraded = true;
          sockets.add(nativeSocket);
          const wrapped: NodeServerSocket<Data> = {
            data: options.data,
            close: (code, reason) => nativeSocket.close(code, reason),
            send: (frame) => {
              if (nativeSocket.readyState !== WebSocket.OPEN) return 0;
              try {
                nativeSocket.send(frame, { binary: true, compress: false }, (cause) => {
                  if (cause) {
                    onError(cause);
                    nativeSocket.terminate();
                    return;
                  }
                  queueMicrotask(() => {
                    if (
                      nativeSocket.readyState === WebSocket.OPEN &&
                      nativeSocket.bufferedAmount === 0
                    ) {
                      websocket.drain(wrapped);
                    }
                  });
                });
                return nativeSocket.bufferedAmount > 0 ? -1 : frame.byteLength;
              } catch (cause) {
                onError(cause);
                return 0;
              }
            },
          };
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
      server.on("error", onError);
      server.off("error", failed);
      resolve();
    });
  });
  return makeRequestServer(null, null);
};

const toRequest = (incoming: IncomingMessage, hostname: string, signal: AbortSignal): Request => {
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
      body: nodeReadableStream(incoming),
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
