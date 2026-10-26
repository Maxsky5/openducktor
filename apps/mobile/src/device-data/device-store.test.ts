import { describe, expect, test } from "bun:test";
import { createTextSegment } from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { createMemoryDeviceStore } from "../test-support/memory-device-store";
import { createDeviceClientStorage } from "./device-store";

const keys = (storage: ReturnType<typeof createDeviceClientStorage>) =>
  Array.from({ length: storage.length }, (_, index) => storage.key(index));

describe("device client storage", () => {
  test("lists the keys of its store in sorted order and follows each write", () => {
    const storage = createDeviceClientStorage(createMemoryDeviceStore({ b: "2", a: "1" }));
    expect(keys(storage)).toEqual(["a", "b"]);

    storage.setItem("c", "3");
    expect(keys(storage)).toEqual(["a", "b", "c"]);

    storage.removeItem("a");
    expect(keys(storage)).toEqual(["b", "c"]);
    expect(storage.key(2)).toBeNull();
    expect(storage.getItem("a")).toBeNull();
    expect(storage.getItem("c")).toBe("3");
  });

  test("a chat draft saved through one connection loads in the next one on the same store", async () => {
    const store = createMemoryDeviceStore();
    const identity = { workspaceId: "workspace-1", workspaceSessionId: "chat-1" };
    const draft = { segments: [createTextSegment("Unsent message", "text-1")], attachments: [] };
    const first = createTestClientConnection({
      storage: createDeviceClientStorage(store),
      scheduleTask: () => () => {},
    });
    first.drafts.chat.set(identity, null, draft);
    await first.saveDrafts();
    await first.dispose();

    const next = createTestClientConnection({
      storage: createDeviceClientStorage(store),
      scheduleTask: () => () => {},
    });
    expect(next.drafts.chat.hydrate(identity, null)).toEqual(draft);
    await next.dispose();
  });
});
