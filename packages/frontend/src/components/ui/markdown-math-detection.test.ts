import { describe, expect, test } from "bun:test";
import { hasMarkdownMath } from "./markdown-math-detection";

describe("hasMarkdownMath", () => {
  test.each([
    ["inline math", "Euler wrote $e^{i\\pi}+1=0$."],
    ["block math", "$$\n\\int_0^1 x^2 dx\n$$"],
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
  ])("does not load math for %s", (_name, markdown) => {
    expect(hasMarkdownMath(markdown)).toBe(false);
  });
});
