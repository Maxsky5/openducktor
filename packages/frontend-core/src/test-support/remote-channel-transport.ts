import {
  TEST_CONNECTION_TOKEN,
  TEST_HOST_ID,
} from "../../../host-client/src/remote/test-support/authorization";
import {
  createFakeHostChannel,
  type FakeHostChannel,
} from "../../../host-client/src/remote/test-support/host-channel";
import {
  HOST_CHANNEL_SUBPROTOCOL,
  REMOTE_BASELINE_CAPABILITIES,
  REMOTE_PROTOCOL_VERSION,
  type RemoteHostDescriptor,
} from "@openducktor/contracts";
import type { RemoteHttpResponse, RemoteTransport } from "@openducktor/host-client/remote";
import { openRemoteSocket } from "@openducktor/host-client/remote/socket";

const encoder = new TextEncoder();

export const testJsonResponse = <Value>(value: Value, status = 200): RemoteHttpResponse => ({
  status,
  headers: {},
  body: (async function* () {
    if (status !== 204) yield encoder.encode(JSON.stringify(value));
  })(),
});

export const testRemoteDescriptor = (
  overrides: Partial<RemoteHostDescriptor> = {},
): RemoteHostDescriptor => ({
  shell: "web",
  appVersion: "host",
  hostInstanceId: "instance-1",
  hostId: TEST_HOST_ID,
  accessPolicy: "pairing",
  protocols: [
    { version: REMOTE_PROTOCOL_VERSION, capabilities: [...REMOTE_BASELINE_CAPABILITIES] },
  ],
  ...overrides,
});

type ChannelTestTransportOptions = {
  channel?: FakeHostChannel;
  /** The host of each new admission. */
  descriptor?: () => RemoteHostDescriptor;
  /** Answers another HTTP request. Undefined falls back to the defaults. */
  request?: (
    ...args: Parameters<RemoteTransport["request"]>
  ) => Promise<RemoteHttpResponse | undefined>;
  /** Opens the terminal socket. The default refuses it. */
  openTerminal?: (
    ...args: Parameters<RemoteTransport["openSocket"]>
  ) => ReturnType<RemoteTransport["openSocket"]>;
};

/**
 * A remote transport that admits each connection with the test token and serves the host channel
 * from a fake host channel. Other HTTP requests return the descriptor, or 204 for DELETE.
 */
export const createChannelTestTransport = ({
  channel = createFakeHostChannel(),
  descriptor = () => testRemoteDescriptor(),
  request,
  openTerminal,
}: ChannelTestTransportOptions = {}) => {
  let admissions = 0;
  const transport: RemoteTransport = {
    async request(method, url, headers, signal, body) {
      if (url.endsWith("/connections")) {
        admissions += 1;
        return testJsonResponse({
          status: "accepted",
          connectionToken: TEST_CONNECTION_TOKEN,
          host: descriptor(),
          connectionId: crypto.randomUUID(),
          protocolVersion: REMOTE_PROTOCOL_VERSION,
          missingOptionalCapabilities: [],
        });
      }
      const answered = await request?.(method, url, headers, signal, body);
      if (answered) return answered;
      if (method === "DELETE") return testJsonResponse(null, 204);
      return testJsonResponse(descriptor());
    },
    openSocket(url, protocol, headers, signal, onFrame, onClose) {
      if (protocol === HOST_CHANNEL_SUBPROTOCOL)
        return openRemoteSocket(channel.createSocket, protocol, headers, signal, onFrame, onClose);
      if (openTerminal) return openTerminal(url, protocol, headers, signal, onFrame, onClose);
      return Promise.reject(new Error("This test opens no terminal."));
    },
  };
  return { transport, channel, admissions: () => admissions };
};
