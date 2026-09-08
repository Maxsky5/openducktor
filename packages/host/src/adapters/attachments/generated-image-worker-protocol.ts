import type { CodexImageGenerationPreparation } from "@openducktor/adapters-codex-app-server";
import {
  agentGeneratedImageReadResultSchema,
  agentImageGenerationPartSchema,
} from "@openducktor/contracts";
import { z } from "zod";

export type GeneratedImagePayloadRequest =
  | { kind: "inline"; base64: string; itemId: string }
  | { kind: "file"; bytes: Uint8Array<ArrayBuffer>; itemId: string; revision: string };

export type GeneratedImageWorkerRequest =
  | GeneratedImagePayloadRequest
  | { kind: "file-revision"; bytes: Uint8Array<ArrayBuffer>; itemId: string }
  | { kind: "history-start"; image: CodexImageGenerationPreparation; hasInlineOutput: boolean }
  | { kind: "history-chunk"; chunk: string }
  | { kind: "history-end" };

export type GeneratedImageWorkerMessage = { id: number; request: GeneratedImageWorkerRequest };

const generatedImageWorkerResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ack") }),
  z.object({ kind: z.literal("revision"), revision: z.string().min(1) }),
  z.object({ kind: z.literal("history"), part: agentImageGenerationPartSchema }),
  z.object({
    kind: z.literal("inline"),
    byteLength: agentGeneratedImageReadResultSchema.shape.byteLength,
  }),
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
export const generatedImageWorkerReplySchema = z.object({
  id: z.number().int().nonnegative(),
  result: generatedImageWorkerResponseSchema,
});
