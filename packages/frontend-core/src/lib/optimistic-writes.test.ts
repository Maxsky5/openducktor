import { describe, expect, test } from "bun:test";
import { createOptimisticWrites } from "./optimistic-writes";

const setup = (saved: string) => {
  const shown: string[] = [];
  let idle = 0;
  const writes = createOptimisticWrites<string>({
    show: (value) => shown.push(value),
    readConfirmed: () => saved,
    onIdle: () => {
      idle += 1;
    },
  });
  return { writes, shown, idleCount: () => idle };
};

describe("createOptimisticWrites", () => {
  test("shows each value at once and saves the values in order", async () => {
    const { writes, shown } = setup("x");
    const first = Promise.withResolvers<string>();
    const saves: string[] = [];
    const a = writes.write("a", () => {
      saves.push("a");
      return first.promise;
    });
    const b = writes.write("b", async () => {
      saves.push("b");
      return "b";
    });
    expect(shown).toEqual(["a", "b"]);
    await Bun.sleep(0);
    // The second save waits for the first one.
    expect(saves).toEqual(["a"]);
    first.resolve("a");
    await Promise.all([a, b]);
    expect(saves).toEqual(["a", "b"]);
    expect(shown).toEqual(["a", "b"]);
  });

  test("shows the saved value again when the last two writes fail", async () => {
    const { writes, shown } = setup("x");
    const results = await Promise.allSettled([
      writes.write("a", async () => Promise.reject(new Error("offline"))),
      writes.write("b", async () => Promise.reject(new Error("offline"))),
    ]);
    expect(results.map(({ status }) => status)).toEqual(["rejected", "rejected"]);
    expect(shown).toEqual(["a", "b", "x"]);
  });

  test("keeps a later value when an earlier write fails", async () => {
    const { writes, shown } = setup("x");
    const a = writes.write("a", async () => Promise.reject(new Error("offline")));
    const b = writes.write("b", async () => "b");
    await expect(a).rejects.toThrow("offline");
    await b;
    expect(shown).toEqual(["a", "b"]);
  });

  test("shows the last confirmed value when the newest write fails", async () => {
    const { writes, shown } = setup("x");
    const a = writes.write("a", async () => "a");
    const b = writes.write("b", async () => Promise.reject(new Error("offline")));
    await a;
    await expect(b).rejects.toThrow("offline");
    expect(shown).toEqual(["a", "b", "a"]);
  });

  test("shows the saved value when it differs from the shown value", async () => {
    const { writes, shown } = setup("x");
    await writes.write("a", async () => "a (saved)");
    expect(shown).toEqual(["a", "a (saved)"]);
  });

  test("settles with the newest write and reports idle", async () => {
    const { writes, idleCount } = setup("x");
    expect(writes.settled()).toBeNull();
    const pending = Promise.withResolvers<string>();
    const a = writes.write("a", () => pending.promise);
    const settled = writes.settled();
    expect(settled).not.toBeNull();
    pending.reject(new Error("offline"));
    const results = await Promise.allSettled([settled, a]);
    expect(results.map(({ status }) => status)).toEqual(["rejected", "rejected"]);
    expect(writes.settled()).toBeNull();
    expect(idleCount()).toBe(1);
  });
});
