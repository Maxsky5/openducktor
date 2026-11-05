import { HOST_CHANNEL_MAX_CLIENT_MESSAGE_BYTES } from "@openducktor/contracts";
import {
  hostChannelWebSocketHandler,
  type HostChannelSocket,
  type HostChannelSocketData,
} from "./host-channel";
import type { NodeServerSocket, NodeWebSocketHandler } from "./node-fetch-server";
import {
  terminalWebSocketHandler,
  type TerminalServerSocket,
  type TerminalWebSocketData,
} from "./terminals/terminal-websocket-handler";

/** The data of a host WebSocket: a terminal connection or a host channel. */
export type HostWebSocketData = TerminalWebSocketData | HostChannelSocketData;
export type HostWebSocketServerSocket = NodeServerSocket<HostWebSocketData>;

const isChannel = (socket: HostWebSocketServerSocket): socket is HostChannelSocket =>
  socket.data.kind === "channel";
// SAFETY: a socket that is no channel carries terminal data, the only other member of the union.
const asTerminal = (socket: HostWebSocketServerSocket): TerminalServerSocket =>
  socket as TerminalServerSocket;

/**
 * Routes each socket to its handler. The terminal handler enforces its own smaller frame limit, and
 * it sends its frames without compression.
 */
export const hostWebSocketHandler: NodeWebSocketHandler<HostWebSocketData> = {
  perMessageDeflate: true,
  maxPayloadLength: HOST_CHANNEL_MAX_CLIENT_MESSAGE_BYTES,
  open(socket) {
    if (isChannel(socket)) hostChannelWebSocketHandler.open(socket);
    else terminalWebSocketHandler.open(asTerminal(socket));
  },
  message(socket, data) {
    if (isChannel(socket)) hostChannelWebSocketHandler.message(socket, data);
    else terminalWebSocketHandler.message(asTerminal(socket), data);
  },
  drain(socket) {
    if (isChannel(socket)) hostChannelWebSocketHandler.drain(socket);
    else terminalWebSocketHandler.drain(asTerminal(socket));
  },
  close(socket) {
    if (isChannel(socket)) hostChannelWebSocketHandler.close(socket);
    else terminalWebSocketHandler.close(asTerminal(socket));
  },
};
