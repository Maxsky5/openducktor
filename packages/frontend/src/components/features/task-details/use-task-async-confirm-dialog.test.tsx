import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act } from "react";
import { installReactActEnvironment } from "@openducktor/frontend-core/test-support/react-act-environment";
import { createHookHarness } from "@openducktor/frontend-core/test-support/react-hook-harness";
import { useTaskAsyncConfirmDialog } from "./use-task-async-confirm-dialog";

type Props = Parameters<typeof useTaskAsyncConfirmDialog>[0];

/** A run that stays pending until the test settles it. */
const deferredRun = () => {
  let resolve: () => void = () => {};
  let reject: (error: Error) => void = () => {};
  const run = mock(
    () =>
      new Promise<void>((resolveRun, rejectRun) => {
        resolve = resolveRun;
        reject = rejectRun;
      }),
  );
  return { run, resolve: () => resolve(), reject: (error: Error) => reject(error) };
};

let restoreReactActEnvironment: (() => void) | null = null;
let harness: ReturnType<
  typeof createHookHarness<Props, ReturnType<typeof useTaskAsyncConfirmDialog>>
> | null = null;

const mount = async (props: Props) => {
  harness = createHookHarness(useTaskAsyncConfirmDialog, props);
  await harness.mount();
  return harness;
};

/** Start the run without waiting for it to settle. */
const startConfirm = async (): Promise<void> => {
  await act(async () => {
    harness?.getLatest().dialog.onConfirm();
    await Promise.resolve();
  });
};

beforeEach(() => {
  restoreReactActEnvironment = installReactActEnvironment();
});

afterEach(async () => {
  await harness?.unmount();
  harness = null;
  restoreReactActEnvironment?.();
  restoreReactActEnvironment = null;
});

describe("useTaskAsyncConfirmDialog", () => {
  test("closes the dialog and reports the success after the run succeeds", async () => {
    const run = mock(async () => {});
    const onSucceeded = mock(() => {});
    const hook = await mount({ enabled: true, scopeKey: "ODT-1", run, onSucceeded });

    await hook.run((state) => state.openDialog());
    expect(hook.getLatest().dialog.open).toBe(true);
    await hook.run((state) => state.dialog.onConfirm());

    expect(run).toHaveBeenCalledTimes(1);
    expect(onSucceeded).toHaveBeenCalledTimes(1);
    expect(hook.getLatest().dialog).toMatchObject({
      open: false,
      operation: { isPending: false, error: null },
    });
  });

  test("keeps the dialog open with the error when the run fails", async () => {
    const onSucceeded = mock(() => {});
    const run = mock(async () => {
      throw new Error("delete failed");
    });
    const hook = await mount({ enabled: true, scopeKey: "ODT-2", run, onSucceeded });

    await hook.run((state) => state.openDialog());
    await hook.run((state) => state.dialog.onConfirm());

    expect(onSucceeded).not.toHaveBeenCalled();
    expect(hook.getLatest().dialog).toMatchObject({
      open: true,
      operation: { isPending: false, error: "delete failed" },
    });
  });

  test("ignores close attempts while the run is in flight", async () => {
    const pending = deferredRun();
    const onSucceeded = mock(() => {});
    const hook = await mount({ enabled: true, scopeKey: "ODT-3", run: pending.run, onSucceeded });

    await hook.run((state) => state.openDialog());
    await startConfirm();
    expect(hook.getLatest().dialog.operation.isPending).toBe(true);

    await hook.run((state) => state.dialog.onCancel());
    await hook.run((state) => state.dialog.onOpenChange(false));
    expect(hook.getLatest().dialog.open).toBe(true);

    await hook.run(() => pending.resolve());
    expect(hook.getLatest().dialog.operation.isPending).toBe(false);
    expect(onSucceeded).toHaveBeenCalledTimes(1);
  });

  test("keeps the duplicate guard while a run is in flight after the dialog was disabled", async () => {
    const pending = deferredRun();
    const props: Props = {
      enabled: true,
      scopeKey: "ODT-4",
      run: pending.run,
      onSucceeded: mock(() => {}),
    };
    const hook = await mount(props);

    await hook.run((state) => state.openDialog());
    await startConfirm();
    await hook.update({ ...props, enabled: false });
    expect(hook.getLatest().dialog.operation.isPending).toBe(true);

    await hook.update(props);
    await hook.run((state) => state.openDialog());
    await hook.run((state) => state.dialog.onConfirm());
    expect(pending.run).toHaveBeenCalledTimes(1);

    await hook.run(() => pending.resolve());
    expect(hook.getLatest().dialog.operation.isPending).toBe(false);
  });

  test("closes the dialog and clears its error when it is disabled", async () => {
    const props: Props = {
      enabled: true,
      scopeKey: "ODT-5",
      run: mock(async () => {
        throw new Error("boom");
      }),
      onSucceeded: () => {},
    };
    const hook = await mount(props);

    await hook.run((state) => state.openDialog());
    await hook.run((state) => state.dialog.onConfirm());
    expect(hook.getLatest().dialog.operation.error).toBe("boom");

    await hook.update({ ...props, enabled: false });
    expect(hook.getLatest().dialog).toMatchObject({
      open: false,
      operation: { isPending: false, error: null },
    });
  });

  test("does nothing on confirm without a run", async () => {
    const onSucceeded = mock(() => {});
    const hook = await mount({ enabled: true, scopeKey: "ODT-6", run: undefined, onSucceeded });

    await hook.run((state) => state.openDialog());
    await hook.run((state) => state.dialog.onConfirm());

    expect(onSucceeded).not.toHaveBeenCalled();
    expect(hook.getLatest().dialog).toMatchObject({
      open: true,
      operation: { isPending: false, error: null },
    });
  });

  test("resets on a new scope key and ignores the result of the earlier run", async () => {
    const pending = deferredRun();
    const onSucceeded = mock(() => {});
    const props: Props = { enabled: true, scopeKey: "ODT-7", run: pending.run, onSucceeded };
    const hook = await mount(props);

    await hook.run((state) => state.openDialog());
    await startConfirm();
    expect(hook.getLatest().dialog.operation.isPending).toBe(true);

    const nextRun = mock(async () => {});
    await hook.update({ ...props, scopeKey: "ODT-8", run: nextRun });
    expect(hook.getLatest().dialog).toMatchObject({
      open: false,
      operation: { isPending: false, error: null },
    });

    await act(async () => {
      pending.reject(new Error("stale failure"));
      await Promise.resolve();
    });
    expect(hook.getLatest().dialog.operation.error).toBeNull();
    expect(onSucceeded).not.toHaveBeenCalled();

    await hook.run((state) => state.openDialog());
    await hook.run((state) => state.dialog.onConfirm());
    expect(nextRun).toHaveBeenCalledTimes(1);
    expect(onSucceeded).toHaveBeenCalledTimes(1);
  });
});
