import { describe, expect, test } from "bun:test";
import { shouldLoadChecks } from "./app-lifecycle-model";

describe("app-lifecycle-model", () => {
  test("loads checks when any cache prerequisite is missing", () => {
    expect(
      shouldLoadChecks({
        hasRuntimeCheck: true,
        hasCachedTaskStoreCheck: true,
        hasCachedRepoRuntimeHealth: true,
      }),
    ).toBe(false);

    expect(
      shouldLoadChecks({
        hasRuntimeCheck: false,
        hasCachedTaskStoreCheck: true,
        hasCachedRepoRuntimeHealth: true,
      }),
    ).toBe(true);

    expect(
      shouldLoadChecks({
        hasRuntimeCheck: true,
        hasCachedTaskStoreCheck: false,
        hasCachedRepoRuntimeHealth: true,
      }),
    ).toBe(true);
  });
});
