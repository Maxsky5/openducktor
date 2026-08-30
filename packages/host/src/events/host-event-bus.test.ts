import type { HostEventEnvelope } from "@openducktor/contracts";
import { createHostEventBus } from "./host-event-bus";

const createBus = () => createHostEventBus({ report: () => {} });

describe("createHostEventBus", () => {
  test("publishes typed envelopes to subscribers for a checked host channel", () => {
    const bus = createBus();
    const envelopes: HostEventEnvelope[] = [];

    bus.subscribe("openducktor://run-event", (envelope) => {
      envelopes.push(envelope);
    });

    bus.publish({ channel: "openducktor://run-event", payload: { taskId: "task-1" } });

    expect(envelopes).toEqual([
      { channel: "openducktor://run-event", payload: { taskId: "task-1" } },
    ]);
  });

  test("unsubscribes listeners without affecting later publications", () => {
    const bus = createBus();
    const envelopes: HostEventEnvelope[] = [];
    const unsubscribe = bus.subscribe("openducktor://run-event", (envelope) => {
      envelopes.push(envelope);
    });

    unsubscribe();
    bus.publish({ channel: "openducktor://run-event", payload: { sessionId: "session-1" } });

    expect(envelopes).toEqual([]);
  });

  test("rejects unknown event channels", () => {
    const bus = createBus();

    expect(() => {
      bus.subscribe("openducktor://missing-event", () => {});
    }).toThrow("Unknown OpenDucktor host event channel: openducktor://missing-event");
  });
  test("does not expose task events through the generic bus", () => {
    const bus = createBus();

    expect(() => bus.subscribe("openducktor://task-event", () => {})).toThrow(
      "Unknown OpenDucktor host event channel: openducktor://task-event",
    );
  });
  test("isolates listener failures and continues a snapshot delivery", () => {
    const failures: unknown[] = [];
    const bus = createHostEventBus({ report: ({ cause }) => failures.push(cause) });
    const received: HostEventEnvelope[] = [];
    bus.subscribe("openducktor://run-event", () => {
      throw new Error("listener failed");
    });
    bus.subscribe("openducktor://run-event", (envelope) => received.push(envelope));

    bus.publish({ channel: "openducktor://run-event", payload: { taskId: "task-1" } });

    expect(received).toEqual([
      { channel: "openducktor://run-event", payload: { taskId: "task-1" } },
    ]);
    expect(failures).toHaveLength(1);
  });
  test("uses a listener snapshot when a listener unsubscribes another listener", () => {
    const bus = createBus();
    const received: string[] = [];
    const unsubscribe = bus.subscribe("openducktor://run-event", () => received.push("second"));
    bus.subscribe("openducktor://run-event", () => {
      received.push("first");
      unsubscribe();
    });

    bus.publish({ channel: "openducktor://run-event", payload: {} });

    expect(received).toEqual(["second", "first"]);
  });
});
