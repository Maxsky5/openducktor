import { describe, expect, test } from "bun:test";
import { createDeferred } from "@/test-utils/shared-test-fixtures";
import { createSessionStartGate } from "./session-start-gate";

describe("createSessionStartGate", () => {
  test("serializes queued and coalesced starts without merging their results", async () => {
    const gate = createSessionStartGate<string>();
    const queuedStartEntered = createDeferred<void>();
    const releaseQueuedStart = createDeferred<void>();
    let coalescedStartCount = 0;

    const queuedStart = gate.run(
      "autopilot-fresh",
      async () => {
        queuedStartEntered.resolve();
        await releaseQueuedStart.promise;
        return "queued";
      },
      "queue",
      "task-1-qa",
    );
    await queuedStartEntered.promise;

    const coalescedStart = gate.run(
      "manual-fresh",
      async () => {
        coalescedStartCount += 1;
        return "coalesced";
      },
      "coalesce",
      "task-1-qa",
    );
    await Promise.resolve();

    expect(coalescedStartCount).toBe(0);
    releaseQueuedStart.resolve();
    await expect(queuedStart).resolves.toBe("queued");
    await expect(coalescedStart).resolves.toBe("coalesced");
    expect(coalescedStartCount).toBe(1);
  });

  test("does not execute queued starts after clear", async () => {
    const gate = createSessionStartGate<string>();
    const firstStartEntered = createDeferred<void>();
    const releaseFirstStart = createDeferred<void>();
    const started: string[] = [];

    const firstStart = gate.run(
      "task-1",
      async () => {
        started.push("first");
        firstStartEntered.resolve();
        await releaseFirstStart.promise;
        return "first";
      },
      "queue",
    );
    await firstStartEntered.promise;
    const secondStart = gate.run(
      "task-1",
      async () => {
        started.push("second");
        return "second";
      },
      "queue",
    );

    gate.clear();
    releaseFirstStart.resolve();

    await expect(firstStart).resolves.toBe("first");
    await expect(secondStart).rejects.toThrow("Session start gate was cleared.");
    expect(started).toEqual(["first"]);
  });

  test("keeps each queued start result after an earlier rejection", async () => {
    const gate = createSessionStartGate<string>();

    const firstStart = gate.run(
      "task-1",
      async () => {
        throw new Error("first failed");
      },
      "queue",
    );
    const secondStart = gate.run("task-1", async () => "second", "queue");

    await expect(firstStart).rejects.toThrow("first failed");
    await expect(secondStart).resolves.toBe("second");
  });
});
