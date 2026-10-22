import { describe, expect, test } from "bun:test";
import { browserFrameMessageSchema, isBrowserFrameUrl } from "./browser-frame-protocol";

describe("browser frame protocol", () => {
  test("a frame shows only http and https pages of the host itself", () => {
    expect(isBrowserFrameUrl("http://localhost:3000/app")).toBe(true);
    expect(isBrowserFrameUrl("https://app.localhost/")).toBe(true);
    expect(isBrowserFrameUrl("http://127.0.0.1:5173/")).toBe(true);
    expect(isBrowserFrameUrl("http://[::1]:8080/")).toBe(true);
    expect(isBrowserFrameUrl("http://192.168.1.5:3000/")).toBe(false);
    expect(isBrowserFrameUrl("https://example.com/")).toBe(false);
    expect(isBrowserFrameUrl("about:blank")).toBe(false);
  });

  test("takes only marked messages of a known type", () => {
    expect(
      browserFrameMessageSchema.safeParse({
        openducktorFrame: 1,
        type: "leave",
        url: "https://accounts.example.com/",
      }).success,
    ).toBe(true);
    expect(browserFrameMessageSchema.safeParse({ type: "leave", url: "x" }).success).toBe(false);
    expect(
      browserFrameMessageSchema.safeParse({ openducktorFrame: 1, type: "navigate", url: "x" })
        .success,
    ).toBe(false);
  });
});
