import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { createChromePipeConnection } from "./chrome-pipe-connection";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("createChromePipeConnection", () => {
  const pipes = () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const written: string[] = [];
    input.on("data", (chunk: Buffer) => written.push(chunk.toString("utf8")));
    return { input, output, written };
  };

  test("writes NUL-terminated commands and resolves them from NUL-terminated responses", async () => {
    const { input, output, written } = pipes();
    const connection = createChromePipeConnection({ input, output });
    const response = connection.request("Browser.getVersion", undefined, "");
    await Bun.sleep(0);
    expect(written).toEqual(['{"id":1,"method":"Browser.getVersion","params":{}}\0']);
    output.write(bytes('{"id":1,"result":{"product":"Chrome/155"}}\0'));
    expect(await response).toEqual({ product: "Chrome/155" });
  });

  test("joins a message that spans chunks, including a split UTF-8 character", async () => {
    const { input, output } = pipes();
    const connection = createChromePipeConnection({ input, output });
    const titles: unknown[] = [];
    connection.subscribe((event) => titles.push(event.params?.title));
    const encoded = bytes(
      '{"method":"Page.titleChanged","params":{"title":"Café ☕"}}\0{"method":"Page.titleChanged","params":{"title":"B"}}\0',
    );
    const split = encoded.indexOf(0xe2) + 1;
    output.write(encoded.subarray(0, split));
    output.write(encoded.subarray(split));
    await Bun.sleep(0);
    expect(titles).toEqual(["Café ☕", "B"]);
  });

  test("delivers events with their session ID", async () => {
    const { input, output } = pipes();
    const connection = createChromePipeConnection({ input, output });
    const events: string[] = [];
    connection.subscribe((event) => events.push(`${event.sessionId}:${event.method}`));
    output.write(bytes('{"method":"Target.targetCreated","params":{}}\0'));
    output.write(bytes('{"method":"Page.loadEventFired","params":{},"sessionId":"S1"}\0'));
    await Bun.sleep(0);
    expect(events).toEqual([":Target.targetCreated", "S1:Page.loadEventFired"]);
  });

  test("rejects pending commands when Chrome closes the pipe", async () => {
    const { input, output } = pipes();
    const connection = createChromePipeConnection({ input, output });
    const response = connection.request("Target.getTargets", undefined, "");
    output.destroy();
    await expect(response).rejects.toThrow("Chrome closed the DevTools pipe.");
    expect(connection.isClosed()).toBe(true);
  });

  test("closes the connection with a reason when Chrome sends a message it cannot read", async () => {
    const { input, output } = pipes();
    const connection = createChromePipeConnection({ input, output });
    const reasons: string[] = [];
    connection.onClose((reason) => reasons.push(reason));
    output.write(bytes("not json\0"));
    await Bun.sleep(0);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toStartWith("Chrome sent a DevTools message that OpenDucktor cannot read");
  });

  test("keeps the browser order of a reply and the events after it", async () => {
    const { input, output } = pipes();
    const connection = createChromePipeConnection({ input, output });
    const order: string[] = [];
    connection.subscribe((event) => order.push(event.method));
    const reply = connection
      .request("Page.getFrameTree", undefined, "page-session")
      .then(() => order.push("reply"));

    // One chunk holds the reply and then an event.
    output.write(
      bytes(
        '{"id":1,"result":{},"sessionId":"page-session"}\0{"method":"Runtime.executionContextCreated","params":{},"sessionId":"page-session"}\0',
      ),
    );
    await reply;
    await Bun.sleep(0);

    expect(order).toEqual(["reply", "Runtime.executionContextCreated"]);
  });

  test("closes the connection and the pipe to Chrome when an event listener throws", async () => {
    const { input, output } = pipes();
    const connection = createChromePipeConnection({ input, output });
    const reasons: string[] = [];
    connection.onClose((reason) => reasons.push(reason));
    connection.subscribe(() => {
      throw new Error("bad listener");
    });

    output.write(bytes('{"method":"Page.loadEventFired","params":{}}\0'));
    await Bun.sleep(0);

    expect(reasons).toEqual(["An event listener failed: bad listener"]);
    expect(input.writableEnded).toBe(true);
  });
});
