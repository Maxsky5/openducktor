import { describe, expect, test } from "bun:test";
import { decodeBrowserClientMessage } from "@openducktor/contracts";
import type { BrowserChannelConnection, WebviewBrowserBridge } from "@/lib/shell-bridge";
import { createBrowserChannel } from "./browser-channel";

/** A bridge whose connects settle when the test resolves them. */
const createBridgeFixture = () => {
  const pending: Array<{ connect: () => void; drop: () => void; closed: () => boolean }> = [];
  const sent: Uint8Array[] = [];
  const bridge: Pick<WebviewBrowserBridge, "connect"> = {
    // Like the real bridge, `connected` comes before `connect` returns the connection.
    connect: (_onMessage, onStateChange) =>
      new Promise<BrowserChannelConnection>((resolve) => {
        let closed = false;
        const connection: BrowserChannelConnection = {
          send: async (message) => {
            sent.push(message);
          },
          close: () => {
            closed = true;
          },
        };
        pending.push({
          connect: () => {
            onStateChange("connected");
            resolve(connection);
          },
          drop: () => {
            onStateChange("connected");
            onStateChange("disconnected");
            resolve(connection);
          },
          closed: () => closed,
        });
      }),
  };
  return { bridge, pending, sent };
};

const TAB_ID = "00000000-0000-4000-8000-000000000001";

describe("createBrowserChannel", () => {
  test("connects again after a stop during a connect, like a remounted provider", async () => {
    const { bridge, pending } = createBridgeFixture();
    const channel = createBrowserChannel(bridge);

    const first = channel.connect();
    await channel.stop();
    const second = channel.connect();
    pending[0]?.connect();
    pending[1]?.connect();
    await Promise.all([first, second]);

    expect(channel.status()).toBe("connected");
    expect(pending[0]?.closed()).toBe(true);
    expect(pending[1]?.closed()).toBe(false);
  });

  test("a status listener can send at once when the channel says that it is connected", async () => {
    const { bridge, pending, sent } = createBridgeFixture();
    const channel = createBrowserChannel(bridge);
    channel.onStatus(() => {
      if (channel.status() === "connected") {
        channel.send({ type: "anchors", tabId: TAB_ID, anchors: [] });
      }
    });

    const connecting = channel.connect();
    pending[0]?.connect();
    await connecting;

    expect(sent.map((message) => decodeBrowserClientMessage(message).type)).toEqual(["anchors"]);
  });

  test("connects again when the connection drops before it opens", async () => {
    const { bridge, pending } = createBridgeFixture();
    const channel = createBrowserChannel(bridge);

    const connecting = channel.connect();
    pending[0]?.drop();
    await connecting;
    expect(channel.status()).not.toBe("connected");
    await new Promise((resolve) => setTimeout(resolve, 0));
    pending[1]?.connect();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pending).toHaveLength(2);
    expect(channel.status()).toBe("connected");
  });

  test("stays disconnected after a stop", async () => {
    const { bridge, pending } = createBridgeFixture();
    const channel = createBrowserChannel(bridge);

    const connecting = channel.connect();
    pending[0]?.connect();
    await connecting;
    await channel.stop();

    expect(channel.status()).toBe("disconnected");
    expect(pending[0]?.closed()).toBe(true);
  });
});
