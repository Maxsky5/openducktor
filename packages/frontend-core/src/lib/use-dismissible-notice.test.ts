import "../test-support/dom-environment";
import { expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useDismissibleNotice } from "./use-dismissible-notice";

type NoticeProps = { message: string | null };

test("keeps a dismissed notice hidden until a new message or a new failure arrives", () => {
  const initialProps: NoticeProps = { message: "Socket closed." };
  const view = renderHook(({ message }: NoticeProps) => useDismissibleNotice(message), {
    initialProps,
  });
  expect(view.result.current.visible).toBe("Socket closed.");

  act(() => view.result.current.dismiss());
  expect(view.result.current.visible).toBeNull();
  view.rerender({ message: "Socket closed." });
  expect(view.result.current.visible).toBeNull();

  view.rerender({ message: "Host not reachable." });
  expect(view.result.current.visible).toBe("Host not reachable.");

  act(() => view.result.current.dismiss());
  view.rerender({ message: null });
  view.rerender({ message: "Host not reachable." });
  expect(view.result.current.visible).toBe("Host not reachable.");
});
