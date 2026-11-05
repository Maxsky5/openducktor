import {
  HOST_CHANNEL_SUBPROTOCOL,
  REMOTE_SOCKET_AUTHORIZATION_PREFIX,
} from "@openducktor/contracts";
import type { HostChannelSocketData } from "@openducktor/remote-host/host-channel";
import {
  hostWebSocketHandler,
  type HostWebSocketData,
} from "@openducktor/remote-host/host-websocket-handler";
import { startNodeFetchServer } from "@openducktor/remote-host/node-fetch-server";
import { randomBytes, timingSafeEqual } from "node:crypto";

const LOOPBACK_HOST = "127.0.0.1";

/** The address and per-launch token of the desktop host channel. */
export type ElectronHostChannelEndpoint = { url: string; token: string };

export type ElectronHostChannelServer = {
  readonly endpoint: ElectronHostChannelEndpoint;
  stop(): Promise<void>;
};

const tokensMatch = (received: string, expected: string): boolean =>
  received.length === expected.length &&
  timingSafeEqual(Buffer.from(received), Buffer.from(expected));

/**
 * Serves the host channel of the desktop windows on a loopback port. A socket must come from a
 * renderer origin and offer the per-launch token, which only OpenDucktor windows receive over IPC.
 * The listener serves no other route.
 */
export const startElectronHostChannelServer = async ({
  rendererOrigins,
  createChannel,
  onError,
}: {
  rendererOrigins: ReadonlySet<string>;
  createChannel(): HostChannelSocketData;
  onError(cause: unknown): void;
}): Promise<ElectronHostChannelServer> => {
  const token = randomBytes(32).toString("base64url");
  const expectedProtocols = [
    HOST_CHANNEL_SUBPROTOCOL,
    `${REMOTE_SOCKET_AUTHORIZATION_PREFIX}${token}`,
  ];
  const server = await startNodeFetchServer<HostWebSocketData>({
    hostname: LOOPBACK_HOST,
    port: 0,
    websocket: hostWebSocketHandler,
    onError,
    fetch(request, requestServer) {
      const url = new URL(request.url);
      if (url.pathname !== "/channel" || request.method !== "GET")
        return new Response("Not found.", { status: 404 });
      // A page that resolves another name to loopback cannot reach the channel.
      if (request.headers.get("host") !== `${LOOPBACK_HOST}:${requestServer.port}`)
        return new Response("Request host is not allowed.", { status: 403 });
      if (!rendererOrigins.has(request.headers.get("origin") ?? ""))
        return new Response("Socket origin is not allowed.", { status: 403 });
      const offered = (request.headers.get("sec-websocket-protocol") ?? "")
        .split(",")
        .map((protocol) => protocol.trim());
      if (
        offered.length !== expectedProtocols.length ||
        offered[0] !== expectedProtocols[0] ||
        !tokensMatch(offered[1] ?? "", expectedProtocols[1] ?? "")
      )
        return new Response("Socket authorization is missing or invalid.", { status: 401 });
      return requestServer.upgrade({ data: createChannel() })
        ? undefined
        : new Response("WebSocket upgrade failed.", { status: 500 });
    },
  });
  return {
    endpoint: { url: `ws://${LOOPBACK_HOST}:${server.port}/channel`, token },
    stop: () => server.stop(true),
  };
};
