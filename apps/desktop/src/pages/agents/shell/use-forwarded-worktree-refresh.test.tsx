import { describe, expect, mock, test } from "bun:test";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "../agent-studio-test-utils";
import {
  useForwardedWorktreeRefresh,
  type WorktreeRefreshRef,
} from "./use-forwarded-worktree-refresh";

enableReactActEnvironment();

type HookArgs = WorktreeRefreshRef;

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useForwardedWorktreeRefresh, initialProps);

describe("useForwardedWorktreeRefresh", () => {
  test("forwards refresh mode to the current worktree refresh callback", async () => {
    const refreshWorktree = mock(async (_mode?: "hard" | "soft" | "scheduled") => {});
    const harness = createHookHarness({ current: refreshWorktree });

    try {
      await harness.mount();
      await harness.getLatest()("soft");

      expect(refreshWorktree).toHaveBeenCalledWith("soft");
    } finally {
      await harness.unmount();
    }
  });

  test("returns a resolved promise when no callback is registered", async () => {
    const harness = createHookHarness({ current: null });

    try {
      await harness.mount();

      await expect(harness.getLatest()("soft")).resolves.toBeUndefined();
    } finally {
      await harness.unmount();
    }
  });
});
