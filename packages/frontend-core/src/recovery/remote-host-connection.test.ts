import { savedTestAuthorizationStore } from "../../../host-client/src/remote/test-support/authorization";
import { createFakeHostChannel } from "../../../host-client/src/remote/test-support/host-channel";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { REMOTE_MAX_REPLY_BYTES, type AgentSessionLiveEnvelope } from "@openducktor/contracts";
import { liveSessionStreamEventName } from "@openducktor/host-client";
import type { RemoteTransport } from "@openducktor/host-client/remote";
import { QueryObserver } from "@tanstack/react-query";
import { createClientQueryClient } from "../connection/client-query-client";
import { createChannelTestTransport } from "../test-support/remote-channel-transport";
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
  openSocket: () => Promise.reject(new Error("No socket in this test.")),
});

const connect = (failure: Error | null) =>
  createRemoteHostConnection({
    authorizationStore: savedTestAuthorizationStore(),
    clientKind: "mobile",
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

const connectTo = (transport: RemoteTransport) =>
  createRemoteHostConnection({
    authorizationStore: savedTestAuthorizationStore(),
    clientKind: "mobile",
    endpoint: "https://host.test/remote",
    version: "mobile-release",
    transport,
    queryClient: createClientQueryClient(),
  });

describe("live sessions across a reconnect", () => {
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
  const liveEnvelope = (envelope: AgentSessionLiveEnvelope) =>
    ({ channel: "openducktor://agent-session-live-event", payload: envelope }) as const;
  /** A host whose channel drops once. The second channel replays its missed events with `gaps`. */
  const scriptedHost = (gaps: string[]) => {
    let attaches = 0;
    const channel = createFakeHostChannel({
      invoke: (command) => {
        if (command !== "agent_session_live_attach") return { result: null };
        attaches += 1;
        return {
          result: {
            type: "snapshot",
            repoPath: "/repo",
            sessions: [],
            messageQueues: [],
            sequence: attaches,
          },
        };
      },
      answer: (request, socket) => {
        if (request.method !== "events.open" || request.cursor === null) return undefined;
        // The reconnect replays the missed event and reports `gaps`.
        socket.send(
          {
            type: "host_event",
            id: request.cursor.hostEventId + 1,
            name: liveSessionStreamEventName("/repo"),
          },
          JSON.stringify(liveEnvelope(transcriptEvent("missed", 3))),
        );
        socket.send(
          { type: "result", id: request.id },
          JSON.stringify({
            hostEpoch: request.cursor.hostEpoch,
            hostEventId: request.cursor.hostEventId + 1,
            hostChanged: false,
            gaps,
          }),
        );
        socket.send({
          type: "notification",
          frame: {
            type: "attached",
            cursor: { epoch: crypto.randomUUID(), sequence: 0 },
            reason: "new",
            health: [],
          },
        });
        return "none";
      },
    });
    const { transport } = createChannelTestTransport({ channel });
    return { transport, channel, attaches: () => attaches };
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
    const connection = connectTo(host.transport);
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
      host.channel.emit(
        liveEnvelope(transcriptEvent("before", 2)),
        liveSessionStreamEventName("/repo"),
      );
      await waitForExpectation(() => expect(received).toHaveLength(2));
      host.channel.closeAll();
      // The client reconnects after its first backoff of 500 ms.
      await waitForExpectation(() => {
        expect(host.channel.sockets).toHaveLength(2);
        expect(connection.remote.readState().status).toBe("connected");
      }, 3_000);
      host.channel.emit(
        liveEnvelope(transcriptEvent("after", 4)),
        liveSessionStreamEventName("/repo"),
      );
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

describe("an oversized reply during recovery", () => {
  test("fails only its read, and the connection recovers", async () => {
    let reads = 0;
    const host = createChannelTestTransport({
      channel: createFakeHostChannel({
        invoke: (command) => {
          if (command !== "custom_agent_role_list") return { result: null };
          reads += 1;
          if (reads === 1) return { result: [] };
          return { error: { kind: "reply_too_large", limitBytes: REMOTE_MAX_REPLY_BYTES } };
        },
      }),
    });
    const queryClient = createClientQueryClient();
    const connection = createRemoteHostConnection({
      authorizationStore: savedTestAuthorizationStore(),
      clientKind: "mobile",
      endpoint: "https://host.test/remote",
      version: "mobile-release",
      transport: host.transport,
      queryClient,
    });
    const stop = new QueryObserver(queryClient, {
      queryKey: ["custom-agent-roles"],
      queryFn: () => connection.client.customAgentRoleList(),
      retry: false,
      staleTime: Infinity,
    }).subscribe(() => {});
    try {
      await connection.waitForAdmission();
      await waitForExpectation(() =>
        expect(queryClient.getQueryState(["custom-agent-roles"])?.status).toBe("success"),
      );

      await connection.remote.retry();

      expect(connection.remote.readState()).toMatchObject({ status: "connected" });
      expect(queryClient.getQueryState(["custom-agent-roles"])).toMatchObject({
        status: "error",
        error: { failure: { code: "consumer_overflow" } },
      });
      expect({ admissions: host.admissions(), reads }).toEqual({ admissions: 2, reads: 2 });
    } finally {
      stop();
      await connection.remote.disconnect();
      queryClient.clear();
    }
  });
});
