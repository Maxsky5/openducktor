import type { RemoteTransport } from "@openducktor/host-client/remote";
import { OpenDucktorNetwork } from "../../modules/openducktor-network";
import { createNativeRemoteTransport } from "./native-remote-transport";

/**
 * The device transport: the in-repo native HTTP module for requests and streams, and the React
 * Native WebSocket for terminals.
 */
export const createDeviceRemoteTransport = (): RemoteTransport =>
  createNativeRemoteTransport({
    network: OpenDucktorNetwork,
    createWebSocket: (url, protocols, options) => new WebSocket(url, protocols, options),
    createRequestId: () => crypto.randomUUID(),
  });
