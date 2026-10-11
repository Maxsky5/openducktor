export type StrictBase64Failure = "too_large" | "malformed" | "padding";

export type StrictBase64Result =
  | { ok: true; bytes: Buffer }
  | { ok: false; reason: StrictBase64Failure };

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Validates padded, canonical base64 and builds the bytes only after every check passes.
 * Size and padding bits are checked before decoding. Native atob rejects other characters and misplaced padding.
 * A regex or JavaScript scan of each character blocks the host for about 290 ms for 32 MiB of file data.
 */
export const decodeStrictBase64 = (value: string, maxBytes: number): StrictBase64Result => {
  if (value.length > Math.ceil(maxBytes / 3) * 4) return { ok: false, reason: "too_large" };
  if (value.length === 0 || value.length % 4 !== 0) return { ok: false, reason: "malformed" };
  let padding = 0;
  if (value.endsWith("==")) padding = 2;
  else if (value.endsWith("=")) padding = 1;
  const byteLength = (value.length / 4) * 3 - padding;
  if (byteLength > maxBytes) return { ok: false, reason: "too_large" };
  // atob ignores the unused bits before the padding, so check that they are zero before decoding.
  if (padding > 0) {
    const tail = BASE64_ALPHABET.indexOf(value.charAt(value.length - padding - 1));
    if (tail < 0) return { ok: false, reason: "malformed" };
    if ((tail & (padding === 2 ? 15 : 3)) !== 0) return { ok: false, reason: "padding" };
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  // atob skips ASCII whitespace, so any skipped character shortens the output.
  if (binary.length !== byteLength) return { ok: false, reason: "malformed" };
  return { ok: true, bytes: Buffer.from(binary, "latin1") };
};
