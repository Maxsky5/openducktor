import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { Effect } from "effect";
import { createRendererClientCleanup } from "./electron-renderer-client-cleanup";

const setup = () => {
  const detached: number[] = [];
  const bind = createRendererClientCleanup({
    detachSender: (senderId) => Effect.sync(() => void detached.push(senderId)),
    reportFailure: () => {},
  });
  const sender = Object.assign(new EventEmitter(), { id: 7 });
  bind(sender);
  bind(sender);
  return { detached, sender };
};

describe("createRendererClientCleanup", () => {
  test("keeps the clients when a navigation starts but does not commit", async () => {
    const { detached, sender } = setup();

    sender.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    await Bun.sleep(0);

    expect(detached).toEqual([]);
  });

  test("ends the clients once for each new document and when the renderer ends", async () => {
    const { detached, sender } = setup();

    sender.emit("did-navigate");
    sender.emit("destroyed");
    await Bun.sleep(0);

    expect(detached).toEqual([7, 7]);
  });
});
