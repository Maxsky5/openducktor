import { describe, expect, test } from "bun:test";
import { colorResolver, readBlock, readDeclarations, toHex } from "./colors";

const hexOf = (body: string, name: string, fallback = new Map<string, string>()): string =>
  toHex(colorResolver(readDeclarations(body), fallback)(name));

describe("theme colors", () => {
  test("resolves an OKLCH color to sRGB", () => {
    expect(hexOf("--primary: oklch(0.5 0.31 277.49);", "primary")).toBe("#5100ff");
    expect(hexOf("--card: oklch(1 0 0);", "card")).toBe("#ffffff");
  });

  test("resolves a var() from the block, then from the fallback", () => {
    const palette = readBlock(
      "@theme default {\n  --color-red-500: #ff0000;\n}",
      /@theme default \{/,
    );
    expect(hexOf("--ring: var(--color-red-500);", "ring", palette)).toBe("#ff0000");
  });

  test("mixes with a transparent color and keeps the alpha", () => {
    const body = "--surface: color-mix(in srgb, #000000 25%, #00000000);";
    expect(hexOf(body, "surface")).toBe("#00000040");
  });

  test("fails on a missing or circular token", () => {
    expect(() => hexOf("--a: var(--b);", "a")).toThrow("The theme has no --b token.");
    expect(() => hexOf("--a: var(--a);", "a")).toThrow("The theme token --a refers to itself.");
  });
});
