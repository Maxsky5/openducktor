import { describe, expect, test } from "bun:test";
import { settleWithLimit } from "./settle-with-limit";

describe("settleWithLimit", () => {
  test("runs at most the limit at a time and keeps each result in item order", async () => {
    let running = 0;
    let mostRunning = 0;
    const results = await settleWithLimit([1, 2, 3, 4, 5], 2, async (item) => {
      running += 1;
      mostRunning = Math.max(mostRunning, running);
      await new Promise((resolve) => setTimeout(resolve, item === 1 ? 5 : 1));
      running -= 1;
      if (item === 3) throw new Error("item 3 failed");
      return item * 10;
    });

    expect(mostRunning).toBe(2);
    expect(
      results.map((result) => (result.status === "fulfilled" ? result.value : "failed")),
    ).toEqual([10, 20, "failed", 40, 50]);
  });
});
