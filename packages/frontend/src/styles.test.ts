import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readStyles = (): string => readFileSync(resolve(import.meta.dir, "styles.css"), "utf8");

describe("global styles", () => {
  test("uses the selected surface token for native text selection", () => {
    const styles = readStyles().replace(/\/\*[\s\S]*?\*\//g, "");
    const selectionRuleMatch = styles.match(/::selection\s*\{([^}]*)\}/);

    if (!selectionRuleMatch) {
      throw new Error("Expected global ::selection rule in styles.css");
    }

    const selectionRule = selectionRuleMatch[1];
    expect(selectionRule).toContain("var(--selected-surface)");
    expect(selectionRule).not.toContain("var(--primary)");
  });
});
