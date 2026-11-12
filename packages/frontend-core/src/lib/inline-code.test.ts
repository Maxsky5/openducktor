import { describe, expect, test } from "bun:test";
import { inlineCodePlainText, splitInlineCode } from "./inline-code";

describe("splitInlineCode", () => {
  test("splits each value between backticks from the text", () => {
    expect(splitInlineCode("Run `gh auth login`, then `gh repo view`.")).toEqual([
      { text: "Run ", code: false, start: 0 },
      { text: "gh auth login", code: true, start: 4 },
      { text: ", then ", code: false, start: 19 },
      { text: "gh repo view", code: true, start: 26 },
      { text: ".", code: false, start: 40 },
    ]);
  });

  test("keeps an unpaired backtick as text", () => {
    expect(splitInlineCode("Codex reported: missing ` quote")).toEqual([
      { text: "Codex reported: missing ` quote", code: false, start: 0 },
    ]);
  });
});

test("inlineCodePlainText keeps the code values and drops their backticks", () => {
  expect(inlineCodePlainText("Run `gh auth login`, then retry.")).toBe(
    "Run gh auth login, then retry.",
  );
});
