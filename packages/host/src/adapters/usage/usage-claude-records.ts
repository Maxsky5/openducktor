import { z } from "zod";
import type { UsageTokens, UsageUnit } from "../../domain/usage/usage-unit";
import type { UsageLineFilter } from "./usage-jsonl-reader";

/** Lines without this text cannot hold an assistant record. */
const ASSISTANT_TYPE = Buffer.from('"type":"assistant"');
export const CLAUDE_USAGE_LINE_FILTER: UsageLineFilter = (line) =>
  line.indexOf(ASSISTANT_TYPE) >= 0;

const count = z.number().int().nonnegative().optional().catch(undefined);
const label = z.string().min(1).optional().catch(undefined);

/** Token fields of a Claude API response. A missing or invalid field leaves it unmeasured. */
const usageFieldsSchema = z.object({
  input_tokens: count,
  cache_read_input_tokens: count,
  cache_creation_input_tokens: count,
  output_tokens: count,
  cache_creation: z.object({ ephemeral_1h_input_tokens: count }).optional().catch(undefined),
  service_tier: label,
  speed: label,
});

const assistantRecordSchema = z.object({
  type: z.literal("assistant"),
  sessionId: z.string().min(1),
  timestamp: z.iso.datetime({ offset: true }),
  uuid: label,
  cwd: label,
  requestId: label,
  isApiErrorMessage: z.boolean().optional().catch(undefined),
  message: z.object({
    id: label,
    model: label,
    // A response without usage is still model activity. It counts as unmeasured.
    usage: usageFieldsSchema
      .extend({
        iterations: z
          .array(usageFieldsSchema.extend({ type: label, model: label }))
          .optional()
          .catch(undefined),
      })
      .optional(),
  }),
});

/** The record type decides whether a line is an assistant record at all. */
const recordTypeSchema = z.object({ type: z.string() });

type UsageFields = z.infer<typeof usageFieldsSchema>;

/** Claude Code records the model ID only. Its form shows the provider. */
export const claudeModelProvider = (model: string): string | null => {
  if (
    /^((us|eu|apac|global)\.)?anthropic\.claude-/.test(model) ||
    model.startsWith("arn:aws:bedrock")
  )
    return "amazon-bedrock";
  if (/^claude-.+@\d{8}$/.test(model)) return "google-vertex";
  if (model.startsWith("claude-")) return "anthropic";
  return null;
};

const claudeTokens = (usage: UsageFields): UsageTokens | null => {
  const { input_tokens: input, cache_read_input_tokens: cacheRead, output_tokens: output } = usage;
  const cacheWrite = usage.cache_creation_input_tokens;
  if (
    input === undefined ||
    cacheRead === undefined ||
    cacheWrite === undefined ||
    output === undefined
  )
    return null;
  // Without the lifetime split, all cache writes use the 5-minute rate.
  const cacheWrite1h = Math.min(usage.cache_creation?.ephemeral_1h_input_tokens ?? 0, cacheWrite);
  return { input, cacheRead, cacheWrite5m: cacheWrite - cacheWrite1h, cacheWrite1h, output };
};

/** Fast mode has its own rates. */
const serviceTierOf = (usage: UsageFields): string | null =>
  usage.speed === "fast" ? "fast" : (usage.service_tier ?? null);

/**
 * The model requests of one Claude Code transcript record. Claude Code writes one line per content
 * block of a response; they share `message.id` and `requestId`, so they form one unit. Returns
 * null for an assistant record of an unknown shape.
 */
export const claudeUsageUnits = (line: string): UsageUnit[] | null => {
  const value: unknown = JSON.parse(line);
  const kind = recordTypeSchema.safeParse(value);
  if (!kind.success || kind.data.type !== "assistant") return [];
  const parsed = assistantRecordSchema.safeParse(value);
  if (!parsed.success) return null;
  const record = parsed.data;
  const { message } = record;
  const model = message.model ?? null;
  if (record.isApiErrorMessage === true || model === "<synthetic>") return [];
  const messageId = message.id ?? record.uuid;
  if (messageId === undefined) return [];
  const identity = `${messageId}:${record.requestId ?? ""}`;
  const base = {
    occurredAtMs: Date.parse(record.timestamp),
    session: record.sessionId,
    project: record.cwd ?? null,
  };
  const units: UsageUnit[] = [
    {
      ...base,
      identity,
      model,
      provider: model === null ? null : claudeModelProvider(model),
      serviceTier: message.usage ? serviceTierOf(message.usage) : null,
      tokens: message.usage ? claudeTokens(message.usage) : null,
    },
  ];
  // An advisor call is a separate request on its own model.
  message.usage?.iterations?.forEach((iteration, index) => {
    if (iteration.type !== "advisor_message") return;
    const advisorModel = iteration.model ?? null;
    units.push({
      ...base,
      identity: `${identity}:advisor:${index}`,
      model: advisorModel,
      provider: advisorModel === null ? null : claudeModelProvider(advisorModel),
      serviceTier: serviceTierOf(iteration),
      tokens: claudeTokens(iteration),
    });
  });
  return units;
};
