import { createHostEventBus } from "./host-event-bus";

describe("createHostEventBus", () => {
  test("publishes payloads to subscribers for a checked host channel", () => {
    const bus = createHostEventBus();
    const payloads: unknown[] = [];

    bus.subscribe("openducktor://task-event", (payload) => {
      payloads.push(payload);
    });

    bus.publish("openducktor://task-event", { taskId: "task-1" });

    expect(payloads).toEqual([{ taskId: "task-1" }]);
  });

  test("unsubscribes listeners without affecting later publications", () => {
    const bus = createHostEventBus();
    const payloads: unknown[] = [];
    const unsubscribe = bus.subscribe("openducktor://run-event", (payload) => {
      payloads.push(payload);
    });

    unsubscribe();
    bus.publish("openducktor://run-event", { sessionId: "session-1" });

    expect(payloads).toEqual([]);
  });

  test("rejects unknown event channels", () => {
    const bus = createHostEventBus();

    expect(() => {
      bus.subscribe("openducktor://missing-event", () => {});
    }).toThrow("Unknown OpenDucktor host event channel: openducktor://missing-event");
  });
});
