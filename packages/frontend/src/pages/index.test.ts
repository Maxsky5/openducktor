import { describe, expect, mock, test } from "bun:test";
import type { ComponentType } from "react";
import { createCachedPageLoader } from "./index";

const TestPage = (() => null) as ComponentType;

describe("createCachedPageLoader", () => {
  test("retries after a rejected load instead of returning a poisoned cached promise", async () => {
    const failedImport = new Error("chunk load failed");
    let attempts = 0;
    const loadPage = mock(async () => {
      attempts += 1;

      if (attempts === 1) {
        throw failedImport;
      }

      return { default: TestPage };
    });
    const loadCachedPage = createCachedPageLoader(loadPage);

    await expect(loadCachedPage()).rejects.toThrow(failedImport);
    await expect(loadCachedPage()).resolves.toEqual({ default: TestPage });

    expect(loadPage).toHaveBeenCalledTimes(2);
  });

  test("reuses the in-flight successful load promise", () => {
    const loadPage = mock(async () => ({ default: TestPage }));
    const loadCachedPage = createCachedPageLoader(loadPage);

    const firstLoad = loadCachedPage();
    const secondLoad = loadCachedPage();

    expect(secondLoad).toBe(firstLoad);
    expect(loadPage).toHaveBeenCalledTimes(1);
  });
});
