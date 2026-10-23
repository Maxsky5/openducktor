import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

const MAX_SVG_BYTES = 10 * 1024 * 1024;
const MAX_SVG_DEPTH = 8;
const MAX_SVG_ELEMENTS = 50_000;
const RASTER_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Check embedded images before resvg decodes them into WASM memory. */
export const prepareSvg = async (content: Uint8Array, maxPixels: number): Promise<string> => {
  const budget = { bytes: 0, elements: 0, pixels: 0 };
  const walk = async (bytes: Uint8Array, depth: number): Promise<string> => {
    budget.bytes += bytes.byteLength;
    if (depth > MAX_SVG_DEPTH || budget.bytes > MAX_SVG_BYTES)
      throw new Error("The SVG embedded content exceeds the preview limits.");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const document = new DOMParser({
      errorHandler: { warning: rejectXml, error: rejectXml, fatalError: rejectXml },
    }).parseFromString(text, "image/svg+xml");
    if (document.doctype || document.documentElement?.localName !== "svg") rejectXml();
    const elements = document.getElementsByTagName("*");
    budget.elements += elements.length;
    if (budget.elements > MAX_SVG_ELEMENTS)
      throw new Error("The SVG has too many elements to preview.");
    for (let index = 0; index < elements.length; index++) {
      const element = elements.item(index);
      if (!element || (element.localName !== "image" && element.localName !== "feImage")) continue;
      for (let attributeIndex = 0; attributeIndex < element.attributes.length; attributeIndex++) {
        const attribute = element.attributes.item(attributeIndex);
        if (!attribute || attribute.localName !== "href") continue;
        const href = attribute.value.trim();
        if (!href.toLowerCase().startsWith("data:")) continue;
        const url = new URL(href);
        if (url.protocol !== "data:") throw new Error("The embedded image URL is invalid.");
        // Fetch decodes data URLs and percent escapes without reading files or using the network.
        const response = await fetch(url);
        const mediaType = response.headers.get("content-type")?.split(";")[0]?.toLowerCase();
        const embedded = new Uint8Array(await response.arrayBuffer());
        if (mediaType === "image/svg+xml") {
          const nested = await walk(embedded, depth + 1);
          attribute.value = `data:image/svg+xml;base64,${Buffer.from(nested).toString("base64")}`;
          continue;
        }
        budget.bytes += embedded.byteLength;
        if (budget.bytes > MAX_SVG_BYTES || !mediaType || !RASTER_TYPES.has(mediaType))
          throw new Error("The SVG contains an unsupported or oversized embedded image.");
        const detected = await fileTypeFromBuffer(embedded);
        if (detected?.mime !== mediaType)
          throw new Error("The embedded image does not match its declared format.");
        const metadata = await sharp(Buffer.from(embedded), {
          limitInputPixels: maxPixels,
          failOn: "warning",
          animated: true,
        }).metadata();
        const width = metadata.width;
        const height = metadata.pageHeight ?? metadata.height;
        const pages = metadata.pages ?? 1;
        if (!width || !height || pages > 200)
          throw new Error(
            "The embedded image dimensions or frame count exceed the preview limits.",
          );
        budget.pixels += width * height * pages;
        if (budget.pixels > maxPixels)
          throw new Error("The SVG embedded images exceed the preview pixel limit.");
        // Re-encode checked bytes so resvg reads the same data we checked.
        attribute.value = `data:${mediaType};base64,${Buffer.from(embedded).toString("base64")}`;
      }
    }
    return new XMLSerializer().serializeToString(document, false, undefined, {
      requireWellFormed: true,
    });
  };
  return walk(content, 0);
};

const rejectXml = () => {
  throw new Error("The SVG must contain valid XML without entity declarations.");
};
