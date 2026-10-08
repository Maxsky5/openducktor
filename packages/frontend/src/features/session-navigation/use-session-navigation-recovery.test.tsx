import { expect, mock, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useSessionNavigationRecovery } from "./use-session-navigation-recovery";

test("a read retry can start during a save retry and keeps its pending state after the save fails", async () => {
  let rejectWrite = (_cause: Error) => {};
  let finishRead = () => {};
  const write = new Promise<void>((_resolve, reject) => {
    rejectWrite = reject;
  });
  const read = new Promise<void>((resolve) => {
    finishRead = resolve;
  });
  const args: Parameters<typeof useSessionNavigationRecovery>[0] = {
    scopeKey: "workspace:task",
    readError: null,
    writeError: new Error("Save denied"),
    retryRead: mock(() => read),
    retryWrite: mock(() => write),
  };
  const h = renderHook((props: typeof args) => useSessionNavigationRecovery(props), {
    initialProps: args,
  });
  try {
    act(() => h.result.current.retryNavigationPersistence());
    expect(h.result.current.isRetryingNavigationPersistence).toBe(true);
    const readError = new Error("Read denied");
    h.rerender({ ...args, readError });
    expect(h.result.current.navigationPersistenceOperation).toBe("load");
    expect(h.result.current.isRetryingNavigationPersistence).toBe(false);
    act(() => h.result.current.retryNavigationPersistence());
    expect(args.retryRead).toHaveBeenCalledTimes(1);
    expect(h.result.current.isRetryingNavigationPersistence).toBe(true);
    await act(async () => rejectWrite(new Error("Old save retry denied")));
    expect(h.result.current.navigationPersistenceError).toBe(readError);
    expect(h.result.current.isRetryingNavigationPersistence).toBe(true);
    await act(async () => finishRead());
    expect(h.result.current.isRetryingNavigationPersistence).toBe(false);
  } finally {
    h.unmount();
    rejectWrite(new Error("Save retry ended"));
    finishRead();
  }
});
