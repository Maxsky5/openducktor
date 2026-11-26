import { describe, expect, test } from "bun:test";
import { createMemoryClientStorage, createPrefixedClientStorage } from "./client-storage";

const PREFIX = "host-a:";

/** A shared storage with a key of another owner, and a prefixed view of it. */
const createViews = () => {
  const base = createMemoryClientStorage();
  base.setItem("host-b:layout", "other");
  return { base, view: createPrefixedClientStorage(base, PREFIX) };
};

describe("createPrefixedClientStorage", () => {
  test("writes and reads its keys under its prefix", () => {
    const { base, view } = createViews();

    view.setItem("layout", "mine");

    expect(base.getItem("host-a:layout")).toBe("mine");
    expect(view.getItem("layout")).toBe("mine");
    expect(view.getItem("host-b:layout")).toBeNull();
  });

  test("lists only its own keys, without the prefix", () => {
    const { view } = createViews();
    view.setItem("first", "1");
    view.setItem("second", "2");

    const keys = Array.from({ length: view.length }, (_, index) => view.key(index));

    expect(keys.sort()).toEqual(["first", "second"]);
    expect(view.key(keys.length)).toBeNull();
  });

  test("lists its keys again after its own writes and removals", () => {
    const { view } = createViews();
    view.setItem("first", "1");
    expect(view.length).toBe(1);

    view.setItem("second", "2");
    expect(view.key(1)).not.toBeNull();
    view.removeItem("first");

    expect(view.length).toBe(1);
    expect(view.key(0)).toBe("second");
  });

  test("leaves the keys of other owners when it removes its own", () => {
    const { base, view } = createViews();
    view.setItem("layout", "mine");

    view.removeItem("layout");

    expect(base.getItem("host-b:layout")).toBe("other");
    expect(view.length).toBe(0);
  });
});
