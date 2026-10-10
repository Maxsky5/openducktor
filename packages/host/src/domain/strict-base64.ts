export type StrictBase64Failure = "too_large" | "malformed" | "padding";

export type StrictBase64Result =
  | { ok: true; bytes: Buffer }
  | { ok: false; reason: StrictBase64Failure };

const PADDED_BASE64_ALPHABET = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Decodes padded, canonical base64 with native Buffer code.
 * Buffer.from skips invalid characters, so the decoded bytes must encode back to the exact input.
 */
export const decodeStrictBase64 = (value: string, maxBytes: number): StrictBase64Result => {
  if (value.length > Math.ceil(maxBytes / 3) * 4) return { ok: false, reason: "too_large" };
  if (value.length === 0 || value.length % 4 !== 0) return { ok: false, reason: "malformed" };
  let padding = 0;
  if (value.endsWith("==")) padding = 2;
  else if (value.endsWith("=")) padding = 1;
  if ((value.length / 4) * 3 - padding > maxBytes) return { ok: false, reason: "too_large" };
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") === value) return { ok: true, bytes };
  // Input from the padded alphabet fails the round trip only when the unused tail bits are not zero.
  return { ok: false, reason: PADDED_BASE64_ALPHABET.test(value) ? "padding" : "malformed" };
};
