import type { CdpConnection, CdpPayload } from "@openducktor/host";
import { z } from "zod";

/** The JPEG quality of CDP when a request names none. */
const CDP_DEFAULT_JPEG_QUALITY = 80;

/** A rounded clip can pass the viewport edge by part of a pixel. */
const VIEWPORT_TOLERANCE = 1;

/** A box in pixels of an image. */
export type ElectronImageRect = { x: number; y: number; width: number; height: number };

/** The Electron `NativeImage` API of a screenshot. */
export type ElectronCapturedImage = {
  getSize(): { width: number; height: number };
  crop(rect: ElectronImageRect): ElectronCapturedImage;
  resize(options: { width: number; height: number; quality: "best" }): ElectronCapturedImage;
  toPNG(): Buffer;
  toJPEG(quality: number): Buffer;
};

/** Makes an image from PNG bytes, as `nativeImage.createFromBuffer` does. */
export type ElectronPngDecoder = (png: Buffer) => ElectronCapturedImage;

/** A `Page.captureScreenshot` request for a clip that a viewport screenshot can hold. */
const viewportClipRequestSchema = z.object({
  format: z.enum(["png", "jpeg"]).default("png"),
  quality: z.number().int().min(0).max(100).default(CDP_DEFAULT_JPEG_QUALITY),
  clip: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
    scale: z.number().positive(),
  }),
  captureBeyondViewport: z.literal(false).optional(),
});

const layoutMetricsSchema = z.object({
  /** The visual viewport in device pixels. */
  visualViewport: z.object({ clientWidth: z.number().positive() }),
  cssVisualViewport: z.object({
    pageX: z.number(),
    pageY: z.number(),
    clientWidth: z.number().positive(),
    clientHeight: z.number().positive(),
    /** The pinch zoom. */
    scale: z.number().positive(),
    /** The page zoom: device-independent pixels for each CSS pixel. */
    zoom: z.number().positive(),
  }),
});

const screenshotResultSchema = z.object({ data: z.string() });

type ViewportClip = z.infer<typeof viewportClipRequestSchema>["clip"];
type CssViewport = z.infer<typeof layoutMetricsSchema>["cssVisualViewport"];

/**
 * Runs CDP `Page.captureScreenshot` on a guest page. For a clip, Chromium draws the shown page at
 * the clip for one frame, and the user sees the page jump. So a PNG or JPEG clip inside the
 * viewport comes from a screenshot of the whole viewport, which Chromium takes as the page shows,
 * cut to the clip at the image size that CDP gives. A clip outside the viewport needs the page
 * drawn again, so CDP takes it.
 */
export const captureGuestScreenshot = async (
  connection: Pick<CdpConnection, "request">,
  decodePng: ElectronPngDecoder,
  params: CdpPayload,
): Promise<CdpPayload> => {
  const captureWithCdp = () => connection.request("Page.captureScreenshot", params, "");
  const request = viewportClipRequestSchema.safeParse(params);
  if (!request.success) {
    return captureWithCdp();
  }
  const metrics = layoutMetricsSchema.parse(
    await connection.request("Page.getLayoutMetrics", undefined, ""),
  );
  const viewport = metrics.cssVisualViewport;
  const { clip, format, quality } = request.data;
  if (!insideViewport(clip, viewport)) {
    return captureWithCdp();
  }
  const { data } = screenshotResultSchema.parse(
    await connection.request("Page.captureScreenshot", { format: "png" }, ""),
  );
  const image = decodePng(Buffer.from(data, "base64"));
  const devicePixelsPerCssPixel = metrics.visualViewport.clientWidth / viewport.clientWidth;
  const clipped = image.crop(imageRect(clip, viewport, devicePixelsPerCssPixel, image.getSize()));
  // Like CDP, the image has `clip.scale` times the device pixels of the clip at page zoom 1.
  const factor = clip.scale / (viewport.scale * viewport.zoom);
  const size = clipped.getSize();
  const scaled =
    factor === 1
      ? clipped
      : clipped.resize({
          width: Math.max(1, Math.round(size.width * factor)),
          height: Math.max(1, Math.round(size.height * factor)),
          quality: "best",
        });
  const encoded = format === "jpeg" ? scaled.toJPEG(quality) : scaled.toPNG();
  return { data: encoded.toString("base64") };
};

const insideViewport = (clip: ViewportClip, viewport: CssViewport): boolean =>
  clip.x >= viewport.pageX - VIEWPORT_TOLERANCE &&
  clip.y >= viewport.pageY - VIEWPORT_TOLERANCE &&
  clip.x + clip.width <= viewport.pageX + viewport.clientWidth + VIEWPORT_TOLERANCE &&
  clip.y + clip.height <= viewport.pageY + viewport.clientHeight + VIEWPORT_TOLERANCE;

/** The clip in whole pixels of the viewport screenshot, inside the image. */
const imageRect = (
  clip: ViewportClip,
  viewport: CssViewport,
  ratio: number,
  image: { width: number; height: number },
): ElectronImageRect => {
  const left = Math.max(0, Math.floor((clip.x - viewport.pageX) * ratio));
  const top = Math.max(0, Math.floor((clip.y - viewport.pageY) * ratio));
  const right = Math.min(image.width, Math.ceil((clip.x + clip.width - viewport.pageX) * ratio));
  const bottom = Math.min(image.height, Math.ceil((clip.y + clip.height - viewport.pageY) * ratio));
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
};
