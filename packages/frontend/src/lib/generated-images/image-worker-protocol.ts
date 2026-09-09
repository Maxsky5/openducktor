import { z } from "zod";

export type ImageWorkerRequest = {
  kind: "decode";
  base64: string;
  byteLength: number;
  mime: string;
};

export const imageWorkerResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("decode"), bytes: z.instanceof(ArrayBuffer) }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type ImageWorkerResponse = z.infer<typeof imageWorkerResponseSchema>;
