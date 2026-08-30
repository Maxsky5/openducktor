import { describe, expect, test } from "bun:test";

describe("DiffWorkerProvider", () => {
  test("imports without evaluating the Pierre worker url module at load time", async () => {
    const module = await import("./DiffWorkerProvider");

    expect(module.DiffWorkerProvider).toBeInstanceOf(Function);
  }, 5000);
});
