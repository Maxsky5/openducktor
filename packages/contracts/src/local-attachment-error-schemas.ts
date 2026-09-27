import { z } from "zod";

export const LOCAL_ATTACHMENT_UNAVAILABLE_REASON = "attachment_unavailable";
export const LOCAL_ATTACHMENT_UNAVAILABLE_MESSAGE =
  "This attachment is not available. Add it again to use it.";

export const localAttachmentUnavailableDetailsSchema = z.object({
  reason: z.literal(LOCAL_ATTACHMENT_UNAVAILABLE_REASON),
});

export type LocalAttachmentUnavailableDetails = z.infer<
  typeof localAttachmentUnavailableDetailsSchema
>;
