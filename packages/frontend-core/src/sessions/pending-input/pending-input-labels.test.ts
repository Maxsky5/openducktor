import { expect, test } from "bun:test";
import { questionAnsweredStatus } from "./pending-input-labels";

test("questionAnsweredStatus counts answered questions", () => {
  expect(questionAnsweredStatus(1, 3)).toBe("1/3 answered");
});
