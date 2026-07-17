import { expect, test } from "bun:test";
import { runElectronMainTask } from "./electron-main-task-owner";

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
