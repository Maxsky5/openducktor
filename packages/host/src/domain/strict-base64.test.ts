import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { decodeStrictBase64 } from "./strict-base64";

const LIMIT = 1024;

describe("decodeStrictBase64", () => {
  test("returns the exact bytes for every padding length", () => {
    for (const size of [1, 2, 3, 4, 5, 6, 1023, LIMIT]) {
      const bytes = randomBytes(size);
      const decoded = decodeStrictBase64(bytes.toString("base64"), LIMIT);
      expect(decoded.ok).toBe(true);
      if (decoded.ok) expect(decoded.bytes.equals(bytes)).toBe(true);
    }
  });

  test("rejects malformed characters, lengths, and padding positions", () => {
    for (const value of [
      "",
      "AAA",
      "AAAAA",
      "AA!A",
      "AA-_",
      "AA A",
      "AAAA\n",
      "=AAA",
      "A===",
      "AA=A",
      "AAAA====",
      "AAAA==AA",
    ]) {
      expect(decodeStrictBase64(value, LIMIT)).toEqual({ ok: false, reason: "malformed" });
    }
  });

  test("rejects nonzero bits before the padding", () => {
    for (const value of ["AB==", "AAB=", "AAAAAP=="]) {
      expect(decodeStrictBase64(value, LIMIT)).toEqual({ ok: false, reason: "padding" });
    }
  });

  test("rejects payloads over the byte limit, including equal encoded lengths", () => {
    const encodedLimit = Math.ceil(LIMIT / 3) * 4;
    const prefix = "A".repeat(encodedLimit - 4);
    expect(LIMIT % 3).toBe(1);
    expect(decodeStrictBase64(`${prefix}AA==`, LIMIT).ok).toBe(true);
    expect(decodeStrictBase64(`${prefix}AAA=`, LIMIT)).toEqual({ ok: false, reason: "too_large" });
    expect(decodeStrictBase64(`${prefix}AAAAAAAA`, LIMIT)).toEqual({
      ok: false,
      reason: "too_large",
    });
  });
});
