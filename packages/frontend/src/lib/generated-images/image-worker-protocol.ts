import { z } from "zod";
import { agentImageGenerationPartSchema } from "@openducktor/contracts";
import type { CodexImageGenerationPreparation } from "@openducktor/adapters-codex-app-server";

export type ImageWorkerRequest =
  | { kind: "decode"; base64: string; byteLength: number; mime: string }
  | { kind: "history"; images: readonly CodexImageGenerationPreparation[] };

export const imageWorkerResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("decode"), bytes: z.instanceof(ArrayBuffer) }),
  z.object({ kind: z.literal("history"), parts: z.array(agentImageGenerationPartSchema) }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type ImageWorkerResponse = z.infer<typeof imageWorkerResponseSchema>;
