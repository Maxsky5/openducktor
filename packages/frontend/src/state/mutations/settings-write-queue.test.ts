import { expect, test } from "bun:test";
import { createQueryClient } from "@/lib/query-client";
import { createDeferred } from "@/test-utils/shared-test-fixtures";
import { runSettingsWrite } from "./settings-write-queue";

test("holds the next write until the first response is published and releases after failure", async () => {
  const queryClient = createQueryClient();
  const response = createDeferred<void>();
  const started = createDeferred<void>();
  const calls: string[] = [];
  const first = runSettingsWrite(queryClient, async () => {
    calls.push("first write");
    started.resolve();
    await response.promise;
    calls.push("first publish");
    throw new Error("publication failed");
  });
  const firstFailure = first.catch((error: Error) => error);
  await started.promise;
  const second = runSettingsWrite(queryClient, async () => {
    calls.push("second write");
  });
  expect(calls).toEqual(["first write"]);
  response.resolve();
  expect(await firstFailure).toEqual(new Error("publication failed"));
  await second;
  expect(calls).toEqual(["first write", "first publish", "second write"]);
});

test("separate query clients do not block one another", async () => {
  const gate = createDeferred<void>();
  const first = runSettingsWrite(createQueryClient(), () => gate.promise);
  expect(await runSettingsWrite(createQueryClient(), async () => "done")).toBe("done");
  gate.resolve();
  await first;
});
