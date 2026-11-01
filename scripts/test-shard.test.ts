import { describe, expect, test } from "bun:test";

import { parseShard, planShardRuns, type TestSuite } from "./test-shard";

const suites: TestSuite[] = [
  { directory: "packages/host", script: "test", command: "bun test --timeout 5000" },
  {
    directory: "tools/oxlint/anti-slop",
    script: "test",
    command: 'node --test "src/**/*.test.ts"',
  },
  { directory: ".", script: "test:scripts", command: "bun test scripts/a.test.ts" },
];

describe("test shard plan", () => {
  test("rejects a test script that is not one known test command", () => {
    for (const command of ["bun test a && bun test b", "cross-env CI=1 bun test", "vitest run"]) {
      expect(() =>
        planShardRuns([{ directory: "apps/x", script: "test", command }], { index: 1, total: 2 }),
      ).toThrow("must be one 'bun test' or 'node --test' command");
    }
  });

  test("gives each Bun suite the shard and runs Node suites only in the first shard", () => {
    expect(planShardRuns(suites, { index: 1, total: 3 })).toEqual([
      { directory: "packages/host", script: "test", args: ["--shard=1/3"] },
      { directory: "tools/oxlint/anti-slop", script: "test", args: [] },
      { directory: ".", script: "test:scripts", args: ["--shard=1/3"] },
    ]);
    expect(planShardRuns(suites, { index: 2, total: 3 })).toEqual([
      { directory: "packages/host", script: "test", args: ["--shard=2/3"] },
      { directory: ".", script: "test:scripts", args: ["--shard=2/3"] },
    ]);
  });

  test("rejects a shard outside its total", () => {
    expect(parseShard("3/3")).toEqual({ index: 3, total: 3 });
    expect(() => parseShard("4/3")).toThrow("Give the shard as <index>/<total>");
    expect(() => parseShard(undefined)).toThrow("Received ''");
  });
});
