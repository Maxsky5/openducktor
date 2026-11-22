import { z } from "zod";

export const knownRuntimeKindValues = ["opencode", "codex", "claude", "antigravity"] as const;
export const knownRuntimeKindSchema = z.enum(knownRuntimeKindValues);
export type KnownRuntimeKind = z.infer<typeof knownRuntimeKindSchema>;
