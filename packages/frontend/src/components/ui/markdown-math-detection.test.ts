import { describe, expect, test } from "bun:test";
import { hasMarkdownMath } from "./markdown-math-detection";

describe("hasMarkdownMath", () => {
  test.each([
    ["inline math", "Euler wrote $e^{i\\pi}+1=0$."],
    ["block math", "$$\n\\int_0^1 x^2 dx\n$$"],
    ["block math with spaces before a following paragraph", "$$\nx\n$$   \n\nAfter"],
    ["block math with a tab before a CRLF paragraph", "$$\r\nx\r\n$$\t\r\n\r\nAfter"],
    ["block math with spaces at EOF", "$$\nx\n$$   "],
    ["block math with a tab at EOF", "$$\nx\n$$\t"],
  ])("detects %s", (_name, markdown) => {
    expect(hasMarkdownMath(markdown)).toBe(true);
  });

  test.each([
    ["plain text", "No formulas here."],
    ["currency", "Cash $ 5 $"],
    ["shell variables", "Use $HOME and $PATH"],
    ["escaped dollars", String.raw`Escaped \$5`],
    ["inline code", "`$x$`"],
    ["fenced code", "```sh\necho $HOME\n```"],
    ["block-math lookalike in fenced code", "```md\n$$\nx\n$$   \n```"],
    ["block-math lookalike in whitespace-closed fenced code", "```md\n$$\nx\n$$   \n``` \t\nAfter"],
  ])("does not load math for %s", (_name, markdown) => {
    expect(hasMarkdownMath(markdown)).toBe(false);
  });
});
