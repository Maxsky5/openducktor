import { describe, expect, test } from "bun:test";
import type { DevServerTerminalChunk } from "@openducktor/contracts";
import { readDevServerTerminalOutput } from "./dev-server-terminal-output";

const chunk = (sequence: number): DevServerTerminalChunk => ({
  scriptId: "frontend",
  runIdentity: { runId: "run", runOrder: { hostInstanceId: "host", generation: 1 } },
  sequence,
  data: `${sequence}\r\n`,
  timestamp: "2026-03-25T10:00:00.000Z",
});

describe("readDevServerTerminalOutput", () => {
  test("reads all replay entries and handles noncontiguous sequences", () => {
    const entries = [chunk(2), chunk(9), chunk(15)];
    expect(readDevServerTerminalOutput(entries, null)).toBe("2\r\n9\r\n15\r\n");
    expect(readDevServerTerminalOutput(entries, 2)).toBe("9\r\n15\r\n");
    expect(readDevServerTerminalOutput(entries, 10)).toBe("15\r\n");
    expect(readDevServerTerminalOutput(entries, 15)).toBe("");
    expect(readDevServerTerminalOutput([], null)).toBe("");
  });

  test("visits only the binary search path and unseen tail at capacity", () => {
    let visits = 0;
    const entries = Array.from({ length: 2_000 }, (_, index) => chunk(index * 3));
    const countedEntries: DevServerTerminalChunk[] = [];
    entries.forEach((entry, index) => {
      Object.defineProperty(countedEntries, index, {
        get: () => {
          visits += 1;
          return entry;
        },
      });
    });
    expect(readDevServerTerminalOutput(countedEntries, 1_899 * 3)).toBe(
      entries
        .slice(1_900)
        .map((entry) => entry.data)
        .join(""),
    );
    expect(visits).toBeLessThanOrEqual(111);
    visits = 0;
    expect(readDevServerTerminalOutput(countedEntries, 1_999 * 3)).toBe("");
    expect(visits).toBeLessThanOrEqual(11);
  });
});
