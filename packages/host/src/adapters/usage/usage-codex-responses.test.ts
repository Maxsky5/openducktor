import { describe, expect, test } from "bun:test";
import { type CodexResponseStart, createCodexResponseTracker } from "./usage-codex-responses";

const start = (index: number, line = '{"type":"response_item"}'): CodexResponseStart => ({
  atMs: 1_000 + index,
  line: Buffer.from(line),
  turnId: "t1",
  index,
  attribution: { provider: "openai", model: "gpt-6.1-sol", project: "/repo", serviceTier: null },
  copied: false,
});

const identities = (units: { identity: string }[] | null) =>
  units === null ? null : units.map((unit) => unit.identity);

describe("createCodexResponseTracker", () => {
  test("ends an answered run without a record when the next response starts", () => {
    const tracker = createCodexResponseTracker(() => "root");
    expect(tracker.output(start(0))).toEqual([]);
    tracker.input();
    expect(identities(tracker.output(start(1)))).toEqual(["turn:t1:0"]);
    expect(identities(tracker.end())).toEqual(["turn:t1:1"]);
  });

  test("keeps more output of an open run as one response", () => {
    const tracker = createCodexResponseTracker(() => "root");
    tracker.output(start(0));
    expect(tracker.continuesRun()).toBe(true);
    expect(tracker.output(start(1))).toEqual([]);
    const [unit] = tracker.end() ?? [];
    expect([unit?.identity, unit?.occurredAtMs]).toEqual(["turn:t1:0", 1_000]);
  });

  test("adds nothing for a run that a record covers", () => {
    const tracker = createCodexResponseTracker(() => "root");
    tracker.output(start(0));
    tracker.input();
    tracker.covered();
    expect(tracker.waiting()).toBe(false);
    expect(tracker.output(start(1))).toEqual([]);
    tracker.covered();
    expect(tracker.end()).toEqual([]);
  });

  test("reports a copied or cut first item as a record it cannot attribute", () => {
    const copied = createCodexResponseTracker(() => "root");
    copied.output({ ...start(0), copied: true });
    expect(copied.end()).toBeNull();
    const cut = createCodexResponseTracker(() => "root");
    cut.output(start(0, '{"type":"response_item","payload":{"ty'));
    expect(cut.end()).toBeNull();
  });
});
