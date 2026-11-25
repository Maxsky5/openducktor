import { afterEach, describe, expect, test } from "bun:test";
import { installPageGlobals, promiseWithResolvers } from "./page-globals";

/** The own method on `Promise`, read without its declared type, so a removed method is undefined. */
const ownWithResolvers = (): PropertyDescriptor["value"] =>
  Object.getOwnPropertyDescriptor(Promise, "withResolvers")?.value;

// The test runtime has the method. Each test restores it after it removes it.
const platformWithResolvers = ownWithResolvers();

const restore = (value: PropertyDescriptor["value"]): void => {
  Object.defineProperty(Promise, "withResolvers", { value, configurable: true, writable: true });
};

afterEach(() => restore(platformWithResolvers));

describe("page globals", () => {
  test("promiseWithResolvers settles its promise from outside", async () => {
    const resolved = promiseWithResolvers<number>();
    resolved.resolve(7);
    expect(await resolved.promise).toBe(7);

    const rejected = promiseWithResolvers<number>();
    const failure = new Error("stopped");
    rejected.reject(failure);
    await expect(rejected.promise).rejects.toBe(failure);
  });

  test("installs the method when the WebView lacks it, and keeps the platform method", () => {
    Reflect.deleteProperty(Promise, "withResolvers");

    installPageGlobals();
    expect(ownWithResolvers()).toBe(promiseWithResolvers);

    restore(platformWithResolvers);
    installPageGlobals();
    expect(ownWithResolvers()).toBe(platformWithResolvers);
  });
});
