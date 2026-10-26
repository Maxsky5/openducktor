import { describe, expect, test } from "bun:test";
import { Utf8TextDecoder } from "./utf8-text-decoder";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("UTF-8 text decoder", () => {
  test("decodes like the platform decoder in one call", () => {
    const text = "Plan ✓ 日本 𝒜 👩‍💻";
    const encoded = new TextEncoder().encode(text);
    expect(new Utf8TextDecoder().decode(encoded)).toBe(text);
    expect(new Utf8TextDecoder().decode(encoded.buffer)).toBe(text);
  });

  test("keeps a split character until its last byte arrives in stream mode", () => {
    const decoder = new Utf8TextDecoder("utf-8", { fatal: true });
    const encoded = new TextEncoder().encode("a€😀b");
    let output = "";
    for (const byte of encoded) output += decoder.decode(bytes(byte), { stream: true });
    output += decoder.decode();
    expect(output).toBe("a€😀b");
  });

  test("throws in fatal mode for invalid or unfinished input", () => {
    expect(() => new Utf8TextDecoder("utf-8", { fatal: true }).decode(bytes(0xff))).toThrow(
      TypeError,
    );
    expect(() => new Utf8TextDecoder("utf-8", { fatal: true }).decode(bytes(0xe2, 0x82))).toThrow(
      "The encoded data was not valid UTF-8.",
    );
    // An overlong encoding and a surrogate are invalid.
    expect(() => new Utf8TextDecoder("utf-8", { fatal: true }).decode(bytes(0xc0, 0xaf))).toThrow();
    expect(() =>
      new Utf8TextDecoder("utf-8", { fatal: true }).decode(bytes(0xed, 0xa0, 0x80)),
    ).toThrow();
  });

  test("replaces invalid sequences without fatal mode as the platform decoder does", () => {
    const platform = new TextDecoder();
    for (const input of [
      bytes(0x61, 0xff, 0x62),
      bytes(0xe2, 0x82, 0x61),
      bytes(0xf0, 0x9f, 0x98),
      bytes(0xc0, 0xaf),
    ]) {
      expect(new Utf8TextDecoder().decode(input)).toBe(platform.decode(input));
    }
  });

  test("drops a leading byte order mark and refuses other encodings", () => {
    expect(new Utf8TextDecoder().decode(bytes(0xef, 0xbb, 0xbf, 0x61))).toBe("a");
    expect(() => new Utf8TextDecoder("latin1")).toThrow('The "latin1" encoding is not supported.');
  });

  test("keeps a leading byte order mark with ignoreBOM, also after a reset", () => {
    const decoder = new Utf8TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    const text = bytes(0xef, 0xbb, 0xbf, 0x61);
    expect(decoder.decode(text)).toBe("\ufeffa");
    expect(() => decoder.decode(bytes(0xff))).toThrow();
    expect(decoder.decode(text)).toBe("\ufeffa");
  });
});
