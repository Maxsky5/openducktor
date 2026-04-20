import { describe, expect, test } from "bun:test";
import { shouldLoadChecks } from "./app-lifecycle-model";

describe("app-lifecycle-model", () => {
  test("loads checks when any cache prerequisite is missing", () => {
    expect(
      shouldLoadChecks({
        hasRuntimeCheck: true,
        hasCachedBeadsCheck: true,
        hasCachedRepoRuntimeHealth: true,
      }),
    ).toBe(false);

    expect(
      shouldLoadChecks({
        hasRuntimeCheck: false,
        hasCachedBeadsCheck: true,
        hasCachedRepoRuntimeHealth: true,
      }),
    ).toBe(true);

    expect(
      shouldLoadChecks({
        hasRuntimeCheck: true,
        hasCachedBeadsCheck: false,
        hasCachedRepoRuntimeHealth: true,
      }),
    ).toBe(true);
  });
});
