import { describe, expect, test } from "bun:test";
import { reconcileKeys } from "./use-stable-keys";

const counter = () => {
  let count = 0;
  return () => `new-${(count += 1)}`;
};

describe("stable list keys", () => {
  const first = { id: "a" };
  const second = { id: "b" };
  const third = { id: "c" };
  const keys = ["k1", "k2", "k3"];

  test("a moved item keeps its key", () => {
    expect(reconcileKeys([first, second, third], keys, [second, first, third], counter())).toEqual([
      "k2",
      "k1",
      "k3",
    ]);
  });

  test("a removed item takes its key away, and the others keep theirs", () => {
    expect(reconcileKeys([first, second, third], keys, [first, third], counter())).toEqual([
      "k1",
      "k3",
    ]);
  });

  test("a changed item keeps the key of its place, so its field keeps the focus", () => {
    expect(
      reconcileKeys([first, second, third], keys, [first, { id: "b2" }, third], counter()),
    ).toEqual(["k1", "k2", "k3"]);
  });

  test("an added item gets a new key", () => {
    expect(
      reconcileKeys([first, second, third], keys, [first, second, third, { id: "d" }], counter()),
    ).toEqual(["k1", "k2", "k3", "new-1"]);
  });

  test("equal primitive values match in order", () => {
    expect(reconcileKeys([true, true], ["k1", "k2"], [true, true, true], counter())).toEqual([
      "k1",
      "k2",
      "new-1",
    ]);
  });
});
