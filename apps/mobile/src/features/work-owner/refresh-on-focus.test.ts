import { describe, expect, test } from "bun:test";
import type { GitDiffRefreshMode } from "@openducktor/frontend-core/git/contracts";
import { refreshOnFocus } from "./refresh-on-focus";

const run = (props: { enabled: boolean; loaded: boolean }, fails = false) => {
  const modes: GitDiffRefreshMode[] = [];
  refreshOnFocus({
    ...props,
    refresh: (mode: GitDiffRefreshMode) => {
      modes.push(mode);
      return fails ? Promise.reject(new Error("read failed")) : Promise.resolve();
    },
  });
  return modes;
};

describe("refreshOnFocus", () => {
  test("refreshes softly a screen that shows loaded changes", () => {
    expect(run({ enabled: true, loaded: true })).toEqual(["soft"]);
  });

  test("does not refresh reads that did not load yet", () => {
    expect(run({ enabled: true, loaded: false })).toEqual([]);
  });

  test("does not refresh a screen that shows no changes", () => {
    expect(run({ enabled: false, loaded: true })).toEqual([]);
  });

  test("leaves a failed read to its view", async () => {
    expect(run({ enabled: true, loaded: true }, true)).toEqual(["soft"]);
    await Promise.resolve();
  });
});
