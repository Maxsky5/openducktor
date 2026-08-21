import {
  HOST_EVENT_CHANNELS,
  hostEventEnvelopeSchema,
  parseHostEventChannel,
  parseHostEventEnvelope,
} from "./host-event-schemas";

describe("host event contracts", () => {
  test("keeps the three host event channels canonical", () => {
    expect(HOST_EVENT_CHANNELS).toEqual([
      "openducktor://run-event",
      "openducktor://dev-server-event",
      "openducktor://agent-session-live-event",
    ]);
    expect(HOST_EVENT_CHANNELS).not.toContain("openducktor://task-event");
    expect(parseHostEventChannel("openducktor://run-event")).toBe("openducktor://run-event");
  });

  test("parses each channel payload through its envelope branch", () => {
    const envelope = parseHostEventEnvelope({
      channel: "openducktor://agent-session-live-event",
      payload: { type: "snapshot", repoPath: "/repo", sessions: [] },
    });

    expect(envelope).toEqual({
      channel: "openducktor://agent-session-live-event",
      payload: { type: "snapshot", repoPath: "/repo", sessions: [] },
    });
    expect(
      hostEventEnvelopeSchema.safeParse({
        channel: "openducktor://dev-server-event",
        payload: { type: "not-a-dev-event" },
      }).success,
    ).toBe(false);
  });

  test("preserves channel and envelope validation messages", () => {
    expect(() => parseHostEventChannel("openducktor://missing-event")).toThrow(
      "Unknown OpenDucktor host event channel: openducktor://missing-event",
    );
    expect(() =>
      parseHostEventEnvelope(JSON.parse('{"channel":"openducktor://missing-event","payload":{}}')),
    ).toThrow("Invalid OpenDucktor host event envelope.");
  });
});
