import { expect, test } from "bun:test";
import { createElectronDetachedTaskOwner, runElectronMainTask } from "./electron-main-task-owner";

test("detached task owner reports the first failure and drains all admitted work", async () => {
  const firstFailure = new Error("first persistent log failed");
  const reported: unknown[] = [];
  let rejectFirst: (cause: unknown) => void = () => {};
  let resolveSecond: () => void = () => {};
  let markFirstStarted: () => void = () => {};
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  let markSecondStarted: () => void = () => {};
  const secondStarted = new Promise<void>((resolve) => {
    markSecondStarted = resolve;
  });
  let markFailureReported: () => void = () => {};
  const failureReported = new Promise<void>((resolve) => {
    markFailureReported = resolve;
  });
  const owner = createElectronDetachedTaskOwner((cause) => {
    reported.push(cause);
    markFailureReported();
  });

  owner.run(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectFirst = reject;
        markFirstStarted();
      }),
  );
  owner.run(
    () =>
      new Promise<void>((resolve) => {
        resolveSecond = resolve;
        markSecondStarted();
      }),
  );
  const drain = owner.drain();
  await Promise.all([firstStarted, secondStarted]);

  rejectFirst(firstFailure);
  await failureReported;
  expect(reported).toEqual([firstFailure]);

  resolveSecond();
  await expect(drain).rejects.toBe(firstFailure);
});

test("reports a synchronous task failure exactly once", async () => {
  const failure = new Error("synchronous persistence failure");
  const reported: unknown[] = [];

  expect(() =>
    runElectronMainTask(
      () => {
        throw failure;
      },
      (cause) => reported.push(cause),
    ),
  ).not.toThrow();
  await Promise.resolve();

  expect(reported).toEqual([failure]);
});

test("reports an asynchronous task failure exactly once", async () => {
  const failure = new Error("asynchronous persistence failure");
  const reported: unknown[] = [];

  runElectronMainTask(
    () => Promise.reject(failure),
    (cause) => reported.push(cause),
  );
  await Promise.resolve();
  await Promise.resolve();

  expect(reported).toEqual([failure]);
});
