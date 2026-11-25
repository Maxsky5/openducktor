import { expect, test } from "bun:test";
import { swapInList } from "./swap-in-list";

test("swaps two items of a list", () => {
  expect(swapInList(["a", "b", "c"], 0, 2)).toEqual(["c", "b", "a"]);
});
