import { describe, expect, test } from "bun:test";
import {
  createBrowserRuntimeConfigState,
  readBrowserRuntimeConfig,
} from "./browser-runtime-config-state";

describe("browser runtime config state", () => {
  test("holds startup reads until the host publishes runtime config", async () => {
    const state = createBrowserRuntimeConfigState();
    let settled = false;
    const pendingRead = Promise.resolve(readBrowserRuntimeConfig(state)).then((value) => {
      settled = true;
      return value;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    state.publish('{"backendUrl":"http://127.0.0.1:14327"}');

    expect(await pendingRead).toBe('{"backendUrl":"http://127.0.0.1:14327"}');
  });

  test("returns published config without another wait", () => {
    const state = createBrowserRuntimeConfigState();
    state.publish('{"backendUrl":"http://127.0.0.1:14327"}');

    expect(readBrowserRuntimeConfig(state)).toBe('{"backendUrl":"http://127.0.0.1:14327"}');
  });
});
