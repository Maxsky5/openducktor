import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  REMOTE_BASELINE_CAPABILITIES,
  REMOTE_PROTOCOL_VERSION,
  type AgentSessionLiveEnvelope,
  type BrowserEventCursor,
} from "@openducktor/contracts";
import { liveSessionStreamEventName } from "@openducktor/host-client";
import type { RemoteHttpResponse, RemoteTransport } from "@openducktor/host-client/remote";
import { createClientQueryClient } from "../connection/client-query-client";
import { waitForExpectation } from "../test-support/wait-for-expectation";
import { createRemoteHostConnection } from "./remote-host-connection";

/** A transport whose discovery waits until its read stops, or fails at once with `failure`. */
const discoveryTransport = (failure: Error | null): RemoteTransport => ({
  request: (_method, _url, _headers, signal) =>
    new Promise((_resolve, reject) => {
      if (failure) {
        reject(failure);
        return;
      }
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  openTerminal: () => Promise.reject(new Error("No terminal in this test.")),
});

const connect = (failure: Error | null) =>
  createRemoteHostConnection({
    endpoint: "https://host.test/remote",
    version: "mobile-release",
    transport: discoveryTransport(failure),
    queryClient: createClientQueryClient(),
  });

let errors: ReturnType<typeof spyOn> | null = null;
afterEach(() => {
  errors?.mockRestore();
  errors = null;
});

describe("createRemoteHostConnection", () => {
  test("logs no failure when its owner disconnects during the first connection", async () => {
    errors = spyOn(console, "error").mockImplementation(() => {});
    const connection = connect(null);
    expect(connection.remote.readState().status).toBe("connecting");
    await connection.remote.disconnect();
    await Promise.resolve();
    expect(connection.remote.readState().status).toBe("idle");
    expect(errors).not.toHaveBeenCalled();
  });

  test("logs a real failure of the first connection", async () => {
    errors = spyOn(console, "error").mockImplementation(() => {});
    const connection = connect(new Error("The network is down."));
    await waitForExpectation(() =>
      expect(errors).toHaveBeenCalledWith("Remote host connection failed", expect.anything()),
    );
    await connection.remote.disconnect();
  });
});

describe("live sessions across a reconnect", () => {
  const encoder = new TextEncoder();
  const json = <Value>(value: Value): RemoteHttpResponse => ({
    status: 200,
    headers: {},
    body: (async function* () {
      yield encoder.encode(JSON.stringify(value));
    })(),
  });
  const frame = <Data>(event: string, data: Data, id?: BrowserEventCursor) =>
    `${id === undefined ? "" : `id: ${JSON.stringify(id)}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const transcriptEvent = (messageId: string, sequence: number): AgentSessionLiveEnvelope => ({
    type: "transcript_event",
    sequence,
    event: {
      type: "assistant_message",
      externalSessionId: "thread",
      messageId,
      message: messageId,
      timestamp: "2026-10-24T08:00:00.000Z",
      sessionRef: {
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread",
      },
    },
  });
  const liveFrame = (envelope: AgentSessionLiveEnvelope, hostEventId: number) =>
    frame(
      liveSessionStreamEventName("/repo"),
      { channel: "openducktor://agent-session-live-event", payload: envelope },
      { hostEpoch: "epoch-1", hostEventId, notificationCursor: null },
    );
  const attached = frame("notification-frame", {
    type: "attached",
    cursor: { epoch: crypto.randomUUID(), sequence: 0 },
    reason: "new",
    health: [],
  });

  /** A host whose event stream drops once. The second stream replays `replayed` with `gaps`. */
  const scriptedHost = (gaps: string[]) => {
    const streams: { push: (text: string) => void; drop: () => void }[] = [];
    let attaches = 0;
    const descriptor = {
      shell: "web",
      appVersion: "host",
      hostInstanceId: "instance-1",
      accessPolicy: "network_reach",
      protocols: [
        { version: REMOTE_PROTOCOL_VERSION, capabilities: [...REMOTE_BASELINE_CAPABILITIES] },
      ],
    };
    const transport: RemoteTransport = {
      async request(_method, url, _headers, signal) {
        if (url === "https://host.test/remote") return json(descriptor);
        if (url.endsWith("/connections"))
          return json({
            status: "accepted",
            host: descriptor,
            connectionId: crypto.randomUUID(),
            protocolVersion: REMOTE_PROTOCOL_VERSION,
            missingOptionalCapabilities: [],
          });
        if (url.endsWith("/events")) {
          const first = streams.length === 0;
          const queue: string[] = [
            first
              ? frame("replay-complete", { hostChanged: false, gaps: [] }) + attached
              : liveFrame(transcriptEvent("missed", 3), 2) +
                frame("replay-complete", { hostChanged: false, gaps }) +
                attached,
          ];
          let wake = () => {};
          let dropped = false;
          streams.push({
            push: (text) => {
              queue.push(text);
              wake();
            },
            drop: () => {
              dropped = true;
              wake();
            },
          });
          return {
            status: 200,
            headers: {},
            body: (async function* () {
              while (true) {
                const next = queue.shift();
                if (next !== undefined) {
                  yield encoder.encode(next);
                  continue;
                }
                if (dropped) throw new Error("The host event stream dropped.");
                await new Promise<void>((resolve, reject) => {
                  wake = resolve;
                  signal.addEventListener("abort", () => reject(signal.reason), { once: true });
                });
              }
            })(),
          };
        }
        if (url.endsWith("/invoke/agent_session_live_attach")) {
          attaches += 1;
          return json({
            type: "snapshot",
            repoPath: "/repo",
            sessions: [],
            messageQueues: [],
            sequence: attaches,
          });
        }
        return json(null);
      },
      openTerminal: () => Promise.reject(new Error("No terminal in this test.")),
    };
    return { transport, streams, attaches: () => attaches };
  };

  test.each([
    ["a complete replay keeps the state and delivers the missed changes", [], 1],
    [
      "a gap for another repository keeps this live state",
      [liveSessionStreamEventName("/other")],
      1,
    ],
    [
      "a replay gap replaces the state with a new snapshot",
      [liveSessionStreamEventName("/repo")],
      2,
    ],
  ] as const)("%s", async (_name, gaps, attaches) => {
    const host = scriptedHost([...gaps]);
    const connection = createRemoteHostConnection({
      endpoint: "https://host.test/remote",
      version: "mobile-release",
      transport: host.transport,
      queryClient: createClientQueryClient(),
    });
    const received: AgentSessionLiveEnvelope[] = [];
    const controls: unknown[] = [];
    try {
      await connection.waitForAdmission();
      const stopProgress = await connection.subscribeStartupProgress((event) => {
        controls.push(event);
      });
      const stop = await connection.observeAgentSessionLive({ repoPath: "/repo" }, (envelope) =>
        received.push(envelope),
      );
      host.streams[0]?.push(liveFrame(transcriptEvent("before", 2), 1));
      await waitForExpectation(() => expect(received).toHaveLength(2));
      host.streams[0]?.drop();
      // The client reconnects after its first backoff of 500 ms.
      await waitForExpectation(() => {
        expect(host.streams).toHaveLength(2);
        expect(connection.remote.readState().status).toBe("connected");
      }, 3_000);
      host.streams[1]?.push(liveFrame(transcriptEvent("after", 4), 3));
      await waitForExpectation(() => expect(received.at(-1)).toEqual(transcriptEvent("after", 4)));

      expect(controls).toContainEqual({
        __openducktorConnectionControl: true,
        kind: "reconnected",
        missedEvents: gaps.length > 0,
        hostChanged: false,
        missedEventNames: gaps,
      });
      expect(host.attaches()).toBe(attaches);
      expect(received).toEqual(
        attaches === 1
          ? [
              {
                type: "snapshot",
                repoPath: "/repo",
                sessions: [],
                messageQueues: [],
                sequence: 1,
                isConnectionSnapshot: true,
              },
              transcriptEvent("before", 2),
              transcriptEvent("missed", 3),
              transcriptEvent("after", 4),
            ]
          : [
              {
                type: "snapshot",
                repoPath: "/repo",
                sessions: [],
                messageQueues: [],
                sequence: 1,
                isConnectionSnapshot: true,
              },
              transcriptEvent("before", 2),
              {
                type: "snapshot",
                repoPath: "/repo",
                sessions: [],
                messageQueues: [],
                sequence: 2,
                isConnectionSnapshot: true,
                historyReplayGap: true,
              },
              transcriptEvent("after", 4),
            ],
      );
      stopProgress();
      stop();
    } finally {
      await connection.remote.disconnect();
    }
  });
});
