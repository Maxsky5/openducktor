import { describe, expect, test } from "bun:test";
import { createUsagePricer, type UsageRates } from "./usage-pricing";

const rates = (input: number): UsageRates => ({
  input,
  cacheRead: input / 10,
  cacheWrite5m: input * 1.25,
  cacheWrite1h: input * 2,
  output: input * 5,
});

describe("createUsagePricer", () => {
  const pricer = createUsagePricer({
    anthropic: {
      "claude-opus-5-5": {
        base: [{ minPrompt: 0, rates: rates(4) }],
        tiers: { fast: [{ minPrompt: 0, rates: rates(8) }] },
      },
    },
    openai: { "gpt-6.2-sol": { base: [{ minPrompt: 0, rates: rates(2) }], tiers: {} } },
  });

  test("matches the recorded provider and model exactly or without a date suffix", () => {
    expect(pricer.stepsFor("anthropic", "claude-opus-5-5", null)?.[0]?.rates.input).toBe(4);
    expect(pricer.stepsFor("anthropic", "claude-opus-5-5-20261101", null)).not.toBeNull();
    expect(pricer.stepsFor("openai", "gpt-6.2-sol-2026-11-01", null)).not.toBeNull();
  });

  test("does not guess a rate for another provider or a similar model", () => {
    expect(pricer.stepsFor("amazon-bedrock", "claude-opus-5-5", null)).toBeNull();
    expect(pricer.stepsFor("openai", "gpt-6.2-sol-fast", null)).toBeNull();
    expect(pricer.stepsFor("anthropic", "claude-opus-5-5-preview", null)).toBeNull();
  });

  test("prices the standard tiers at the base rates and other tiers at their own rates", () => {
    expect(pricer.stepsFor("anthropic", "claude-opus-5-5", "standard")?.[0]?.rates.input).toBe(4);
    expect(pricer.stepsFor("openai", "gpt-6.2-sol", "default")?.[0]?.rates.input).toBe(2);
    expect(pricer.stepsFor("anthropic", "claude-opus-5-5", "fast")?.[0]?.rates.input).toBe(8);
    expect(pricer.stepsFor("openai", "gpt-6.2-sol", "priority")).toBeNull();
  });
});
