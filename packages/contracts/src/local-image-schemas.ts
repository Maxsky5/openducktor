import { z } from "zod";

/** The image types that `local_image_read` reads. */
const LOCAL_IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

/** Larger files fail, so one read cannot fill the memory of the app. */
export const LOCAL_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

/** An image file on the host, such as one that an agent shows in a reply. */
export const localImageReadInputSchema = z.strictObject({
  path: z.string().trim().min(1),
});
export type LocalImageReadInput = z.infer<typeof localImageReadInputSchema>;

export const localImageReadResultSchema = z.strictObject({
  mediaType: z.enum(LOCAL_IMAGE_MEDIA_TYPES),
  bytesBase64: z.string().min(1),
});
export type LocalImageReadResult = z.infer<typeof localImageReadResultSchema>;
