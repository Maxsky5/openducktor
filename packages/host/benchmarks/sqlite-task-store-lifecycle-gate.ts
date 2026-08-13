export type LatencySummary = {
  p50Ms: number;
  p95Ms: number;
};

export type LatencyGateResult = {
  p50ImprovementPercent: number;
  p50Pass: boolean;
  p95ImprovementPercent: number;
  p95Pass: boolean;
  p95SavedMs: number;
};

export type ThroughputResult = {
  concurrentRead: ThroughputMeasurement;
  mixedSequential: ThroughputMeasurement;
};

type ThroughputMeasurement = {
  currentOperationsPerSecond: number;
  retainedOperationsPerSecond: number;
  retainedPercentChange: number;
};

type ThroughputRates = {
  currentConcurrentRate: number;
  currentMixedRate: number;
  retainedConcurrentRate: number;
  retainedMixedRate: number;
};

export const roundBenchmarkMetric = (value: number): number => Math.round(value * 1_000) / 1_000;

const percentile = (values: readonly number[], fraction: number): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? 0;
};

const summarizeLatency = (samples: readonly number[]): LatencySummary => ({
  p50Ms: percentile(samples, 0.5),
  p95Ms: percentile(samples, 0.95),
});

const percentChange = (baseline: number, candidate: number): number =>
  ((candidate - baseline) / baseline) * 100;

const improvementPercent = (baseline: number, candidate: number): number =>
  ((baseline - candidate) / baseline) * 100;

const reportLatency = ({ p50Ms, p95Ms }: LatencySummary): LatencySummary => ({
  p50Ms: roundBenchmarkMetric(p50Ms),
  p95Ms: roundBenchmarkMetric(p95Ms),
});

export const evaluateLatencySamples = (
  currentSamples: readonly number[],
  retainedSamples: readonly number[],
): {
  current: LatencySummary;
  gate: LatencyGateResult;
  retained: LatencySummary;
} => {
  const current = summarizeLatency(currentSamples);
  const retained = summarizeLatency(retainedSamples);
  const p50ImprovementPercent = improvementPercent(current.p50Ms, retained.p50Ms);
  const p95ImprovementPercent = improvementPercent(current.p95Ms, retained.p95Ms);
  const p95SavedMs = current.p95Ms - retained.p95Ms;
  return {
    current: reportLatency(current),
    gate: {
      p50ImprovementPercent: roundBenchmarkMetric(p50ImprovementPercent),
      p50Pass: p50ImprovementPercent >= 15,
      p95ImprovementPercent: roundBenchmarkMetric(p95ImprovementPercent),
      p95Pass: p95ImprovementPercent >= 15 && p95SavedMs >= 1,
      p95SavedMs: roundBenchmarkMetric(p95SavedMs),
    },
    retained: reportLatency(retained),
  };
};

const throughputMeasurement = (
  currentOperationsPerSecond: number,
  retainedOperationsPerSecond: number,
): ThroughputMeasurement => ({
  currentOperationsPerSecond: roundBenchmarkMetric(currentOperationsPerSecond),
  retainedOperationsPerSecond: roundBenchmarkMetric(retainedOperationsPerSecond),
  retainedPercentChange: roundBenchmarkMetric(
    percentChange(currentOperationsPerSecond, retainedOperationsPerSecond),
  ),
});

export const evaluateThroughputRates = ({
  currentConcurrentRate,
  currentMixedRate,
  retainedConcurrentRate,
  retainedMixedRate,
}: ThroughputRates): { pass: boolean; result: ThroughputResult } => {
  const concurrentPercentChange = percentChange(currentConcurrentRate, retainedConcurrentRate);
  const mixedPercentChange = percentChange(currentMixedRate, retainedMixedRate);
  const result = {
    concurrentRead: throughputMeasurement(currentConcurrentRate, retainedConcurrentRate),
    mixedSequential: throughputMeasurement(currentMixedRate, retainedMixedRate),
  };
  return {
    pass: mixedPercentChange > -5 && concurrentPercentChange > -5,
    result,
  };
};
