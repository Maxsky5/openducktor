import { describe, expect, test } from "bun:test";
import { EMPTY_USAGE_SUMS, usageFigure } from "./usage-figure";

const sums = (values: Partial<typeof EMPTY_USAGE_SUMS>) => ({ ...EMPTY_USAGE_SUMS, ...values });

describe("usageFigure", () => {
  test("adds the token categories into processed tokens", () => {
    const figure = usageFigure(sums({ input: 1, cacheRead: 2, cacheWrite: 3, output: 4 }), true);
    expect(figure.tokens.processed).toBe(10);
  });

  test("names the cost state from the priced share", () => {
    expect(usageFigure(sums({}), true).cost.state).toBe("none");
    expect(usageFigure(sums({ input: 10, costUsd: 1 }), true).cost.state).toBe("complete");
    expect(usageFigure(sums({ input: 10, unpricedTokens: 4 }), true).cost.state).toBe("partial");
    expect(usageFigure(sums({ input: 10, unpricedTokens: 10 }), true).cost.state).toBe(
      "unavailable",
    );
  });

  test("leaves usage without token counts unpriced", () => {
    expect(usageFigure(sums({ unmeasured: 2 }), true).cost.state).toBe("unavailable");
    expect(usageFigure(sums({ input: 10, unmeasured: 1 }), true).cost.state).toBe("partial");
  });
});
