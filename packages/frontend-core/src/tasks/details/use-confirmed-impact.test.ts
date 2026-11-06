import "../../test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import { useConfirmedImpact } from "./use-confirmed-impact";

type Props = { impact: string; open: boolean; isPending: boolean };

const render = (initial: Props) =>
  renderHook(
    ({ impact, open, isPending }: Props) =>
      useConfirmedImpact(impact, { open, operation: { isPending } }),
    { initialProps: initial },
  );

describe("useConfirmedImpact", () => {
  test("keeps the confirmed impact while the command runs and while the dialog closes", () => {
    const hook = render({ impact: "worktree", open: true, isPending: false });
    hook.rerender({ impact: "worktree", open: true, isPending: true });
    hook.rerender({ impact: "no worktree", open: true, isPending: true });
    expect(hook.result.current).toBe("worktree");
    hook.rerender({ impact: "no worktree", open: false, isPending: false });
    expect(hook.result.current).toBe("worktree");
  });

  test("shows the live impact again after a failed command and on the next open", () => {
    const hook = render({ impact: "worktree", open: true, isPending: true });
    hook.rerender({ impact: "worktree changed", open: true, isPending: false });
    expect(hook.result.current).toBe("worktree changed");
    hook.rerender({ impact: "worktree changed", open: false, isPending: false });
    hook.rerender({ impact: "other task", open: true, isPending: false });
    expect(hook.result.current).toBe("other task");
  });
});
