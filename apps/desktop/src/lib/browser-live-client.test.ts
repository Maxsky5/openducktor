import { describe, expect, test } from "bun:test";
import { readBrowserLiveErrorMessage } from "./browser-live-client";

describe("readBrowserLiveErrorMessage", () => {
  test("preserves plain-text backend error bodies", async () => {
    const response = new Response("Plain backend error", {
      status: 500,
      headers: { "content-type": "text/plain" },
    });

    await expect(readBrowserLiveErrorMessage(response)).resolves.toBe("Plain backend error");
  });

  test("returns the structured error field from JSON bodies", async () => {
    const response = new Response(JSON.stringify({ error: "Structured backend error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });

    await expect(readBrowserLiveErrorMessage(response)).resolves.toBe("Structured backend error");
  });

  test("falls back to the status message when the body is empty", async () => {
    const response = new Response("", {
      status: 502,
      headers: { "content-type": "text/plain" },
    });

    await expect(readBrowserLiveErrorMessage(response)).resolves.toBe(
      "Browser backend request failed with status 502.",
    );
  });
});
