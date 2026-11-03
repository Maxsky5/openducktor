import "@openducktor/frontend-core/test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import type { GitDiffRefreshMode } from "@openducktor/frontend-core/git/contracts";
import { renderHook } from "@testing-library/react";
import { useFocusGitRefresh } from "./use-focus-git-refresh";

const renderRefresh = (props: { enabled: boolean; loaded: boolean }, fails = false) => {
  const modes: GitDiffRefreshMode[] = [];
  const refresh = (mode: GitDiffRefreshMode) => {
    modes.push(mode);
    return fails ? Promise.reject(new Error("read failed")) : Promise.resolve();
  };
  const hook = renderHook(() => useFocusGitRefresh({ ...props, refresh }));
  return { modes, onFocus: hook.result.current };
};

describe("useFocusGitRefresh", () => {
  test("refreshes softly on each focus", () => {
    const { modes, onFocus } = renderRefresh({ enabled: true, loaded: true });
    onFocus();
    onFocus();
    expect(modes).toEqual(["soft", "soft"]);
  });

  test("does not refresh reads that did not load yet", () => {
    const { modes, onFocus } = renderRefresh({ enabled: true, loaded: false });
    onFocus();
    expect(modes).toEqual([]);
  });

  test("does not refresh a screen that shows no changes", () => {
    const { modes, onFocus } = renderRefresh({ enabled: false, loaded: true });
    onFocus();
    expect(modes).toEqual([]);
  });

  test("leaves a failed read to its view", async () => {
    const { modes, onFocus } = renderRefresh({ enabled: true, loaded: true }, true);
    onFocus();
    await Promise.resolve();
    expect(modes).toEqual(["soft"]);
  });
});
