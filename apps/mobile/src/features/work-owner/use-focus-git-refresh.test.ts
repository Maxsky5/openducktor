import "@openducktor/frontend-core/test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import type { GitDiffRefreshMode } from "@openducktor/frontend-core/git/contracts";
import { renderHook } from "@testing-library/react";
import { useFocusGitRefresh } from "./use-focus-git-refresh";

const renderFocus = (initial: { focused: boolean; loaded: boolean }, fails = false) => {
  const modes: GitDiffRefreshMode[] = [];
  const refresh = (mode: GitDiffRefreshMode) => {
    modes.push(mode);
    return fails ? Promise.reject(new Error("read failed")) : Promise.resolve();
  };
  const hook = renderHook(
    (props: { focused: boolean; loaded: boolean }) => useFocusGitRefresh({ ...props, refresh }),
    { initialProps: initial },
  );
  return { modes, rerender: hook.rerender };
};

describe("useFocusGitRefresh", () => {
  test("refreshes softly on a new visit and on each return to the screen", () => {
    const { modes, rerender } = renderFocus({ focused: true, loaded: true });
    expect(modes).toEqual(["soft"]);

    rerender({ focused: true, loaded: true });
    rerender({ focused: false, loaded: true });
    expect(modes).toEqual(["soft"]);

    rerender({ focused: true, loaded: true });
    expect(modes).toEqual(["soft", "soft"]);
  });

  test("does not refresh reads that did not load yet", () => {
    const { modes, rerender } = renderFocus({ focused: true, loaded: false });
    rerender({ focused: true, loaded: true });
    expect(modes).toEqual([]);
  });

  test("leaves a failed read to its view", async () => {
    const { modes } = renderFocus({ focused: true, loaded: true }, true);
    await Promise.resolve();
    expect(modes).toEqual(["soft"]);
  });
});
