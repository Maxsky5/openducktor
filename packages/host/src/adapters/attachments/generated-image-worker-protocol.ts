import type { CodexImageGenerationPreparation } from "@openducktor/adapters-codex-app-server";
import {
  agentGeneratedImageReadResultSchema,
  agentImageGenerationPartSchema,
} from "@openducktor/contracts";
import { z } from "zod";

export type GeneratedImageWorkerRequest =
  | { kind: "history"; images: readonly CodexImageGenerationPreparation[] }
  | { kind: "inline"; base64: string; itemId: string }
  | { kind: "file"; bytes: Uint8Array; itemId: string };

export const generatedImageWorkerResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("history"), parts: z.array(agentImageGenerationPartSchema) }),
  z.object({
    kind: z.literal("payload"),
    payload: agentGeneratedImageReadResultSchema.pick({
      mime: true,
      byteLength: true,
      base64: true,
    }),
  }),
  z.object({ kind: z.literal("invalid"), message: z.string() }),
]);
export type GeneratedImageWorkerResponse = z.infer<typeof generatedImageWorkerResponseSchema>;
