import { describe, expect, test } from "bun:test";
import {
  evaluateLatencySamples,
  evaluateThroughputRates,
} from "./sqlite-task-store-lifecycle-gate";

describe("SQLite task-store lifecycle adoption gate", () => {
  test("uses the exact 15 percent latency improvement boundary", () => {
    const cases = [
      { retained: 85.0004, expectedPass: false },
      { retained: 85, expectedPass: true },
      { retained: 84.9996, expectedPass: true },
    ];

    for (const { retained, expectedPass } of cases) {
      const result = evaluateLatencySamples([100], [retained]);
      expect(result.gate.p50Pass).toBe(expectedPass);
      expect(result.gate.p95Pass).toBe(expectedPass);
    }
    const justBelow = evaluateLatencySamples([100], [85.0004]);
    expect(justBelow.gate.p50ImprovementPercent).toBe(15);
    expect(justBelow.gate.p50Pass).toBe(false);
  });

  test("uses the exact one millisecond p95 saving boundary", () => {
    const cases = [
      { retained: 4.0004, expectedPass: false },
      { retained: 4, expectedPass: true },
      { retained: 3.9996, expectedPass: true },
    ];

    for (const { retained, expectedPass } of cases) {
      const result = evaluateLatencySamples([5], [retained]);
      expect(result.gate.p95Pass).toBe(expectedPass);
    }
    const justBelow = evaluateLatencySamples([5], [4.0004]);
    expect(justBelow.gate.p95SavedMs).toBe(1);
    expect(justBelow.gate.p95Pass).toBe(false);
  });

  test("uses the exact five percent throughput regression boundary", () => {
    const cases = [
      { retained: 94.9996, expectedPass: false },
      { retained: 95, expectedPass: false },
      { retained: 95.0004, expectedPass: true },
    ];

    for (const { retained, expectedPass } of cases) {
      const evaluation = evaluateThroughputRates({
        currentConcurrentRate: 100,
        currentMixedRate: 100,
        retainedConcurrentRate: retained,
        retainedMixedRate: retained,
      });
      expect(evaluation.pass).toBe(expectedPass);
    }
    const justAbove = evaluateThroughputRates({
      currentConcurrentRate: 100,
      currentMixedRate: 100,
      retainedConcurrentRate: 95.0004,
      retainedMixedRate: 95.0004,
    });
    expect(justAbove.result.mixedSequential.retainedPercentChange).toBe(-5);
    expect(justAbove.pass).toBe(true);
  });
});
