import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { BrowserFrameSource } from "@openducktor/contracts";
import { configureBrowserRuntimeConfig } from "../browser-config";
import { createFetchFixture } from "../test-support";
import { createBrowserFrameBridge } from "./browser-tab-bridge";

const originalFetch = globalThis.fetch;
const LOCAL_APP = { protocol: "http:", hostname: "localhost" };

/** A host that answers each frame source request with the next answer. */
const answerFrameSources = (...answers: Array<BrowserFrameSource | { status: number }>) => {
  const fetchMock = mock(async (url: string | URL | Request, _init?: RequestInit) => {
    if (url.toString().endsWith("/session")) return new Response(null, { status: 204 });
    const answer = answers.shift();
    if (!answer) throw new Error("No frame source answer is left.");
    return "status" in answer
      ? new Response(JSON.stringify({ error: "Down.", message: "Down." }), {
          status: answer.status,
        })
      : new Response(JSON.stringify(answer));
  });
  globalThis.fetch = createFetchFixture(fetchMock);
  const targets = () =>
    fetchMock.mock.calls
      .filter(([url]) => url.toString().endsWith("/browser/frame-source"))
      .map(([, init]) => JSON.parse(String(init?.body)).target);
  return { fetchMock, targets };
};

beforeEach(() => {
  configureBrowserRuntimeConfig({
    backendUrl: "http://127.0.0.1:14327/api",
    appToken: "app-token",
  });
});

afterEach(() => {
  configureBrowserRuntimeConfig({});
  globalThis.fetch = originalFetch;
});

describe("createBrowserFrameBridge", () => {
  test("shows user tabs in frames only for an http app on the host machine", () => {
    expect(createBrowserFrameBridge(LOCAL_APP)).not.toBeNull();
    expect(createBrowserFrameBridge({ protocol: "http:", hostname: "127.0.0.1" })).not.toBeNull();
    expect(createBrowserFrameBridge({ protocol: "http:", hostname: "192.168.1.5" })).toBeNull();
    expect(createBrowserFrameBridge({ protocol: "https:", hostname: "localhost" })).toBeNull();
  });

  test("shows no frames for a loopback name that previews do not serve", () => {
    expect(createBrowserFrameBridge({ protocol: "http:", hostname: "[::1]" })).not.toBeNull();
    expect(createBrowserFrameBridge({ protocol: "http:", hostname: "dev.localhost" })).toBeNull();
    expect(createBrowserFrameBridge({ protocol: "http:", hostname: "127.0.0.2" })).toBeNull();
  });

  test("asks the host once for the preview of each dev server, with the app token", async () => {
    const preview = { kind: "preview", origin: "http://localhost:61000" } as const;
    const { fetchMock, targets } = answerFrameSources(preview);
    const frames = createBrowserFrameBridge(LOCAL_APP);
    if (!frames) throw new Error("Expected frame support.");

    expect(await frames.source("http://localhost:3000/a")).toEqual(preview);
    expect(await frames.source("http://localhost:3000/b?x=1")).toEqual(preview);

    expect(targets()).toEqual(["http://localhost:3000"]);
    const init = fetchMock.mock.calls.at(-1)?.[1];
    expect(new Headers(init?.headers).get("x-openducktor-app-token")).toBe("app-token");
  });

  test("asks again for each page of another site, and after a failed preview", async () => {
    const { targets } = answerFrameSources(
      { kind: "direct" },
      { kind: "refused", message: "github.com refuses frames." },
      { status: 502 },
      { kind: "preview", origin: "http://localhost:61000" },
    );
    const frames = createBrowserFrameBridge(LOCAL_APP);
    if (!frames) throw new Error("Expected frame support.");

    expect(await frames.source("https://example.com/")).toEqual({ kind: "direct" });
    expect((await frames.source("https://github.com/")).kind).toBe("refused");
    await expect(frames.source("http://localhost:3000/")).rejects.toThrow("Down.");
    expect((await frames.source("http://localhost:3000/")).kind).toBe("preview");

    expect(targets()).toEqual([
      "https://example.com/",
      "https://github.com/",
      "http://localhost:3000",
      "http://localhost:3000",
    ]);
  });
});
