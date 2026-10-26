/**
 * Base64 for terminal bytes between the app and the terminal page. Terminal output is not always
 * valid UTF-8, because a frame can end inside a character, so the bytes cross the page bridge as
 * base64. This module has no React Native import, so the page bundles it.
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const CODES = new Map(Array.from(ALPHABET, (character, index) => [character, index]));
// Build the text in parts, so a large frame does not create one string per byte.
const PART_BYTES = 3 * 4096;

export const encodeBase64 = (bytes: Uint8Array): string => {
  const parts: string[] = [];
  for (let partStart = 0; partStart < bytes.length; partStart += PART_BYTES) {
    const partEnd = Math.min(bytes.length, partStart + PART_BYTES);
    let part = "";
    for (let index = partStart; index < partEnd; index += 3) {
      const first = bytes[index] ?? 0;
      const second = bytes[index + 1];
      const third = bytes[index + 2];
      const triple = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
      part += ALPHABET[(triple >> 18) & 63];
      part += ALPHABET[(triple >> 12) & 63];
      part += second === undefined ? "=" : ALPHABET[(triple >> 6) & 63];
      part += third === undefined ? "=" : ALPHABET[triple & 63];
    }
    parts.push(part);
  }
  return parts.join("");
};

export const decodeBase64 = (text: string): Uint8Array => {
  if (text.length % 4 !== 0) throw new Error("The terminal bytes are not valid base64.");
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array((text.length / 4) * 3 - padding);
  let byteIndex = 0;
  for (let index = 0; index < text.length; index += 4) {
    let triple = 0;
    for (let offset = 0; offset < 4; offset += 1) {
      const character = text[index + offset] ?? "";
      const code = character === "=" ? 0 : CODES.get(character);
      if (code === undefined) throw new Error("The terminal bytes are not valid base64.");
      triple = (triple << 6) | code;
    }
    if (byteIndex < bytes.length) bytes[byteIndex++] = (triple >> 16) & 255;
    if (byteIndex < bytes.length) bytes[byteIndex++] = (triple >> 8) & 255;
    if (byteIndex < bytes.length) bytes[byteIndex++] = triple & 255;
  }
  return bytes;
};
