import { describe, expect, mock, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import { useAfterLastReply } from "./command-palette-reply";

describe("useAfterLastReply", () => {
  test("runs once the requests that waited stop waiting", () => {
    const afterLastReply = mock(() => {});
    const view = renderHook(({ waiting }) => useAfterLastReply(waiting, afterLastReply), {
      initialProps: { waiting: true },
    });

    expect(afterLastReply).not.toHaveBeenCalled();
    view.rerender({ waiting: false });

    expect(afterLastReply).toHaveBeenCalledTimes(1);
  });

  test("does not run for a view that opens with no waiting request", () => {
    const afterLastReply = mock(() => {});

    renderHook(() => useAfterLastReply(false, afterLastReply));

    expect(afterLastReply).not.toHaveBeenCalled();
  });
});
