import { describe, expect, test } from "bun:test";
import { createHostBridge } from "./host-client";

describe("host-client", () => {
  test("fails fast when run-event subscriptions are unavailable in the current runtime", async () => {
    await expect(createHostBridge().subscribeRunEvents(() => {})).rejects.toThrow(
      "Run-event subscriptions require the desktop shell or browser live mode.",
    );
  });

  test("fails fast when dev-server event subscriptions are unavailable in the current runtime", async () => {
    await expect(createHostBridge().subscribeDevServerEvents(() => {})).rejects.toThrow(
      "Dev-server event subscriptions require the desktop shell or browser live mode.",
    );
  });
});
