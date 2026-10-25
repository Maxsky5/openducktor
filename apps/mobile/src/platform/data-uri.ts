/** The content of a `data:` URI: base64 bytes, or percent-encoded text. */
export type DataUriContent =
  | { mediaType: string; base64: string }
  | { mediaType: string; text: string };

const DATA_URI = /^data:([^;,]*)((?:;[^;,]*)*),([\s\S]*)$/u;

/**
 * Reads a `data:` URI, as RFC 2397 defines it. A URI without a media type has `text/plain`. A URI
 * that is not a data URI, or whose text is not valid percent encoding, gives null.
 */
export const readDataUri = (uri: string): DataUriContent | null => {
  const match = DATA_URI.exec(uri);
  if (!match) return null;
  const mediaType = match[1] || "text/plain";
  const parameters = (match[2] ?? "").split(";").filter((part) => part.length > 0);
  const data = match[3] ?? "";
  if (parameters.includes("base64")) return { mediaType, base64: data };
  try {
    return { mediaType, text: decodeURIComponent(data) };
  } catch {
    return null;
  }
};
