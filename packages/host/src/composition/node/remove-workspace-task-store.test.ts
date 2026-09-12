import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  createAssertPermanentRemovalSupported,
  createRemoveWorkspaceTaskStore,
} from "./remove-workspace-task-store";
import { createTaskStoreTestDouble } from "../../test-support/task-store-test-double";

describe("remove workspace task store", () => {
  test("closes the store and removes the directory for the built-in task store", async () => {
    const calls: string[] = [];
    const removeWorkspaceTaskStore = createRemoveWorkspaceTaskStore({
      closeWorkspace: (workspaceId) =>
        Effect.sync(() => {
          calls.push(`close:${workspaceId}`);
        }),
      removeDirectory: (workspaceId) =>
        Effect.sync(() => {
          calls.push(`remove:${workspaceId}`);
        }),
    });

    await Effect.runPromise(removeWorkspaceTaskStore("alpha"));

    expect(calls).toEqual(["close:alpha", "remove:alpha"]);
  });

  test("refuses removal when a configured task store is injected", async () => {
    const calls: string[] = [];
    const removeWorkspaceTaskStore = createRemoveWorkspaceTaskStore({
      closeWorkspace: (workspaceId) =>
        Effect.sync(() => {
          calls.push(`close:${workspaceId}`);
        }),
      configuredTaskStore: createTaskStoreTestDouble({}),
      removeDirectory: (workspaceId) =>
        Effect.sync(() => {
          calls.push(`remove:${workspaceId}`);
        }),
    });

    const error = await Effect.runPromise(Effect.flip(removeWorkspaceTaskStore("alpha")));

    expect(error.message).toContain(
      "Permanent removal is not supported with a configured task store.",
    );
    expect(calls).toEqual([]);
  });

  test("accepts permanent removal for the built-in task store", async () => {
    const assertPermanentRemovalSupported = createAssertPermanentRemovalSupported({});

    await Effect.runPromise(assertPermanentRemovalSupported("alpha"));
  });

  test("rejects permanent removal before any work starts when a configured task store is injected", async () => {
    const assertPermanentRemovalSupported = createAssertPermanentRemovalSupported({
      configuredTaskStore: createTaskStoreTestDouble({}),
    });

    const error = await Effect.runPromise(Effect.flip(assertPermanentRemovalSupported("alpha")));

    expect(error.message).toContain(
      "Permanent removal is not supported with a configured task store.",
    );
  });
});
