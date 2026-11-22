import { describe, expect, test } from "bun:test";
import { claudeModelProvider, claudeUsageUnits } from "./usage-claude-records";

type UsageFixture = {
  input_tokens?: number | undefined;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number | undefined;
  service_tier?: string;
  speed?: string;
  cache_creation?: { ephemeral_1h_input_tokens: number; ephemeral_5m_input_tokens: number };
  iterations?: (UsageFixture & { type: string; model?: string })[];
};
type AssistantFixture = {
  type: string;
  sessionId: string;
  timestamp: string;
  cwd: string;
  requestId: string;
  isApiErrorMessage?: boolean;
  message: { id: string; model: string; usage: UsageFixture };
};

const assistant = (overrides: Partial<AssistantFixture> = {}, usage: UsageFixture = {}): string =>
  JSON.stringify(record(overrides, usage));

const record = (overrides: Partial<AssistantFixture>, usage: UsageFixture): AssistantFixture => ({
  type: "assistant",
  sessionId: "root",
  timestamp: "2026-11-04T13:35:06.467Z",
  cwd: "/repo",
  requestId: "req_1",
  message: {
    id: "msg_1",
    model: "claude-opus-5-5",
    usage: {
      input_tokens: 2,
      cache_creation_input_tokens: 30,
      cache_read_input_tokens: 19,
      output_tokens: 82,
      service_tier: "standard",
      cache_creation: { ephemeral_1h_input_tokens: 25, ephemeral_5m_input_tokens: 5 },
      ...usage,
    },
  },
  ...overrides,
});

describe("claudeUsageUnits", () => {
  test("reads one request with its cache write lifetimes", () => {
    expect(claudeUsageUnits(assistant())).toEqual([
      {
        identity: "msg_1:req_1",
        occurredAtMs: Date.parse("2026-11-04T13:35:06.467Z"),
        session: "root",
        project: "/repo",
        model: "claude-opus-5-5",
        provider: "anthropic",
        serviceTier: "standard",
        tokens: { input: 2, cacheRead: 19, cacheWrite5m: 5, cacheWrite1h: 25, output: 82 },
      },
    ]);
  });

  test("leaves out synthetic replies, API errors, and other record types", () => {
    expect(
      claudeUsageUnits(assistant({ message: { id: "x", model: "<synthetic>", usage: {} } })),
    ).toEqual([]);
    expect(claudeUsageUnits(assistant({ isApiErrorMessage: true }))).toEqual([]);
    expect(claudeUsageUnits(assistant({ type: "user" }))).toEqual([]);
  });

  test("marks a request without a token field as unmeasured", () => {
    expect(claudeUsageUnits(assistant({}, { output_tokens: undefined }))?.[0]?.tokens).toBeNull();
    const withoutUsage = JSON.parse(assistant());
    delete withoutUsage.message.usage;
    expect(claudeUsageUnits(JSON.stringify(withoutUsage))?.[0]?.tokens).toBeNull();
  });

  test("reports an assistant record in an unknown shape, and skips other records", () => {
    expect(claudeUsageUnits(assistant({ sessionId: "" }))).toBeNull();
    expect(claudeUsageUnits(JSON.stringify({ type: "user", note: '"type":"assistant"' }))).toEqual(
      [],
    );
  });

  test("prices fast mode apart from the standard tier", () => {
    expect(claudeUsageUnits(assistant({}, { speed: "fast" }))?.[0]?.serviceTier).toBe("fast");
  });

  test("counts an advisor call as its own request", () => {
    const units = claudeUsageUnits(
      assistant(
        {},
        {
          iterations: [
            { type: "message", input_tokens: 2 },
            {
              type: "advisor_message",
              model: "claude-haiku-5-5",
              input_tokens: 5,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              output_tokens: 7,
            },
          ],
        },
      ),
    );
    expect(units?.map((unit) => [unit.identity, unit.model, unit.tokens?.output])).toEqual([
      ["msg_1:req_1", "claude-opus-5-5", 82],
      ["msg_1:req_1:advisor:1", "claude-haiku-5-5", 7],
    ]);
  });
});

describe("claudeModelProvider", () => {
  test("reads the provider from the form of the model ID", () => {
    expect(claudeModelProvider("claude-sonnet-4-5-20250929")).toBe("anthropic");
    expect(claudeModelProvider("us.anthropic.claude-sonnet-4-5-20250929-v1:0")).toBe(
      "amazon-bedrock",
    );
    expect(claudeModelProvider("claude-opus-4@20250514")).toBe("google-vertex");
    expect(claudeModelProvider("gpt-6-luna")).toBeNull();
  });
});
