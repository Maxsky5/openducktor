import { describe, expect, test } from "bun:test";
import {
  isPlainUnifiedDiff,
  parseTerminalLines,
  parseTerminalText,
  readDiffLineTone,
  readTerminalText,
} from "./terminal-text";

const ESC = "\u001b";

describe("terminal text", () => {
  test("keeps a plain output as one run", () => {
    expect(parseTerminalText("one\ntwo\n")).toEqual([
      {
        text: "one\ntwo\n",
        fg: null,
        bg: null,
        bold: false,
        dim: false,
        italic: false,
        underline: false,
        strikethrough: false,
      },
    ]);
    expect(parseTerminalText("")).toEqual([]);
  });

  test("reads the colors and styles of a log line", () => {
    const segments = parseTerminalText(
      `${ESC}[2m2026-11-10T01:28:46${ESC}[0m  ${ESC}[34mINFO${ESC}[0m Stopped ${ESC}[1;91mworkers${ESC}[0m`,
    );
    expect(segments.map(({ text }) => text)).toEqual([
      "2026-11-10T01:28:46",
      "  ",
      "INFO",
      " Stopped ",
      "workers",
    ]);
    expect(segments[0]).toMatchObject({ dim: true, fg: null });
    expect(segments[2]?.fg).toEqual({ kind: "tone", tone: "blue", bright: false });
    expect(segments[4]?.fg).toEqual({ kind: "tone", tone: "red", bright: true });
  });

  test("gives 256 colors and true colors as rgb", () => {
    const segments = parseTerminalText(
      `${ESC}[38;5;196mred${ESC}[0m ${ESC}[38;2;1;2;3mrgb${ESC}[0m`,
    );
    expect(segments[0]?.fg).toEqual({ kind: "rgb", rgb: "255, 0, 0" });
    expect(segments[2]?.fg).toEqual({ kind: "rgb", rgb: "1, 2, 3" });
  });

  test("splits an output into lines of styled runs", () => {
    const lines = parseTerminalLines(`one\n${ESC}[31mtwo\nthree${ESC}[0m four\n\n`);
    expect(lines.map((line) => line.map(({ text }) => text))).toEqual([
      ["one"],
      ["two"],
      ["three", " four"],
      [],
    ]);
    expect(lines[1]?.[0]?.fg).toEqual({ kind: "tone", tone: "red", bright: false });
    expect(parseTerminalLines("")).toEqual([]);
  });

  test("shows the last state of a line that a progress bar wrote again", () => {
    expect(readTerminalText("Downloading 10%\rDownloading 55%\rDownloading 100%\ndone\r\n")).toBe(
      "Downloading 100%\ndone\n",
    );
  });

  test("gives the plain text without escape sequences, for copy and line counts", () => {
    expect(readTerminalText(`${ESC}[31mfailed${ESC}[0m${ESC}[2K\n${ESC}]0;title${ESC}\\ok`)).toBe(
      "failed\nok",
    );
  });

  test("colors the lines of a plain unified diff", () => {
    const diff = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-old\n+new\n same";
    expect(isPlainUnifiedDiff(diff)).toBe(true);
    expect(isPlainUnifiedDiff(`${ESC}[32m+new${ESC}[0m\n@@ -1 +1 @@`)).toBe(false);
    expect(isPlainUnifiedDiff("src/a.ts:1:1 error")).toBe(false);
    expect(diff.split("\n").map(readDiffLineTone)).toEqual([
      "white",
      "white",
      "white",
      "cyan",
      "red",
      "green",
      null,
    ]);
  });
});
