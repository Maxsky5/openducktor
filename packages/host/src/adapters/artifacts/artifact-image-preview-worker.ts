import { readFile } from "node:fs/promises";
import { parentPort } from "node:worker_threads";
import {
  TASK_ARTIFACT_MAX_FILE_BYTES,
  TASK_ARTIFACT_MAX_PREVIEW_BYTES,
  type ArtifactImagePreview,
} from "@openducktor/contracts";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import type { ArtifactImagePreviewInput } from "../../ports/artifact-image-preview-port";
import previewFont from "./artifact-preview-font.json";
import { prepareSvg } from "./artifact-svg-preflight";

const MAX_INPUT_PIXELS = 16 * 1024 * 1024;
const MAX_PREVIEW_DIMENSION = 4096;
const CONVERTED_DIMENSION = 1024;
const RASTER_FORMATS = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpeg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

sharp.cache(false);
sharp.concurrency(1);

/** Decode raster pixels before returning their bytes; metadata cannot prove that every frame is valid. */
const makePreview = async (input: ArtifactImagePreviewInput): Promise<ArtifactImagePreview> => {
  const { content } = input;
  const mediaType = input.mediaType.toLowerCase();
  if (content.byteLength > TASK_ARTIFACT_MAX_FILE_BYTES)
    throw new Error("The image exceeds the input limit.");
  if (mediaType === "image/svg+xml") return renderSvg(content);
  const detected = await fileTypeFromBuffer(content);
  const format = RASTER_FORMATS.get(mediaType);
  if (!format || detected?.mime !== mediaType)
    throw new Error("The image does not match its declared format.");
  const image = sharp(Buffer.from(content), {
    limitInputPixels: MAX_INPUT_PIXELS,
    failOn: "warning",
    animated: true,
  }).timeout({ seconds: 8 });
  const metadata = await image.metadata();
  const width = metadata.width;
  const height = metadata.pageHeight ?? metadata.height;
  const pages = metadata.pages ?? 1;
  if (
    metadata.format !== format ||
    !width ||
    !height ||
    width * height * pages > MAX_INPUT_PIXELS ||
    pages > 200
  )
    throw new Error("The image dimensions or frame count exceed the preview limits.");
  if (
    content.byteLength <= TASK_ARTIFACT_MAX_PREVIEW_BYTES &&
    width <= MAX_PREVIEW_DIMENSION &&
    height <= MAX_PREVIEW_DIMENSION
  ) {
    await image.raw().toBuffer();
    if (
      mediaType !== "image/png" &&
      mediaType !== "image/jpeg" &&
      mediaType !== "image/webp" &&
      mediaType !== "image/gif"
    )
      throw new Error("The raster format is unsupported.");
    return ready(content, mediaType, width, height);
  }
  const { data, info } = await image
    .resize({
      width: CONVERTED_DIMENSION,
      height: CONVERTED_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 75, effort: 0 })
    .toBuffer({ resolveWithObject: true });
  return ready(data, "image/webp", info.width, info.pageHeight ?? info.height);
};

const ready = (
  bytes: Uint8Array,
  mediaType: Extract<ArtifactImagePreview, { state: "ready" }>["mediaType"],
  width: number,
  height: number,
): ArtifactImagePreview => {
  if (bytes.byteLength > TASK_ARTIFACT_MAX_PREVIEW_BYTES)
    throw new Error("The converted image exceeds the 2 MiB preview limit.");
  return {
    state: "ready",
    mediaType,
    dataBase64: Buffer.from(bytes).toString("base64"),
    byteSize: bytes.byteLength,
    width,
    height,
  };
};

const renderSvg = async (content: Uint8Array): Promise<ArtifactImagePreview> => {
  const svg = await prepareSvg(content, MAX_INPUT_PIXELS);
  // Read only this fixed package asset. WASM cannot read files or use the network.
  await initWasm(await readFile(new URL(import.meta.resolve("@resvg/resvg-wasm/index_bg.wasm"))));
  const options = {
    font: {
      fontBuffers: [Buffer.from(previewFont.dataBase64, "base64")],
      defaultFontFamily: previewFont.family,
      sansSerifFamily: previewFont.family,
      serifFamily: previewFont.family,
      monospaceFamily: previewFont.family,
    },
  };
  const source = new Resvg(svg, options);
  let renderer = source;
  try {
    if (
      !Number.isFinite(source.width) ||
      !Number.isFinite(source.height) ||
      source.width <= 0 ||
      source.height <= 0
    )
      throw new Error("The SVG has invalid dimensions.");
    const largest = Math.max(source.width, source.height);
    if (largest > CONVERTED_DIMENSION)
      renderer = new Resvg(svg, {
        ...options,
        fitTo: { mode: "zoom", value: CONVERTED_DIMENSION / largest },
      });
    // Leave external images unloaded. resvg cannot run scripts.
    const image = renderer.render();
    try {
      return ready(image.asPng(), "image/png", image.width, image.height);
    } finally {
      image.free();
    }
  } finally {
    if (renderer !== source) renderer.free();
    source.free();
  }
};

if (!parentPort) throw new Error("The artifact preview entrypoint requires a worker thread.");
const port = parentPort;
port.once("message", async (input: ArtifactImagePreviewInput) => {
  try {
    port.postMessage(await makePreview(input));
  } catch {
    port.postMessage({
      state: "failed",
      message: "The image could not be decoded within the preview size and format limits.",
      nextAction: "Download the original artifact or replace it with a smaller valid image.",
    } satisfies ArtifactImagePreview);
  }
});
