import { describe, expect, test } from "bun:test";
import {
  createUsagePricer,
  type UsageCatalog,
  type UsageRates,
  usageRateCatalogOf,
} from "./usage-pricing";

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

/** An excerpt of the models.dev catalog. */
const CATALOG: UsageCatalog = {
  openai: {
    models: {
      "gpt-6.2-sol": {
        cost: {
          input: 2,
          output: 10,
          cache_read: 0.1,
          cache_write: 2.5,
          tiers: [
            { input: 4, output: 15, cache_read: 0.2, tier: { type: "context", size: 272_000 } },
          ],
          context_over_200k: { input: 4, output: 15 },
        },
        experimental: {
          modes: {
            fast: {
              cost: { input: 4, output: 20, cache_read: 0.2, cache_write: 5 },
              provider: { body: { service_tier: "priority" } },
            },
            // A mode without its own cost.
            pro: { provider: { body: {} } },
          },
        },
      },
      "text-embedding-3-small": {},
    },
  },
  anthropic: {
    models: {
      "claude-opus-5-5": {
        cost: { input: 4, output: 20, cache_read: 0.2, cache_write: 5 },
        experimental: {
          modes: {
            fast: {
              cost: { input: 8, output: 40 },
              provider: { body: { speed: "fast" } },
            },
          },
        },
      },
    },
  },
  opencode: { models: { "tidepool-alpha-free": { cost: { input: 0, output: 0 } } } },
};

describe("usageRateCatalogOf", () => {
  const pricer = usageRateCatalogOf(CATALOG);

  test("reads base rates, prompt size steps, and the tiers that modes set", () => {
    expect(pricer.openai?.["gpt-6.2-sol"]).toEqual({
      base: [
        {
          minPrompt: 0,
          rates: { input: 2, output: 10, cacheRead: 0.1, cacheWrite5m: 2.5, cacheWrite1h: 4 },
        },
        {
          minPrompt: 272_000,
          rates: { input: 4, output: 15, cacheRead: 0.2, cacheWrite5m: 2.5, cacheWrite1h: 8 },
        },
      ],
      tiers: {
        priority: [
          {
            minPrompt: 0,
            rates: { input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8 },
          },
        ],
      },
    });
    expect(pricer.anthropic?.["claude-opus-5-5"]?.tiers.fast?.[0]?.rates).toEqual({
      input: 8,
      output: 40,
      cacheRead: 0.2,
      cacheWrite5m: 5,
      cacheWrite1h: 16,
    });
  });

  test("prices the model ID that OpenCode gives each mode", () => {
    expect(pricer.openai?.["gpt-6.2-sol-fast"]?.base[0]?.rates.input).toBe(4);
    expect(pricer.anthropic?.["claude-opus-5-5-fast"]?.base[0]?.rates.output).toBe(40);
    expect(pricer.openai?.["gpt-6.2-sol-pro"]).toBeUndefined();
  });

  test("bills cache traffic as input without cache rates, and skips models without a cost", () => {
    expect(pricer.opencode?.["tidepool-alpha-free"]?.base[0]?.rates).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
    });
    expect(pricer.openai?.["text-embedding-3-small"]).toBeUndefined();
  });
});
