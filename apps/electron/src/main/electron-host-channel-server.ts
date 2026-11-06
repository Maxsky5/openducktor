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
import { offeredSubprotocols, tokensMatch } from "@openducktor/remote-host/socket-offer";
import { randomBytes } from "node:crypto";
import type { ElectronHostChannelEndpoint } from "../shared/electron-bridge-contract";

const LOOPBACK_HOST = "127.0.0.1";

/** Loopback frames gain nothing from compression, so the desktop channel sends them as they are. */
const desktopWebSocketHandler = { ...hostWebSocketHandler, perMessageDeflate: false };

export type ElectronHostChannelServer = {
  readonly endpoint: ElectronHostChannelEndpoint;
  stop(): Promise<void>;
};

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
  const authorization = `${REMOTE_SOCKET_AUTHORIZATION_PREFIX}${token}`;
  const server = await startNodeFetchServer<HostWebSocketData>({
    hostname: LOOPBACK_HOST,
    port: 0,
    websocket: desktopWebSocketHandler,
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
      const offered = offeredSubprotocols(request);
      if (
        offered.length !== 2 ||
        offered[0] !== HOST_CHANNEL_SUBPROTOCOL ||
        !tokensMatch(offered[1], authorization)
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
