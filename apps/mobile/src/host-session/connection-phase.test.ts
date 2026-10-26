import { describe, expect, test } from "bun:test";
import type { RemoteFailure } from "@openducktor/contracts";
import {
  type ConnectionPhase,
  commandsAllowed,
  connectionCopy,
  connectionPhase,
  retryStatusLabel,
} from "./connection-phase";

const failure: RemoteFailure = {
  code: "unavailable",
  message: "The host did not answer.",
  nextAction: "Check the network, then retry.",
  transportCause: "network",
};

describe("connection phase", () => {
  test("maps the first attempt and a later attempt to different phases", () => {
    const state = { status: "connecting" as const, generation: 1 };
    expect(
      connectionPhase({
        state,
        connectedBefore: false,
        lastFailure: null,
        deviceOnline: true,
        resuming: false,
      }),
    ).toEqual({
      kind: "connecting",
    });
    expect(
      connectionPhase({
        state,
        connectedBefore: true,
        lastFailure: null,
        deviceOnline: true,
        resuming: false,
      }).kind,
    ).toBe("reconnecting");
  });

  test("shows restoring work while the host synchronizes", () => {
    expect(
      connectionPhase({
        state: { status: "synchronizing", generation: 1 },
        connectedBefore: false,
        lastFailure: null,
        deviceOnline: true,
        resuming: false,
      }).kind,
    ).toBe("restoring");
  });

  test("keeps a permanent failure visible even without a network link", () => {
    const phase = connectionPhase({
      state: { status: "failed", generation: 2, failure },
      connectedBefore: true,
      lastFailure: null,
      deviceOnline: false,
      resuming: false,
    });
    expect(phase).toEqual({ kind: "failed", failure });
    expect(connectionCopy(phase, "studio")).toMatchObject({
      message: "The host did not answer.",
      checks: [
        "OpenDucktor is open on the host computer",
        "Remote control is on in its settings",
        "This device is on the same network",
      ],
    });
  });

  test("reports an offline device instead of a reconnect", () => {
    expect(
      connectionPhase({
        state: { status: "disconnected", generation: 2, failure },
        connectedBefore: true,
        lastFailure: null,
        deviceOnline: false,
        resuming: false,
      }),
    ).toEqual({ kind: "offline" });
  });

  test("keeps the last failure while a retry connects, so the screen does not reset", () => {
    expect(
      connectionPhase({
        state: { status: "connecting", generation: 3 },
        connectedBefore: false,
        lastFailure: failure,
        deviceOnline: true,
        resuming: false,
      }),
    ).toEqual({ kind: "reconnecting", failure });
  });

  test("shows a failure from the background period as a reconnect while the app resumes", () => {
    const input = {
      connectedBefore: true,
      lastFailure: failure,
      deviceOnline: true,
      resuming: true,
    };
    const reconnecting: ConnectionPhase = { kind: "reconnecting", failure: null };
    expect(
      connectionPhase({ ...input, state: { status: "disconnected", generation: 2, failure } }),
    ).toEqual(reconnecting);
    expect(connectionPhase({ ...input, state: { status: "connecting", generation: 3 } })).toEqual(
      reconnecting,
    );
    expect(connectionCopy(reconnecting, "studio")).toMatchObject({
      status: "Reconnecting…",
      busy: true,
    });
    expect(
      connectionPhase({ ...input, state: { status: "synchronizing", generation: 3 } }).kind,
    ).toBe("restoring");
    expect(
      connectionPhase({
        ...input,
        deviceOnline: false,
        state: { status: "connecting", generation: 3 },
      }),
    ).toEqual({ kind: "offline" });
    // A first connection that never connected still shows its first attempt.
    expect(
      connectionPhase({
        ...input,
        connectedBefore: false,
        state: { status: "connecting", generation: 3 },
      }),
    ).toEqual({ kind: "connecting" });
  });

  test("allows host commands only while connected", () => {
    expect(commandsAllowed({ kind: "connected" })).toBe(true);
    for (const kind of ["connecting", "restoring", "offline"] as const) {
      expect(commandsAllowed({ kind })).toBe(false);
    }
    expect(commandsAllowed({ kind: "reconnecting", failure })).toBe(false);
  });

  test("names an unreachable host and offers a retry", () => {
    const copy = connectionCopy({ kind: "reconnecting", failure }, "studio");
    expect(copy).toMatchObject({
      status: "Can't reach the host",
      title: "Can't reach your host",
      tone: "warning",
      busy: false,
      canRetry: true,
    });
  });

  test("shows progress while a dropped connection reconnects by itself", () => {
    expect(connectionCopy({ kind: "reconnecting", failure: null }, "studio")).toMatchObject({
      title: "Reconnecting to studio",
      busy: true,
    });
  });

  test("names a refused connection as a failure, not as an unreachable host", () => {
    const refused: RemoteFailure = {
      code: "protocol_mismatch",
      message: "The host does not support this app version.",
      nextAction: "Update OpenDucktor on the host.",
    };
    expect(connectionCopy({ kind: "failed", failure: refused }, "studio")).toMatchObject({
      title: "Connection failed",
      message: "The host does not support this app version. Update OpenDucktor on the host.",
      tone: "destructive",
    });
  });

  test("waits for the network without a retry while the device is offline", () => {
    expect(connectionCopy({ kind: "offline" }, "studio")).toMatchObject({
      title: "You're offline",
      canRetry: false,
    });
  });
});

describe("retryStatusLabel", () => {
  const idle = { busy: false, status: "Can't reach the host" };

  test("shows a manual retry first, then the work of the app", () => {
    expect(
      retryStatusLabel({ phase: { kind: "offline" }, copy: idle, retrying: true, failedAt: 1 }),
    ).toBe("Retrying…");
    expect(
      retryStatusLabel({
        phase: { kind: "connecting" },
        copy: { busy: true, status: "Connecting" },
        retrying: false,
        failedAt: null,
      }),
    ).toBe("Connecting");
  });

  test("names the time of a failed manual retry", () => {
    expect(
      retryStatusLabel({
        phase: { kind: "reconnecting", failure: null },
        copy: idle,
        retrying: false,
        failedAt: Date.parse("2026-10-19T12:00:00.000Z"),
      }),
    ).toStartWith("Still unreachable · tried at ");
  });

  test("says what happens next", () => {
    const label = (phase: Parameters<typeof retryStatusLabel>[0]["phase"]) =>
      retryStatusLabel({ phase, copy: idle, retrying: false, failedAt: null });
    expect(label({ kind: "failed", failure: null })).toBe("Automatic retries stopped");
    expect(label({ kind: "offline" })).toBe("Waiting for a network");
    expect(label({ kind: "reconnecting", failure: null })).toBe("Retries automatically");
  });
});
