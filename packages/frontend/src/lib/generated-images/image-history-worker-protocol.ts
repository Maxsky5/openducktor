import type { CodexImageGenerationPreparation } from "@openducktor/adapters-codex-app-server";
import { agentImageGenerationPartSchema } from "@openducktor/contracts";
import { z } from "zod";

export const IMAGE_HISTORY_CHUNK_BYTES = 1024 * 1024;

export type ImageHistoryWorkerRequest = { id: number } & (
  | { kind: "start"; image: CodexImageGenerationPreparation; inline: boolean }
  | { kind: "chunk"; bytes: Uint8Array<ArrayBuffer> }
  | { kind: "end" }
);

export const imageHistoryWorkerResponseSchema = z.discriminatedUnion("kind", [
  z.object({ id: z.number().int().nonnegative(), kind: z.literal("ack") }),
  z.object({
    id: z.number().int().nonnegative(),
    kind: z.literal("part"),
    part: agentImageGenerationPartSchema,
  }),
  z.object({ id: z.number().int().nonnegative(), kind: z.literal("error"), message: z.string() }),
]);
export type ImageHistoryWorkerResponse = z.infer<typeof imageHistoryWorkerResponseSchema>;
