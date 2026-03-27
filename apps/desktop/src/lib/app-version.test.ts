import { afterEach, describe, expect, test } from "bun:test";

describe("getAppVersion", () => {
  const originalValue = import.meta.env.VITE_ODT_APP_VERSION;

  afterEach(() => {
    import.meta.env.VITE_ODT_APP_VERSION = originalValue;
  });

  test("returns version when VITE_ODT_APP_VERSION is set", async () => {
    import.meta.env.VITE_ODT_APP_VERSION = "1.2.3";
    const { getAppVersion } = await import("./app-version");
    expect(getAppVersion()).toBe("1.2.3");
  });

  test("returns null when VITE_ODT_APP_VERSION is empty", async () => {
    import.meta.env.VITE_ODT_APP_VERSION = "";
    const { getAppVersion } = await import("./app-version");
    expect(getAppVersion()).toBeNull();
  });

  test("returns null when VITE_ODT_APP_VERSION is absent", async () => {
    import.meta.env.VITE_ODT_APP_VERSION = "";
    const { getAppVersion } = await import("./app-version");
    expect(getAppVersion()).toBeNull();
  });
});
