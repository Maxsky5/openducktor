import { afterEach, describe, expect, test } from "bun:test";
import { installPageGlobals, objectGroupBy, promiseWithResolvers } from "./page-globals";

type BuiltIn = PromiseConstructor | ObjectConstructor;
type PageGlobalName = "withResolvers" | "groupBy";

/** The own method on a built-in, read without its declared type, so a removed method is undefined. */
const ownMethod = (target: BuiltIn, name: PageGlobalName): PropertyDescriptor["value"] =>
  Object.getOwnPropertyDescriptor(target, name)?.value;

// The test runtime has both methods. Each test restores them after it removes them.
const platformWithResolvers = ownMethod(Promise, "withResolvers");
const platformGroupBy = ownMethod(Object, "groupBy");

const restore = (
  target: BuiltIn,
  name: PageGlobalName,
  value: PropertyDescriptor["value"],
): void => {
  Object.defineProperty(target, name, { value, configurable: true, writable: true });
};

afterEach(() => {
  restore(Promise, "withResolvers", platformWithResolvers);
  restore(Object, "groupBy", platformGroupBy);
});

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

  test("objectGroupBy groups items by key into a null-prototype object", () => {
    const words = ["ant", "bee", "cat", "bear", "ape"];
    const grouped = objectGroupBy(words, (word, index) => (index === 4 ? "last" : (word[0] ?? "")));
    expect({ ...grouped }).toEqual({ a: ["ant"], b: ["bee", "bear"], c: ["cat"], last: ["ape"] });
    expect(Object.getPrototypeOf(grouped)).toBeNull();
  });

  test("installs both methods when the WebView lacks them, and keeps platform methods", () => {
    Reflect.deleteProperty(Promise, "withResolvers");
    Reflect.deleteProperty(Object, "groupBy");

    installPageGlobals();
    expect(ownMethod(Promise, "withResolvers")).toBe(promiseWithResolvers);
    expect(ownMethod(Object, "groupBy")).toBe(objectGroupBy);

    restore(Promise, "withResolvers", platformWithResolvers);
    installPageGlobals();
    expect(ownMethod(Promise, "withResolvers")).toBe(platformWithResolvers);
  });
});
