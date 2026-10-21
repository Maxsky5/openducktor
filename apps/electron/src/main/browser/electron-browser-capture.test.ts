import { describe, expect, test } from "bun:test";
import type { CdpPayload } from "@openducktor/host";
import {
  captureGuestScreenshot,
  type ElectronCapturedImage,
  type ElectronImageRect,
} from "./electron-browser-capture";

/** An image whose encodings name the format, the quality, the crop, and the size. */
class FakeImage implements ElectronCapturedImage {
  constructor(
    private readonly size: { width: number; height: number },
    private readonly crops: ElectronImageRect[] = [],
  ) {}

  getSize(): { width: number; height: number } {
    return this.size;
  }

  crop(rect: ElectronImageRect): FakeImage {
    return new FakeImage({ width: rect.width, height: rect.height }, [...this.crops, rect]);
  }

  resize(options: { width: number; height: number }): FakeImage {
    return new FakeImage({ width: options.width, height: options.height }, this.crops);
  }

  toPNG(): Buffer {
    return Buffer.from(`png ${this.describe()}`);
  }

  toJPEG(quality: number): Buffer {
    return Buffer.from(`jpeg ${quality} ${this.describe()}`);
  }

  private describe(): string {
    const crops = this.crops.map((rect) => `${rect.x},${rect.y},${rect.width},${rect.height}`);
    return `crop ${crops.join(" ")} size ${this.size.width}x${this.size.height}`;
  }
}

/**
 * A root page connection with a viewport scrolled to (0, 300), 390 by 800 CSS pixels, at two
 * device pixels for each CSS pixel. Its viewport screenshot is 780 by 1600 pixels.
 */
const fakeConnection = (viewport: Partial<Record<string, number>> = {}) => {
  const sent: Array<{ method: string; params: CdpPayload | undefined }> = [];
  const css = {
    pageX: 0,
    pageY: 300,
    clientWidth: 390,
    clientHeight: 800,
    scale: 1,
    zoom: 1,
    ...viewport,
  };
  return {
    sent,
    request(method: string, params: CdpPayload | undefined, sessionId: string) {
      expect(sessionId).toBe("");
      sent.push({ method, params });
      if (method === "Page.getLayoutMetrics") {
        return Promise.resolve({
          visualViewport: { clientWidth: css.clientWidth * 2 },
          cssVisualViewport: css,
        });
      }
      return Promise.resolve({ data: params?.clip ? "CDP clip" : "VIEWPORT" });
    },
  };
};

const decodePng = (png: Buffer): FakeImage => {
  expect(png.toString("base64")).toBe("VIEWPORT");
  return new FakeImage({ width: 780, height: 1600 });
};

const decode = (result: CdpPayload): string =>
  Buffer.from(String(result.data), "base64").toString();

describe("captureGuestScreenshot", () => {
  test("cuts a clip in the viewport from a viewport screenshot, which does not move the page", async () => {
    const connection = fakeConnection();

    const result = await captureGuestScreenshot(connection, decodePng, {
      format: "png",
      clip: { x: 10.5, y: 340.25, width: 100, height: 50, scale: 1 },
    });

    expect(decode(result)).toBe("png crop 21,80,200,101 size 200x101");
    expect(connection.sent).toEqual([
      { method: "Page.getLayoutMetrics", params: undefined },
      { method: "Page.captureScreenshot", params: { format: "png" } },
    ]);
  });

  test("scales the image as CDP does, for example to CSS pixels for Playwright", async () => {
    const result = await captureGuestScreenshot(fakeConnection(), decodePng, {
      format: "jpeg",
      quality: 60,
      clip: { x: 0, y: 300, width: 390, height: 800, scale: 0.5 },
    });

    expect(decode(result)).toBe("jpeg 60 crop 0,0,780,1600 size 390x800");
  });

  test("keeps the crop inside the image", async () => {
    const result = await captureGuestScreenshot(fakeConnection(), decodePng, {
      clip: { x: 300, y: 1000, width: 90.5, height: 100.5, scale: 1 },
    });

    expect(decode(result)).toBe("png crop 600,1400,180,200 size 180x200");
  });

  test("leaves other screenshots to CDP", async () => {
    const requests: CdpPayload[] = [
      { format: "png" },
      { format: "webp", clip: { x: 0, y: 300, width: 10, height: 10, scale: 1 } },
      { captureBeyondViewport: true, clip: { x: 0, y: 300, width: 10, height: 10, scale: 1 } },
      { clip: { x: 0, y: 0, width: 100, height: 100, scale: 1 } },
    ];

    for (const params of requests) {
      const connection = fakeConnection();
      const result = await captureGuestScreenshot(connection, decodePng, params);
      expect(connection.sent.at(-1)).toEqual({ method: "Page.captureScreenshot", params });
      expect(result.data).toBe(params.clip ? "CDP clip" : "VIEWPORT");
    }
  });
});
