import { z } from "zod";

export const LOCAL_ATTACHMENT_UNAVAILABLE_REASON = "attachment_unavailable";
export const LOCAL_ATTACHMENT_UNAVAILABLE_MESSAGE = "This attachment cannot be opened.";

export const localAttachmentUnavailableDetailsSchema = z.object({
  reason: z.literal(LOCAL_ATTACHMENT_UNAVAILABLE_REASON),
});

export type LocalAttachmentUnavailableDetails = z.infer<
  typeof localAttachmentUnavailableDetailsSchema
>;
