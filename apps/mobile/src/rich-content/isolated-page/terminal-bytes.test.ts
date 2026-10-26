import { describe, expect, test } from "bun:test";
import { decodeBase64, encodeBase64 } from "./terminal-bytes";

describe("terminal bytes", () => {
  test("encodes like standard base64 for every padding length", () => {
    for (let length = 0; length <= 7; length += 1) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 97 + 13) % 256);
      expect(encodeBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    }
  });

  test("keeps bytes that are not valid UTF-8 across a large frame", () => {
    const bytes = Uint8Array.from({ length: 70_001 }, (_, index) => (index * 31) % 256);
    const text = encodeBase64(bytes);
    expect(text).toBe(Buffer.from(bytes).toString("base64"));
    expect(decodeBase64(text)).toEqual(bytes);
  });

  test("rejects text that is not base64", () => {
    expect(() => decodeBase64("abc")).toThrow("not valid base64");
    expect(() => decodeBase64("ab$=")).toThrow("not valid base64");
  });
});
