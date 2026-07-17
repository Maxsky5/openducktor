import { describe, expect, test } from "bun:test";
import { createTerminalTitleParser } from "./terminal-title-parser";

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

describe("TerminalTitleParser", () => {
  test("returns the latest complete title across fragmented OSC sequences", () => {
    const parser = createTerminalTitleParser();

    expect(parser.consume(encode("\u001b]2;pnpm "))).toBeNull();
    expect(parser.consume(encode("run dev\u001b\\"))).toBe("pnpm run dev");
  });

  test("normalizes shell prompt titles and ignores unrelated OSC sequences", () => {
    const parser = createTerminalTitleParser();

    expect(parser.consume(encode("\u001b]9;ignored\u0007"))).toBeNull();
    expect(parser.consume(encode("\u001b]0;user@host:~/projects/openducktor\u0007"))).toBe(
      "~/projects/openducktor",
    );
  });
});
