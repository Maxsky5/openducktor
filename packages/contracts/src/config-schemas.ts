import { z } from "zod";
import { repoPromptOverridesSchema } from "./prompt-schemas";

const DEFAULT_SOFT_GUARDRAILS = {
  cpuHighWatermarkPercent: 85,
  minFreeMemoryMb: 2048,
  backoffSeconds: 30,
} as const;

const toSoftGuardrailsDefaults = () => ({ ...DEFAULT_SOFT_GUARDRAILS });

const nullableToOptional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === null ? undefined : value), schema.optional());

export const softGuardrailsSchema = z.object({
  cpuHighWatermarkPercent: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(DEFAULT_SOFT_GUARDRAILS.cpuHighWatermarkPercent),
  minFreeMemoryMb: z.number().int().min(128).default(DEFAULT_SOFT_GUARDRAILS.minFreeMemoryMb),
  backoffSeconds: z.number().int().min(1).default(DEFAULT_SOFT_GUARDRAILS.backoffSeconds),
});
export type SoftGuardrails = z.infer<typeof softGuardrailsSchema>;

export const repoHooksSchema = z.object({
  preStart: z.array(z.string()).default([]),
  postComplete: z.array(z.string()).default([]),
});
export type RepoHooks = z.infer<typeof repoHooksSchema>;

export const agentModelDefaultSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  variant: nullableToOptional(z.string().min(1)),
  opencodeAgent: nullableToOptional(z.string().min(1)),
});
export type AgentModelDefault = z.infer<typeof agentModelDefaultSchema>;

export const repoAgentDefaultsSchema = z.object({
  spec: nullableToOptional(agentModelDefaultSchema),
  planner: nullableToOptional(agentModelDefaultSchema),
  build: nullableToOptional(agentModelDefaultSchema),
  qa: nullableToOptional(agentModelDefaultSchema),
});
export type RepoAgentDefaults = z.infer<typeof repoAgentDefaultsSchema>;

export const repoConfigSchema = z.object({
  worktreeBasePath: nullableToOptional(z.string().min(1)),
  branchPrefix: z.string().min(1).default("obp"),
  defaultTargetBranch: z.string().default("origin/main"),
  trustedHooks: z.boolean().default(false),
  hooks: repoHooksSchema.default({ preStart: [], postComplete: [] }),
  worktreeSetupScript: z.string().default(""),
  worktreeCleanupScript: z.string().default(""),
  worktreeFileCopies: z.array(z.string()).default([]),
  promptOverrides: repoPromptOverridesSchema.default({}),
  agentDefaults: repoAgentDefaultsSchema.default({
    spec: undefined,
    planner: undefined,
    build: undefined,
    qa: undefined,
  }),
});
export type RepoConfig = z.infer<typeof repoConfigSchema>;

export const globalConfigSchema = z.object({
  version: z.literal(1),
  activeRepo: z.string().optional(),
  repos: z.record(z.string(), repoConfigSchema).default({}),
  recentRepos: z.array(z.string()).default([]),
});
export type GlobalConfig = z.infer<typeof globalConfigSchema>;
