import { z } from "zod";

export const softGuardrailsSchema = z.object({
  cpuHighWatermarkPercent: z.number().int().min(1).max(100).default(85),
  minFreeMemoryMb: z.number().int().min(128).default(2048),
  backoffSeconds: z.number().int().min(1).default(30),
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
  variant: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.string().min(1).optional(),
  ),
  opencodeAgent: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.string().min(1).optional(),
  ),
});
export type AgentModelDefault = z.infer<typeof agentModelDefaultSchema>;

export const repoAgentDefaultsSchema = z.object({
  spec: z.preprocess(
    (value) => (value === null ? undefined : value),
    agentModelDefaultSchema.optional(),
  ),
  planner: z.preprocess(
    (value) => (value === null ? undefined : value),
    agentModelDefaultSchema.optional(),
  ),
  build: z.preprocess(
    (value) => (value === null ? undefined : value),
    agentModelDefaultSchema.optional(),
  ),
  qa: z.preprocess(
    (value) => (value === null ? undefined : value),
    agentModelDefaultSchema.optional(),
  ),
});
export type RepoAgentDefaults = z.infer<typeof repoAgentDefaultsSchema>;

export const repoConfigSchema = z.object({
  worktreeBasePath: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.string().min(1).optional(),
  ),
  branchPrefix: z.string().min(1).default("obp"),
  trustedHooks: z.boolean().default(false),
  hooks: repoHooksSchema.default({ preStart: [], postComplete: [] }),
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
  taskMetadataNamespace: z.string().min(1).default("openducktor"),
  repos: z.record(z.string(), repoConfigSchema).default({}),
  recentRepos: z.array(z.string()).default([]),
  scheduler: z
    .object({
      softGuardrails: softGuardrailsSchema.default({
        cpuHighWatermarkPercent: 85,
        minFreeMemoryMb: 2048,
        backoffSeconds: 30,
      }),
    })
    .default({
      softGuardrails: {
        cpuHighWatermarkPercent: 85,
        minFreeMemoryMb: 2048,
        backoffSeconds: 30,
      },
    }),
});
export type GlobalConfig = z.infer<typeof globalConfigSchema>;
