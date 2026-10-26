import { describe, expect, test } from "bun:test";
import { buildContextUsagePresentation } from "./context-usage-presentation";

describe("buildContextUsagePresentation", () => {
  test("shows one decimal below 100% and names the used tokens", () => {
    const usage = buildContextUsagePresentation({ totalTokens: 42_500, contextWindow: 100_000 });
    expect(usage.usageLabel).toBe("42.5%");
    expect(usage.meterPercent).toBe(42.5);
    expect(usage.severity).toBe("normal");
    expect(usage.accessibleLabel).toBe(`Session context: 42.5% used, ${usage.compactTotal} tokens`);
    expect(usage.exactOutput).toBeNull();
  });

  test("marks 75% as a warning and 90% as critical", () => {
    expect(buildContextUsagePresentation({ totalTokens: 75, contextWindow: 100 }).severity).toBe(
      "warning",
    );
    expect(buildContextUsagePresentation({ totalTokens: 90, contextWindow: 100 }).severity).toBe(
      "critical",
    );
  });

  test("rounds an overfull window and keeps the meter at 100%", () => {
    const usage = buildContextUsagePresentation({
      totalTokens: 120,
      contextWindow: 100,
      outputLimit: 32_000,
    });
    expect(usage.usageLabel).toBe("120%");
    expect(usage.meterPercent).toBe(100);
    expect(usage.exactOutput).not.toBeNull();
  });
});
