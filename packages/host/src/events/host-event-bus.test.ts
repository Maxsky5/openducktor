import { createHostEventBus } from "./host-event-bus";

const createBus = () => createHostEventBus({ report: () => {} });

describe("createHostEventBus", () => {
  test("publishes payloads to subscribers for a checked host channel", () => {
    const bus = createBus();
    const payloads: unknown[] = [];

    bus.subscribe("openducktor://run-event", (payload) => {
      payloads.push(payload);
    });

    bus.publish("openducktor://run-event", { taskId: "task-1" });

    expect(payloads).toEqual([{ taskId: "task-1" }]);
  });

  test("unsubscribes listeners without affecting later publications", () => {
    const bus = createBus();
    const payloads: unknown[] = [];
    const unsubscribe = bus.subscribe("openducktor://run-event", (payload) => {
      payloads.push(payload);
    });

    unsubscribe();
    bus.publish("openducktor://run-event", { sessionId: "session-1" });

    expect(payloads).toEqual([]);
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
  test("keeps invalid publish channels as acceptance failures", () => {
    const bus = createBus();

    expect(() => bus.publish("openducktor://missing-event", {})).toThrow(
      "Unknown OpenDucktor host event channel: openducktor://missing-event",
    );
  });
  test("isolates listener failures and continues a snapshot delivery", () => {
    const failures: unknown[] = [];
    const bus = createHostEventBus({ report: ({ cause }) => failures.push(cause) });
    const received: unknown[] = [];
    bus.subscribe("openducktor://run-event", () => {
      throw new Error("listener failed");
    });
    bus.subscribe("openducktor://run-event", (payload) => received.push(payload));

    bus.publish("openducktor://run-event", { taskId: "task-1" });

    expect(received).toEqual([{ taskId: "task-1" }]);
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

    bus.publish("openducktor://run-event", {});

    expect(received).toEqual(["second", "first"]);
  });
});
