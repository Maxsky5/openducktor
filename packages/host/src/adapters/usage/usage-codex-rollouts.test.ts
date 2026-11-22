import { describe, expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import path from "node:path";
import { parseUsageSource } from "./usage-source-parser";

/**
 * Real Codex rollout excerpts of each format era. A script replaced their text with `x` and
 * their IDs with stable values of the same length, so the byte positions that the line reader
 * reads stay real. The parser reads them as it reads the originals.
 */
const read = async (name: string) => {
  const file = path.join(import.meta.dir, "fixtures", `codex-${name}.jsonl`);
  const { size, mtimeMs } = await stat(file);
  const { units, issue } = await parseUsageSource({
    runtime: "codex",
    path: file,
    format: "jsonl",
    fingerprint: { size, modifiedAtMs: mtimeMs, fileId: "fixture" },
    previous: null,
  });
  const measured = units.filter((unit) => unit.tokens !== null);
  return {
    measured: measured.length,
    tokens: measured.reduce(
      (sum, { tokens }) =>
        sum + (tokens ? tokens.input + tokens.cacheRead + tokens.cacheWrite5m + tokens.output : 0),
      0,
    ),
    unmeasured: units.filter((unit) => unit.tokens === null).map((unit) => unit.identity),
    models: [...new Set(units.map((unit) => unit.model))],
    issue,
  };
};

describe("real Codex rollouts", () => {
  test("CLI 0.166: one record per response, and a sampled compaction by its response ID", async () => {
    const result = await read("records");
    expect(result.measured).toBe(10);
    expect(result.tokens).toBe(2_967_677);
    // The compaction's own usage record lies outside the excerpt.
    expect(result.unmeasured).toHaveLength(1);
    expect(result.unmeasured[0]).not.toStartWith("turn:");
    expect(result.models).toEqual(["gpt-6.1-sol"]);
    expect(result.issue).toBeNull();
  });

  test("CLI 0.142: cumulative snapshots, and an aborted response without new usage", async () => {
    const result = await read("snapshots");
    expect(result.measured).toBe(6);
    expect(result.tokens).toBe(188_634);
    expect(result.unmeasured).toEqual([expect.stringMatching(/^turn:.+:6$/)]);
    expect(result.issue).toBeNull();
  });

  test("CLI 0.153 guardian: its own records before the history boundary count", async () => {
    const result = await read("guardian");
    expect(result.measured).toBe(2);
    expect(result.tokens).toBe(42_335);
    expect(result.unmeasured).toEqual([]);
    expect(result.models).toEqual(["codex-auto-review"]);
  });

  test("CLI 0.124: the note that ends a review is no request", async () => {
    const result = await read("review");
    expect(result).toEqual({ measured: 0, tokens: 0, unmeasured: [], models: [], issue: null });
  });
});
