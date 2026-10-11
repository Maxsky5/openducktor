export type StrictBase64Failure = "too_large" | "malformed" | "padding";

export type StrictBase64Result =
  | { ok: true; bytes: Buffer }
  | { ok: false; reason: StrictBase64Failure };

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Validates padded, canonical base64 before it builds the bytes.
 * Native atob rejects characters outside the alphabet and misplaced padding.
 * A JavaScript or regex loop over each character blocks the host for hundreds of milliseconds at 32 MiB.
 */
export const decodeStrictBase64 = (value: string, maxBytes: number): StrictBase64Result => {
  if (value.length > Math.ceil(maxBytes / 3) * 4) return { ok: false, reason: "too_large" };
  if (value.length === 0 || value.length % 4 !== 0) return { ok: false, reason: "malformed" };
  let padding = 0;
  if (value.endsWith("==")) padding = 2;
  else if (value.endsWith("=")) padding = 1;
  const byteLength = (value.length / 4) * 3 - padding;
  if (byteLength > maxBytes) return { ok: false, reason: "too_large" };
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  // atob skips ASCII whitespace, so any skipped character shortens the output.
  if (binary.length !== byteLength) return { ok: false, reason: "malformed" };
  // atob ignores the unused bits before the padding, so canonical input must keep them zero.
  const tail = BASE64_ALPHABET.indexOf(value.charAt(value.length - padding - 1));
  if ((padding === 2 && (tail & 15) !== 0) || (padding === 1 && (tail & 3) !== 0)) {
    return { ok: false, reason: "padding" };
  }
  return { ok: true, bytes: Buffer.from(binary, "latin1") };
};
